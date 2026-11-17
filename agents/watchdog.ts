import { productiveBlockSignals } from './progress-signals';
// A model-free health check over the party's event log, run every few minutes. It prints
// what needs a look and exits 2 when anything does (0 when healthy), so a shell loop can wait
// on it and wake a reviewer only when needed.
//
//   bun agents/watchdog.ts                 # last 15 minutes
//   bun agents/watchdog.ts --minutes 60
//
import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadEvents } from './scorecard';
import { budgetLeft } from './llm';
import { controllerStale, readJson, type ControllerHealth } from './runtime-health';

const PARTY = new Set(['bram', 'wren', 'mike', 'trish']);
const arg = process.argv.indexOf('--minutes');
const minutes = arg > 0 ? +process.argv[arg + 1] : 15;
const now = Date.now();
const events = loadEvents(now - Math.max(minutes, 60) * 60_000).filter(e => PARTY.has(e.bot) || e.bot === 'party');
const recent = events.filter(e => e.t >= now - minutes * 60_000);
const flags: string[] = productiveBlockSignals(recent,now-minutes*60_000).map(s=>s.message);
// When each repeatable flag was last raised, so a long known wait does not wake the reviewer every check.
const SEEN = join(import.meta.dir, 'state', 'watchdog-seen.json');
const seen: Record<string, number> = existsSync(SEEN) ? JSON.parse(readFileSync(SEEN, 'utf-8')) : {};

let running = false;
try {
    running = execSync('pgrep -f "bun agents/orchestrator.ts"').toString().trim().length > 0;
} catch {
    // pgrep exits 1 when nothing matches
}
if (!running) flags.push('the orchestrator is not running');
const last = events.at(-1)?.t ?? 0;
const heartbeat = readJson<ControllerHealth>(join(import.meta.dir, 'state/controller-heartbeat.json'));
if (running && (!heartbeat || controllerStale(heartbeat, heartbeat.pid, heartbeat.startedAt))) flags.push('controller heartbeat is missing or stale');
if (running && now - last > 10 * 60_000 && (!heartbeat || now - heartbeat.at > 90_000)) flags.push(`no events for ${Math.round((now - last) / 60_000)} min`);

for (const bot of PARTY) {
    const mine = recent.filter(e => e.bot === bot);
    // The same block, again and again: something the agent cannot work out on its own.
    const blocks = new Map<string, number>();
    // A block after the step gained XP (ran out of bars on the way to a level) is not stuck.
    for (const e of mine) if (e.type === 'order_end' && e.outcome === 'blocked' && !Object.keys((e.xp as object) ?? {}).length) blocks.set(String(e.reason), (blocks.get(String(e.reason)) ?? 0) + 1);
    for (const [why, n] of blocks) if (n >= 4) flags.push(`${bot}: blocked ${n} times with "${why}"`);
    for (const e of mine) if (e.type === 'death') flags.push(`${bot}: ${e.summary}`);
    // The dashboard camera's own failures are not the character's.
    const errors = mine.filter(e => e.type === 'error' && !/^screenshot:/.test(String(e.error ?? '')));
    if (errors.length >= 3) flags.push(`${bot}: ${errors.length} errors, latest "${String(errors.at(-1)!.error ?? errors.at(-1)!.summary ?? '').slice(0, 120)}"`);
    const shots = mine.filter(e => e.type === 'error' && /^screenshot:/.test(String(e.error ?? '')));
    if (shots.length >= 3 && now - (seen['shots'] ?? 0) > 6 * 3600_000) {
        seen['shots'] = now;
        flags.push(`dashboard screenshots failing (${shots.length} for ${bot}): ${String(shots.at(-1)!.error).slice(0, 100)}`);
    }
    // An hour of steps that gained nothing at all (shorter waits on a council plan are normal).
    const steps = events.filter(e => e.bot === bot && e.type === 'order_end' && e.t >= now - 60 * 60_000);
    if (steps.length >= 6 && steps.every(e => / nothing gained /.test(String(e.summary)) && !Object.keys((e.xp as object) ?? {}).length)) {
        // A known wait is reported once every two hours, not on every check.
        if (now - (seen[`idle:${bot}`] ?? 0) > 2 * 3600_000) {
            seen[`idle:${bot}`] = now;
            flags.push(`${bot}: ${steps.length} steps in 60 min, none gained anything`);
        }
    }
}

// A spot written off as unusable (two failures): worth a look, since a wrong mark sends
// everyone the long way round (the Lumbridge furnace was once marked by a recipe failure).
for (const e of recent) if (e.type === 'info' && /spot marked unusable/.test(String(e.summary))) flags.push(String(e.summary));

// The machine slept or this loop lapsed: the log looks quiet but every connection may be stale.
const gap = now - (seen['lastRun'] ?? now);
if (gap > 75 * 60_000) flags.push(`the last check was ${Math.round(gap / 60_000)} min ago (the machine slept or the loop lapsed): connections may be stale`);
seen['lastRun'] = now;
// Cameras: every bot failing at once, or the newest picture is old, is no mute point.
const shotsDir = join(import.meta.dir, 'public', 'shots');
if (running && existsSync(shotsDir)) {
    const newest = Math.max(0, ...readdirSync(shotsDir).filter(f => f.endsWith('.jpg')).map(f => statSync(join(shotsDir, f)).mtimeMs));
    if (newest && now - newest > 15 * 60_000) flags.push(`no dashboard screenshot for ${Math.round((now - newest) / 60_000)} min`);
}

writeFileSync(SEEN, JSON.stringify(seen));

const left = budgetLeft();
if (left < 0.5) flags.push(`model budget nearly spent: $${left.toFixed(2)} left`);

console.log(flags.length ? flags.map(f => `- ${f}`).join('\n') : `healthy (${recent.length} events in ${minutes} min, $${left.toFixed(2)} budget left)`);
process.exit(flags.length ? 2 : 0);
