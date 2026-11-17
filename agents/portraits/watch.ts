// Check saves every five minutes; rendering happens only for changed appearances.
import { mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { emit } from '../events';
import { publishPortrait, publishing, closePublisher } from '../publish';
import { ANGLES, PORTRAIT_DIR, angleFile, readManifest, saveManifest } from './manifest';

const value = Number(process.env.PORTRAIT_EVERY_MS ?? 300_000);
const INTERVAL = Number.isFinite(value) ? Math.max(60_000, value) : 300_000;
let timer: ReturnType<typeof setTimeout> | undefined;
let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
let active: Promise<void> | undefined;
let stopped = true;

export async function refreshPortraits(): Promise<void> {
    if (child) return;
    mkdirSync(PORTRAIT_DIR, { recursive: true });
    child = Bun.spawn([process.execPath, join(import.meta.dir, 'render.ts'), '--out', PORTRAIT_DIR], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const running = child;
    const timeout = setTimeout(() => { if (running.exitCode === null) running.kill('SIGTERM'); }, 180_000);
    try {
        const [code, stdout, stderr] = await Promise.all([running.exited, new Response(running.stdout).text(), new Response(running.stderr).text()]);
        clearTimeout(timeout);
        if (code !== 0) throw new Error(`renderer exited ${code}: ${stderr.slice(-800)}`);
        if (stdout.trim() !== 'portraits are up to date') emit('party', 'info', { summary: `portraits: ${stdout.trim().slice(-500)}` });
        const manifest = readManifest();
        const published = readManifest(PORTRAIT_DIR, '.published.json');
        for (const [name, meta] of Object.entries(manifest)) {
            if (!['bram', 'wren', 'mike', 'trish'].includes(name)) continue;
            // Republish unchanged bytes too, refreshing the same seven-day TTL as screenshots.
            const views = (kind: 'head' | 'body') => Array.from({ length: ANGLES }, (_, a) => readFileSync(join(PORTRAIT_DIR, angleFile(name, kind, a))));
            if (!publishing() || await publishPortrait(name, views('head'), views('body'), meta.version)) published[name] = meta;
        }
        saveManifest(published, PORTRAIT_DIR, '.published.json');
    } finally {
        clearTimeout(timeout);
        child = undefined;
    }
}
export function startPortraits(): void {
    if (!stopped) return;
    stopped = false;
    const tick = async () => {
        active = refreshPortraits().catch(error => {
            if (!stopped) emit('party', 'error', { error: `portraits: ${error instanceof Error ? error.message : String(error)}` });
        });
        await active;
        active = undefined;
        if (!stopped) timer = setTimeout(tick, INTERVAL);
    };
    timer = setTimeout(tick, 45_000);
}
export async function stopPortraits(): Promise<void> {
    stopped = true;
    clearTimeout(timer);
    if (child?.exitCode === null) child.kill('SIGTERM');
    await active;
}
if (import.meta.main) {
    if (process.argv.includes('--once')) {
        try { await refreshPortraits(); } finally { await closePublisher(); }
    } else {
        startPortraits();
        const stop = async () => { await stopPortraits(); await closePublisher(); process.exit(0); };
        process.on('SIGTERM', stop);
        process.on('SIGINT', stop);
    }
}
