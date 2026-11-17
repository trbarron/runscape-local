// Durable process supervision. No agent/runtime module imports or gameplay commands.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { controllerStale, freshSaves, processAlive, readJson, writeJson, type ControllerHealth } from './runtime-health';

const root = resolve(import.meta.dir, '..');
const state = join(root, 'agents/state');
const sessionFile = join(state, 'controller-heartbeat.json');
const lock = join(state, 'supervisor.lock');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const log = (event: string, details: Record<string, unknown> = {}) => {
    mkdirSync(join(root, 'agents/runs'), { recursive: true });
    const record = { t: Date.now(), event, supervisorPid: process.pid, ...details };
    appendFileSync(join(root, 'agents/runs/supervisor.jsonl'), JSON.stringify(record) + '\n');
    console.log(`[supervisor] ${event}`, JSON.stringify(details));
};

async function recoverSession(): Promise<void> {
    const old = readJson<ControllerHealth>(sessionFile);
    if (!old || old.phase === 'stopped') return;
    if (processAlive(old.pid)) {
        const command = Bun.spawnSync(['/bin/ps', '-p', String(old.pid), '-o', 'command=']).stdout.toString().trim();
        if (!old.supervisorPid || processAlive(old.supervisorPid) || !command.includes('agents/orchestrator.ts'))
            throw new Error(`Controller ${old.pid} is still alive; refusing overlapping control`);
        log('orphan-controller-stop', { controllerPid: old.pid });
        process.kill(old.pid, 'SIGTERM');
        const deadline = Date.now() + 180_000;
        while (processAlive(old.pid) && Date.now() < deadline) await sleep(1000);
        if (processAlive(old.pid)) throw new Error('Orphan controller did not stop; refusing overlapping control');
        if (readJson<ControllerHealth>(sessionFile)?.phase === 'stopped') return;
    }
    if (!old.browserEndpoint) return; // startup ended before a browser was registered
    const puppeteer = (await import('../rs-sdk/node_modules/puppeteer')).default;
    let closedAt = old.at;
    let browser: Awaited<ReturnType<typeof puppeteer.connect>> | undefined;
    try { browser = await puppeteer.connect({ browserWSEndpoint: old.browserEndpoint, protocolTimeout: 10_000 }); }
    catch {
        log('orphan-browser-unavailable', { controllerPid: old.pid });
    }
    if (browser) {
        const pages = await browser.pages();
        for (const page of pages) {
            if (page.url() === 'about:blank') continue;
            const url = new URL(page.url());
            if (url.origin !== new URL(process.env.GAME_URL ?? 'http://localhost:8888').origin
                || !url.searchParams.get('bot') || !old.bots.includes(url.searchParams.get('bot')!)) {
                await browser.disconnect();
                throw new Error('Recorded browser contains an unowned page; refusing to close it');
            }
        }
        closedAt = Date.now();
        await browser.close();
        log('orphan-browser-closed', { controllerPid: old.pid, bots: old.bots });
    }
    const saves = join(root, 'data/players/main');
    const deadline = Date.now() + 150_000;
    const disconnected = async () => {
        if (browser) return true; // the owned browser was positively closed
        const gateway = (process.env.GATEWAY_URL ?? 'http://localhost:7780').replace(/^ws:/, 'http:').replace(/^wss:/, 'https:').replace(/\/gateway\/?$/, '');
        try {
            const statuses = await Promise.all(old.bots.map(async name => {
                const response = await fetch(`${gateway}/status/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(3000) });
                if (!response.ok) return false;
                const status = await response.json() as { status?: string };
                return status.status === 'dead';
            }));
            return statuses.every(Boolean);
        } catch { return false; }
    };
    let saved = false;
    do {
        saved = freshSaves(saves, old.bots, closedAt) && await disconnected();
        if (saved) break;
        await sleep(1000);
    } while (Date.now() < deadline);
    if (!saved) throw new Error('Fresh saves and client disconnect not verified; recovery paused before login');
    writeJson(sessionFile, { ...old, phase: 'stopped', at: Date.now() });
    log('recovery-saves-verified', { bots: old.bots });
}

async function main(): Promise<void> {
    mkdirSync(state, { recursive: true });
    if (existsSync(lock)) {
        let owner = 0;
        try { owner = Number(readFileSync(join(lock, 'pid'), 'utf8')); } catch { /* interrupted lock creation */ }
        if (processAlive(owner)) throw new Error(`Supervisor ${owner} already owns the party`);
        if (!owner && Date.now() - statSync(lock).mtimeMs < 5000) throw new Error('Supervisor lock is being claimed; retry shortly');
        rmSync(lock, { recursive: true });
    }
    mkdirSync(lock);
    writeFileSync(join(lock, 'pid'), String(process.pid));
    let stopping = false;
    let child: ReturnType<typeof Bun.spawn> | undefined;
    const stop = () => {
        if (stopping) return;
        stopping = true;
        log('stop-requested');
        child?.kill('SIGTERM');
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    const awake = Bun.spawn(['/usr/bin/caffeinate', '-i', '-w', String(process.pid)], { stdout: 'ignore', stderr: 'ignore' });
    let phase = 'recovering';
    const publish = () => writeJson(join(state, 'supervisor-heartbeat.json'), {
        pid: process.pid, at: Date.now(), phase, controllerPid: child?.pid ?? null,
    });
    const heartbeat = setInterval(publish, 10_000);
    log('started');
    try {
        while (!stopping) {
            phase = 'recovering'; publish();
            try { await recoverSession(); }
            catch (error) {
                log('recovery-blocked', { error: String(error) });
                for (let i = 0; i < 30 && !stopping; i++) await sleep(1000);
                continue;
            }
            if (stopping) break;
            child = Bun.spawn([process.execPath, 'agents/orchestrator.ts'], { cwd: root,
                env: { ...process.env, RASCALS_SUPERVISOR_PID: String(process.pid) },
                stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' });
            const started = Date.now();
            let terminatedAt = 0;
            phase = 'running'; publish();
            log('controller-started', { controllerPid: child.pid });
            let exited = false;
            child.exited.then(() => { exited = true; });
            while (!exited) {
                await sleep(1000);
                if ((stopping || controllerStale(readJson<ControllerHealth>(sessionFile), child.pid, started)) && !terminatedAt) {
                    terminatedAt = Date.now();
                    phase = 'stopping';
                    log(stopping ? 'controller-stop' : 'controller-heartbeat-stale', { controllerPid: child.pid });
                    child.kill('SIGTERM');
                }
                if (terminatedAt && Date.now() - terminatedAt > 180_000 && !exited) child.kill('SIGKILL');
            }
            const code = await child.exited;
            log('controller-exited', { controllerPid: child.pid, code, signal: child.signalCode });
            child = undefined;
            if (!stopping) for (let i = 0; i < 10 && !stopping; i++) await sleep(1000);
        }
    } finally {
        try { await recoverSession(); } catch (error) { log('shutdown-recovery-blocked', { error: String(error) }); }
        clearInterval(heartbeat);
        awake.kill();
        phase = 'stopped'; publish();
        rmSync(lock, { recursive: true, force: true });
        log('stopped');
    }
}

if (import.meta.main) main().catch(error => { console.error(String(error)); process.exitCode = 1; });
