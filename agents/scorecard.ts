// Before/after view of each change to the agents: the event history is split at the
// entries in changes.json, and each window is measured on active time only (gaps of more
// than 10 minutes, such as a sleeping laptop, are left out).
//
//   bun agents/scorecard.ts                          # table of every change
//   bun agents/scorecard.ts --json                   # the same, as JSON
//   bun agents/scorecard.ts mark "Name" "What changed"   # start a new window now
//
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AgentEvent } from './events';

const RUNS = join(import.meta.dir, 'runs');
const CHANGES = join(import.meta.dir, 'changes.json');
const MAX_GAP_MS = 10 * 60_000;
const PARTY = new Set(['bram', 'wren', 'mike', 'trish']);

export interface Change {
    t: string;
    name: string;
    note: string;
}

const MAKING = /^(smithing|cooking|crafting|fletching|firemaking)$/i;
const GATHERING = /^(mining|woodcutting|fishing)$/i;
const COMBAT = /^(attack|strength|defence|hitpoints|ranged|prayer|magic)$/i;

export const loadChanges = (): Change[] => (existsSync(CHANGES) ? (JSON.parse(readFileSync(CHANGES, 'utf-8')) as Change[]) : []);

export function loadEvents(since = 0): AgentEvent[] {
    if (!existsSync(RUNS)) return [];
    const events: AgentEvent[] = [];
    for (const dir of readdirSync(RUNS)) {
        const file = join(RUNS, dir, 'events.jsonl');
        if (!existsSync(file)) continue;
        for (const line of readFileSync(file, 'utf-8').split('\n')) {
            if (!line) continue;
            try {
                const e = JSON.parse(line) as AgentEvent;
                if (e.t >= since) events.push(e);
            } catch {
                // a line cut short by a crash
            }
        }
    }
    return events.sort((a, b) => a.t - b.t);
}

/** Hours with the party actually running: the sum of gaps between events, long gaps left out. */
export function activeHours(events: AgentEvent[]): number {
    let ms = 0;
    for (let i = 1; i < events.length; i++) {
        const gap = events[i].t - events[i - 1].t;
        if (gap <= MAX_GAP_MS) ms += gap;
    }
    return ms / 3_600_000;
}

const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
};

function measure(events: AgentEvent[]) {
    const hours = activeHours(events);
    const perHour = (n: number) => (hours >= 0.1 ? +(n / hours).toFixed(1) : null);
    const party = events.filter(e => PARTY.has(e.bot));
    const decisions = party.filter(e => e.type === 'decision' && e.source !== 'cooldown');
    const steps = party.filter(e => e.type === 'order_end');
    // Steps cut short by stopping the party are about the operator, not the agents.
    const ours = steps.filter(e => !/shutting down/.test(String(e.reason ?? '')));
    const share = (outcome: string) => (ours.length ? +(ours.filter(e => e.outcome === outcome).length / ours.length).toFixed(2) : null);
    const xp = { making: 0, gathering: 0, combat: 0, thieving: 0 };
    for (const s of steps) {
        for (const [skill, v] of Object.entries((s.xp as Record<string, number>) ?? {})) {
            if (MAKING.test(skill)) xp.making += v;
            else if (GATHERING.test(skill)) xp.gathering += v;
            else if (COMBAT.test(skill)) xp.combat += v;
            else if (/thieving/i.test(skill)) xp.thieving += v;
        }
    }
    const spend = events.filter(e => e.type === 'spend');
    const cost = spend.reduce((s, e) => s + ((e.costUsd as number) ?? 0), 0);
    const input = spend.reduce((s, e) => s + ((e.inTok as number) ?? 0), 0);
    const cached = spend.reduce((s, e) => s + ((e.cached as number) ?? 0), 0);
    const total = xp.making + xp.gathering + xp.combat + xp.thieving;
    return {
        activeHours: +hours.toFixed(2),
        decisionsPerHour: perHour(decisions.length),
        cooldownsPerHour: perHour(party.filter(e => e.type === 'decision' && e.source === 'cooldown').length),
        stepsPerHour: perHour(steps.length),
        medianStepSeconds: median(steps.map(e => (e.durationMs as number) / 1000)),
        blocked: share('blocked'),
        interrupted: share('interrupted'),
        xpPerHour: perHour(Math.round(total)),
        xpShare: Object.fromEntries(Object.entries(xp).map(([k, v]) => [k, total ? +(v / total).toFixed(2) : 0])),
        deaths: party.filter(e => e.type === 'death').length,
        milestones: events.filter(e => e.type === 'council' && e.phase === 'milestone').length,
        postsPerHour: perHour(party.filter(e => e.type === 'chat').length),
        achievementsPerHour: perHour(party.filter(e => e.type === 'achievement').length),
        costPerHour: hours >= 0.1 ? +(cost / hours).toFixed(3) : null,
        cacheHitRate: input ? +(cached / input).toFixed(2) : null
    };
}

export function computeScorecard(now = Date.now()) {
    const changes = loadChanges();
    const events = loadEvents();
    return changes.map((c, i) => {
        const from = Date.parse(c.t);
        const to = i + 1 < changes.length ? Date.parse(changes[i + 1].t) : now;
        return { ...c, from, to, ...measure(events.filter(e => e.t >= from && e.t < to)) };
    });
}

if (import.meta.main) {
    const [cmd, name, note] = process.argv.slice(2);
    if (cmd === 'mark') {
        if (!name) throw new Error('usage: bun agents/scorecard.ts mark "Name" "What changed"');
        const changes = loadChanges();
        changes.push({ t: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), name, note: note ?? '' });
        writeFileSync(CHANGES, JSON.stringify(changes, null, 4) + '\n');
        console.log(`marked "${name}"; commit changes.json with the change it describes`);
    } else if (cmd === '--json') {
        console.log(JSON.stringify(computeScorecard(), null, 2));
    } else {
        const rows = computeScorecard();
        console.table(
            rows.map(r => ({
                change: r.name,
                'active h': r.activeHours,
                'decisions/h': r.decisionsPerHour,
                'cooldowns/h': r.cooldownsPerHour,
                'steps/h': r.stepsPerHour,
                'median step s': r.medianStepSeconds,
                blocked: r.blocked,
                interrupted: r.interrupted,
                'posts/h': r.postsPerHour,
                'achiev/h': r.achievementsPerHour,
                'xp/h': r.xpPerHour,
                'making xp': r.xpShare.making,
                deaths: r.deaths,
                milestones: r.milestones,
                '$/h': r.costPerHour
            }))
        );
    }
}
