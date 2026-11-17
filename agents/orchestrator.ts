import { loadPlan } from './memory';
import { partySupplyCoverage } from './supply-context';
import { createSupplyMonitor } from './supply-coverage';
import { learning } from './learning';
import { createProgressMonitor } from './progress-signals';
import { startPortraits, stopPortraits } from './portraits/watch';
// Runs the party: four agents in headless browser clients, a council, and the dashboard.
//
//   bun agents/orchestrator.ts      # from the runscape-local root; Ctrl-C shuts down cleanly
//   agents/run.sh                   # same, restarted automatically if it crashes
//
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { BotSDK } from '../rs-sdk/sdk/index';
import { BotActions } from '../rs-sdk/sdk/actions';
import { initPathfinding } from '../rs-sdk/sdk/pathfinding';
import { CHARACTERS } from './characters';
import { Agent } from './agent';
import { agents, partyTotal } from './party';
import { onPost } from './board';
import { startCouncils, requestCouncil, recordExpeditionEvent } from './council';
import { checkState } from './achievements';
import { bankOf } from './banks';
import { emit, subscribe, recentEvents } from './events';
import { budgetLeft, spend } from './llm';
import { track } from './metrics';
import { startDashboard, DASHBOARD_PORT } from './dashboard';
import { closePublisher } from './publish';
import { runDirectory } from './events';
import { processAlive, readJson, writeJson, type ControllerHealth } from './runtime-health';

const RS = join(import.meta.dir, '..', 'rs-sdk');
const GAME_URL = process.env.GAME_URL ?? 'http://localhost:8888';
const GATEWAY_URL = process.env.GATEWAY_URL ?? 'ws://localhost:7780';
const SAVES = join(import.meta.dir, '..', 'data', 'players', 'main');
// The browser client redraws its software-rendered 3D view ~70 times a second, which pins a
// CPU core per bot and starves state updates. Bot state is published from the draw step, so
// draws are throttled rather than switched off; 8/s is still faster than the 5/s server tick.
const DRAW_FPS = Number(process.env.DRAW_FPS ?? 8);
const ONLY = (process.env.BOTS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The code version this run starts from (for the scorecard); "+" marks uncommitted changes. */
function gitCommit(): string {
    const run = (...args: string[]) => Bun.spawnSync(['git', ...args], { cwd: import.meta.dir }).stdout.toString().trim();
    const head = run('rev-parse', '--short', 'HEAD');
    return head ? `${head}${run('status', '--porcelain', '--', '.') ? '+' : ''}` : 'unknown';
}

// ---------------------------------------------------------------- accounts

// Credentials live in agents/accounts.json (gitignored). The game server auto-registers
// an account on first login, so losing this file locks the bot out of its character.
const ACCOUNTS = join(import.meta.dir, 'accounts.json');

function ensureAccount(name: string): string {
    const accounts: Record<string, string> = existsSync(ACCOUNTS) ? JSON.parse(readFileSync(ACCOUNTS, 'utf-8')) : {};
    if (accounts[name]) return accounts[name];
    const password = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
    accounts[name] = password;
    writeFileSync(ACCOUNTS, JSON.stringify(accounts, null, 4) + '\n', { mode: 0o600 });
    return password;
}

// ---------------------------------------------------------------- preflight

async function preflight(): Promise<void> {
    const inUse = await fetch(`http://127.0.0.1:${DASHBOARD_PORT}/snapshot.json`, { signal: AbortSignal.timeout(1500) }).then(
        () => true,
        () => false
    );
    if (inUse) throw new Error(`port ${DASHBOARD_PORT} is in use: is another orchestrator already running?`);
    const game = await fetch(`${GAME_URL}/`, { signal: AbortSignal.timeout(3000) }).then(
        r => r.ok,
        () => false
    );
    if (!game) throw new Error(`game server not reachable at ${GAME_URL}: run \`docker compose up -d\``);
}

// ---------------------------------------------------------------- supervision

/** Restart a crashed agent loop with backoff; give up after 5 crashes in 10 minutes. */
async function supervise(a: Agent): Promise<void> {
    const crashes: number[] = [];
    for (;;) {
        try {
            await a.run();
            return; // stopped
        } catch (e: any) {
            const now = Date.now();
            crashes.push(now);
            while (crashes.length && now - crashes[0] > 600_000) crashes.shift();
            emit(a.name, 'error', { error: `loop crashed (${crashes.length} in 10 min): ${e?.stack ?? e}` });
            if (crashes.length >= 5) {
                emit(a.name, 'error', { error: 'giving up on this agent' });
                return;
            }
            await sleep(5000 * crashes.length);
        }
    }
}

// ---------------------------------------------------------------- startup

async function main() {
    const heartbeatFile = join(import.meta.dir, 'state/controller-heartbeat.json');
    const previous = readJson<ControllerHealth>(heartbeatFile);
    if (previous && previous.phase !== 'stopped' && previous.pid !== process.pid && processAlive(previous.pid))
        throw new Error(`controller ${previous.pid} already owns the party`);
    await preflight();
    subscribe(track);
    learning.setReporter(summary=>emit('learning','info',{summary}));
    learning.initialize();
    subscribe(e=>learning.handle(e,runDirectory.split('/').at(-1)!));
    subscribe(e=>{try{recordExpeditionEvent(e,runDirectory.split('/').at(-1)!);}catch(error){emit('council','error',{error:`expedition observation save failed: ${String(error).slice(0,160)}`});}});
    let overviewReady=false;
    subscribe(createProgressMonitor({
        ready:()=>overviewReady,events:recentEvents,
        warn:summary=>emit('overview','info',{summary:`progress warning: ${summary}`}),
        notice:message=>{for(const a of agents.values())a.notice(message);},
        council:()=>requestCouncil('overview: repeated productive-but-blocked work'),
    }));

    const chars = ONLY.length ? CHARACTERS.filter(c => ONLY.includes(c.username)) : CHARACTERS;
    const names = chars.map(c => c.username);
    const health: ControllerHealth = { pid: process.pid, supervisorPid: Number(process.env.RASCALS_SUPERVISOR_PID) || undefined,
        at: Date.now(), startedAt: Date.now(), phase: 'starting', run: runDirectory, bots: names };
    const pulse = () => { health.at = Date.now(); writeJson(heartbeatFile, health); };
    pulse();
    const heartbeat = setInterval(pulse, 5000);
    emit('party', 'info', { phase: 'start', commit: gitCommit(), summary: `starting ${names.join(', ')} at ${gitCommit()} | budget left $${budgetLeft().toFixed(2)}` });

    initPathfinding();

    const puppeteer: any = (await import(join(RS, 'node_modules', 'puppeteer'))).default;
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
            '--autoplay-policy=no-user-gesture-required',
            '--mute-audio'
        ]
    });

    health.browserEndpoint = browser.wsEndpoint(); pulse();

    /** Logs the character in on a page (a fresh tab or a reload) and caps how often the client redraws. */
    const openGame = async (page: any, username: string, password: string) => {
        await page.goto(`${GAME_URL}/bot?bot=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`);
        await page.waitForFunction(() => !!(window as any).gameClient?.mainredraw, { timeout: 60_000 });
        await page.evaluate((fps: number) => {
            const client = (window as any).gameClient;
            const draw = client.mainredraw.bind(client);
            let last = 0;
            client.mainredraw = async () => {
                const now = performance.now();
                if (now - last < 1000 / fps) return;
                last = now;
                return draw();
            };
        }, DRAW_FPS);
    };

    const pages: any[] = [];
    const pageByName = new Map<string, any>();
    for (const c of chars) {
        const password = ensureAccount(c.username);
        const page = await browser.newPage();
        await page.setViewport({ width: 765, height: 503 });
        await openGame(page, c.username, password);
        pages.push(page);
        pageByName.set(c.username, page);
        const sdk = new BotSDK({
            botUsername: c.username,
            password,
            gatewayUrl: GATEWAY_URL,
            connectionMode: 'control',
            autoReconnect: true,
            autoLaunchBrowser: false,
            showChat: false
        });
        agents.set(c.username, new Agent(c, sdk, new BotActions(sdk), names));
    }

    // A post addressed to someone wakes them up, but at most once every few minutes, so
    // replies cannot ping-pong; anything else waits for their next decision as unread.
    const MESSAGE_INTERRUPT_GAP_MS = 3 * 60_000;
    const lastWoken = new Map<string, number>();
    onPost(p => {
        // Only urgent posts wake the recipient; the rest wait for their next decision.
        if (p.council || p.to === 'all' || !p.urgent) return;
        const a = agents.get(p.to);
        if (!a || a.name === p.from) return;
        if (Date.now() - (lastWoken.get(a.name) ?? 0) < MESSAGE_INTERRUPT_GAP_MS) return;
        lastWoken.set(a.name, Date.now());
        a.interrupt(`${p.from} posted to you on the board (#${p.id}): "${p.text}". Reply only if it needs an answer.`);
    });

    let shuttingDown = false;
    const shutdown = async (signal: string, code = 0) => {
        if (shuttingDown) return;
        shuttingDown = true;
        health.phase = 'stopping'; pulse();
        emit('party', 'info', { summary: `${signal}: shutting down` });
        const startedAt = Date.now();
        for (const a of agents.values()) a.stop();
        await sleep(1500);
        // Closing the clients logs the characters out, which is when the server saves them.
        for (const p of pages) await p.close().catch(() => {});
        await browser.close().catch(() => {});
        // The server logs a disconnected player out (and saves) after ~100s of silence.
        emit('party', 'info', { summary: 'waiting for the server to save the characters (up to 150s)...' });
        const fresh = (name: string) => {
            const f = join(SAVES, `${name}.sav`);
            return existsSync(f) && statSync(f).mtimeMs >= startedAt;
        };
        for (let t = 0; t < 150 && ![...agents.keys()].every(fresh); t++) await sleep(1000);
        for (const name of agents.keys()) emit(name, 'info', { summary: fresh(name) ? 'save written' : 'WARNING: no fresh save file found' });
        await stopPortraits();
        await closePublisher();
        if ([...agents.keys()].every(fresh)) health.phase = 'stopped';
        clearInterval(heartbeat); pulse();
        process.exit(code);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // A sleeping machine freezes this process without closing its connections: on waking, the
    // browser tabs, the store link and the game sockets are all stale. Exiting non-zero lets
    // run.sh start a clean party from the saved state, the path a manual restart already takes.
    let lastTick = Date.now();
    setInterval(() => {
        const gap = Date.now() - lastTick;
        lastTick = Date.now();
        if (gap > 90_000) {
            emit('party', 'info', { summary: `the clock jumped ${Math.round(gap / 60_000)} min (the machine slept): restarting for fresh connections` });
            shutdown('wake', 75);
        }
    }, 15_000);

    startPortraits();
    startDashboard({ browser, pages: pageByName, gameUrl: GAME_URL, spend });

    await Promise.all(
        chars.map(async (c, i) => {
            const a = agents.get(c.username)!;
            await sleep(i * 4000);
            for (let attempt = 0; ; attempt++) {
                try {
                    await a.sdk.connect();
                    break;
                } catch (e: any) {
                    if (/authentication/i.test(String(e?.message)) || attempt >= 5) throw new Error(`${c.username}: ${e?.message ?? e}`);
                    await sleep(5000);
                }
            }
            // The gateway can hand over a cached state from the previous session first, and a
            // fresh login fills in skills, HP and items over several frames: wait for all of
            // them, or the first decision sees "HP 0/0, empty hands" and believes its gear lost.
            const fresh = () => {
                const st = a.sdk.getState();
                const loaded = !!st?.player?.maxHp && st.inventory.length + st.equipment.length > 0;
                return !!st?.inGame && st.skills.length > 0 && loaded && a.sdk.getStateAge() < 2000;
            };
            for (let t = 0; t < 90 && !fresh(); t++) await sleep(1000);
            emit(c.username, 'info', { summary: `ready (total level ${a.totalLevel()})` });
            await sleep(i * 6000); // stagger first decisions
            supervise(a);
        })
    );
    emit('party', 'info', { summary: `all ready, party total level ${partyTotal()}` });
    health.phase = 'running'; pulse();
    startCouncils();
    overviewReady=true;
    const supplyTick=createSupplyMonitor({ready:()=>overviewReady&&!shuttingDown,
        rows:()=>partySupplyCoverage(agents.values(),loadPlan(),bankOf,recentEvents()),
        notice:message=>{emit('overview','info',{summary:message});for(const a of agents.values())a.notice(message);},
        council:()=>requestCouncil('overview: supply coverage below refill threshold'),
    });
    const checkSupply=()=>{try{supplyTick();}catch(e){emit('overview','info',{summary:`supply check unavailable: ${String(e).slice(0,180)}`});}};
    setInterval(checkSupply,60_000);checkSupply();
    // The server logs out a client that stops answering (about 200 s of silence) and the page then sits
    // on "Connection lost" for good, while the agent keeps acting on its cached last state. A character whose
    // state has stopped updating gets a fresh login on the same page.
    const STALE_STATE_MS = 90_000;
    const RELOGIN_GAP_MS = 5 * 60_000;
    const relogged = new Map<string, number>();
    const relogging = new Set<string>();
    setInterval(async () => {
        if (shuttingDown) return;
        for (const [name, a] of agents) {
            const age = a.sdk.getStateAge();
            const page = pageByName.get(name);
            if (!page || relogging.has(name) || age < STALE_STATE_MS || Date.now() - (relogged.get(name) ?? 0) < RELOGIN_GAP_MS) continue;
            relogging.add(name);
            relogged.set(name, Date.now());
            emit(name, 'info', { summary: `no game state for ${Math.round(age / 1000)} s (connection lost): logging in again` });
            try {
                await openGame(page, name, ensureAccount(name));
                const up = Date.now();
                while (Date.now() - up < 60_000 && !(a.sdk.getState()?.inGame && a.sdk.getStateAge() < 2000)) await sleep(1000);
                emit(name, 'info', { summary: 'logged in again' });
                a.interrupt('Your connection to the game dropped and you were logged in again. Where you stand and what you carry now is what the game saved.');
            } catch (e: any) {
                emit(name, 'error', { error: `relogin: ${e?.message ?? e}` });
            } finally {
                relogging.delete(name);
            }
        }
    }, 30_000);
    // Achievements are read from each character's live state and last-seen bank.
    setInterval(() => {
        for (const [name, a] of agents) checkState(name, a.sdk.getState(), bankOf(name)?.items);
    }, 30_000);
}

main().catch(e => {
    console.error(e?.message ?? e);
    process.exit(1);
});
