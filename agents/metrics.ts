// Metrics computed from the event log, so live runs and old runs are measured the same way.
//
//   bun agents/metrics.ts                       # latest run
//   bun agents/metrics.ts agents/runs/<dir>     # a specific run
//
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { CHARACTERS, leanings, type Activity } from './characters';
import type { AgentEvent } from './events';
import { activeHours, loadEvents } from './scorecard';

import { promiseMetrics } from './promise-metrics';

const ACTIVITIES: Activity[] = ['mining', 'combat', 'woodcutting', 'fishing', 'thieving', 'crafting', 'errands'];

/** Spearman rank correlation, ties given their average rank. */
function spearman(a: number[], b: number[]): number | null {
    const rank = (xs: number[]) => {
        const sorted = xs.map((v, i) => ({ v, i })).sort((p, q) => p.v - q.v);
        const r = new Array(xs.length);
        for (let i = 0; i < sorted.length; ) {
            let j = i;
            while (j + 1 < sorted.length && sorted[j + 1].v === sorted[i].v) j++;
            for (let k = i; k <= j; k++) r[sorted[k].i] = (i + j) / 2 + 1;
            i = j + 1;
        }
        return r as number[];
    };
    const ra = rank(a);
    const rb = rank(b);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const ma = mean(ra);
    const mb = mean(rb);
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < ra.length; i++) {
        num += (ra[i] - ma) * (rb[i] - mb);
        da += (ra[i] - ma) ** 2;
        db += (rb[i] - mb) ** 2;
    }
    return da && db ? num / Math.sqrt(da * db) : null;
}

/** Share of input tokens served from the prompt cache. */
function cacheRate(spend: AgentEvent[]): number {
    const input = spend.reduce((s, e) => s + ((e.inTok as number) ?? 0), 0);
    const cached = spend.reduce((s, e) => s + ((e.cached as number) ?? 0), 0);
    return input ? +(cached / input).toFixed(2) : 0;
}

const triggerKind = (t: string): string => {
    if (/Council #\d+ finished/.test(t)) return 'council';
    if (/posted to you/.test(t)) return 'message';
    const m = t.match(/ended: (\w+)/) ?? t.match(/^Your routine "[^"]*" (\w+)/);
    if (m) return m[1] === 'interrupted' ? 'interrupted' : `order ${m[1]}`;
    if (/restart|arrived/.test(t)) return 'start';
    return 'other';
};

export function computeMetrics(events: AgentEvent[], now = Date.now()) {
    // Active time only: a sleeping laptop or a stopped party is not counted.
    const hours = Math.max(activeHours(events), 1 / 60);

    const bots = CHARACTERS.map(c => {
        const mine = events.filter(e => e.bot === c.username);
        const decisions = mine.filter(e => e.type === 'decision' && e.source !== 'cooldown');
        const orders = mine.filter(e => e.type === 'order_end');
        const spend = mine.filter(e => e.type === 'spend');
        const botHours = Math.max(activeHours(events.filter(e => e.t >= (mine[0]?.t ?? now))), 1 / 60);

        const time: Record<string, number> = {};
        let xp = 0;
        for (const o of orders) {
            time[o.activity as string] = (time[o.activity as string] ?? 0) + (o.durationMs as number);
            xp += Object.values((o.xp as Record<string, number>) ?? {}).reduce((s, v) => s + v, 0);
        }
        const worked = ACTIVITIES.reduce((s, a) => s + (time[a] ?? 0), 0);
        const total = worked + (time.rest ?? 0);
        const share = Object.fromEntries([...ACTIVITIES, 'rest'].map(a => [a, total ? (time[a] ?? 0) / total : 0]));

        const pulls = Object.fromEntries(leanings(c).map(l => [l.activity, l.pull]));
        const leant = ACTIVITIES.filter(a => a in pulls);
        const alignment = worked ? spearman(leant.map(a => pulls[a]), leant.map(a => time[a] ?? 0)) : null;

        const count = (xs: AgentEvent[], key: string) => xs.reduce<Record<string, number>>((m, e) => ((m[String(e[key])] = (m[String(e[key])] ?? 0) + 1), m), {});
        const triggers = decisions.reduce<Record<string, number>>((m, e) => {
            const k = triggerKind(String(e.trigger ?? ''));
            m[k] = (m[k] ?? 0) + 1;
            return m;
        }, {});

        const commitments = promiseMetrics(mine);

        return {
            name: c.username,
            decisions: decisions.length,
            // Rates are noise in the first minutes of a run.
            decisionsPerHour: botHours < 1 / 6 ? null : +(decisions.length / botHours).toFixed(1),
            cooldowns: mine.filter(e => e.type === 'decision' && e.source === 'cooldown').length,
            repeatRate: decisions.length ? +(decisions.filter(e => e.repeat).length / decisions.length).toFixed(2) : 0,
            llmCalls: spend.length,
            cacheHitRate: cacheRate(spend),
            costUsd: +spend.reduce((s, e) => s + (e.costUsd as number), 0).toFixed(4),
            triggers,
            outcomes: count(orders, 'outcome'),
            deaths: mine.filter(e => e.type === 'death').length,
            errors: mine.filter(e => e.type === 'error').length,
            xpPerHour: botHours < 1 / 6 ? null : Math.round(xp / botHours),
            timeShare: Object.fromEntries(Object.entries(share).map(([k, v]) => [k, +v.toFixed(2)])),
            leaningAlignment: alignment === null ? null : +alignment.toFixed(2),
            commitments
        };
    });

    const councils = events.filter(e => e.type === 'council' && e.phase === 'end');
    const cost = events.filter(e => e.type === 'spend').reduce((s, e) => s + (e.costUsd as number), 0);
    return {
        hours: +hours.toFixed(2),
        costUsd: +cost.toFixed(4),
        costPerHour: +(cost / hours).toFixed(4),
        cacheHitRate: cacheRate(events.filter(e => e.type === 'spend')),
        councils: councils.length,
        councilsAgreed: councils.filter(e => e.agreed).length,
        bots
    };
}

// Live: a rolling window across restarts, seeded from earlier runs' logs at start-up
// (events.ts only keeps the last 500 for the console).
export const WINDOW_MS = 3 * 3_600_000;
const all: AgentEvent[] = loadEvents(Date.now() - WINDOW_MS);
export const track = (e: AgentEvent) => all.push(e);
/** Items gained in a step, from its summary: "mine (copper): +350 Mining xp, +20 Copper ore -> done". */
const gains = (summary: string) => [...summary.split(' -> ')[0].matchAll(/\+(\d+) ([A-Z][^,]*?)(?=,|$)/g)].filter(m => !/ xp$/.test(m[2])).map(m => [m[2], +m[1]] as const);

/**
 * What the whole party produces per active hour over the window: items gained and XP by
 * skill. Fed to mission planning so milestones can be sized in hours.
 */
export function partyRates(limit = 12): string {
    const since = Date.now() - WINDOW_MS;
    const events = all.filter(e => e.t >= since && CHARACTERS.some(c => c.username === e.bot));
    const hours = activeHours(all.filter(e => e.t >= since));
    if (hours < 0.5) return 'Not enough play measured yet (under half an hour).';
    const items = new Map<string, number>();
    const xp = new Map<string, number>();
    for (const e of events) {
        if (e.type !== 'order_end' || e.action === 'withdraw_from_bank' || e.action === 'buy' || e.action === 'buy_tools') continue;
        for (const [name, n] of gains(String(e.summary ?? ''))) if (!/^coins$/i.test(name) || e.action === 'pickpocket') items.set(name, (items.get(name) ?? 0) + n);
        for (const [skill, v] of Object.entries((e.xp as Record<string, number>) ?? {})) xp.set(skill, (xp.get(skill) ?? 0) + v);
    }
    const rate = (n: number) => Math.round(n / hours);
    const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).slice(0, limit).filter(([, n]) => rate(n) > 0);
    // Each member's own XP rates and where their time went, by step (e.g. "fight (chicken)").
    const members = CHARACTERS.map(c => {
        const mine = events.filter(e => e.bot === c.username && e.type === 'order_end');
        const mx = new Map<string, number>();
        const time = new Map<string, number>();
        for (const e of mine) {
            for (const [skill, v] of Object.entries((e.xp as Record<string, number>) ?? {})) mx.set(skill, (mx.get(skill) ?? 0) + v);
            const step = String(e.summary ?? '').split(':')[0].replace(/ until .*$/, '').trim();
            if (step) time.set(step, (time.get(step) ?? 0) + Number(e.durationMs ?? 0));
        }
        const spent = [...time.values()].reduce((a, b) => a + b, 0);
        const most = [...time].sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, ms]) => spent && ms / spent >= 0.1);
        return `- ${c.username}: ${top(mx).slice(0, 4).map(([k, n]) => `${k} ~${rate(n).toLocaleString('en-US')}`).join(', ') || 'no XP'} XP/h; time on ${most.map(([k, ms]) => `${k} ${Math.round((100 * ms) / spent)}%`).join(', ') || 'nothing measured'}`;
    });
    return `Measured over the last ${hours.toFixed(1)} active hours, for the whole party:
Items per hour: ${top(items).map(([k, n]) => `${k} ~${rate(n)}`).join(', ') || 'none'}
XP per hour: ${top(xp).map(([k, n]) => `${k} ~${rate(n).toLocaleString('en-US')}`).join(', ') || 'none'}
Per member:
${members.join('\n')}`;
}

export const liveMetrics = () => {
    const since = Date.now() - WINDOW_MS;
    while (all.length && all[0].t < since) all.shift();
    return computeMetrics(all);
};

if (import.meta.main) {
    const runs = join(import.meta.dir, 'runs');
    let dir = process.argv[2];
    if (!dir) {
        const latest = readdirSync(runs).filter(d => existsSync(join(runs, d, 'events.jsonl'))).sort().at(-1);
        if (!latest) throw new Error('no runs yet');
        dir = join(runs, latest);
    }
    const file = dir.endsWith('.jsonl') ? dir : join(dir, 'events.jsonl');
    const events = readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as AgentEvent);
    const m = computeMetrics(events, events.at(-1)?.t);
    console.log(`${file}\n${m.hours} h | $${m.costUsd} ($${m.costPerHour}/h) | cache ${Math.round(m.cacheHitRate * 100)}% | councils ${m.councils} (${m.councilsAgreed} agreed)\n`);
    console.table(
        m.bots.map(b => ({
            bot: b.name,
            'decisions/h': b.decisionsPerHour,
            repeat: b.repeatRate,
            cost: b.costUsd,
            cache: b.cacheHitRate,
            deaths: b.deaths,
            'xp/h': b.xpPerHour,
            leaning: b.leaningAlignment,
            rest: b.timeShare.rest,
            promises: `${b.commitments.done}/${b.commitments.made} new promises kept, ${b.commitments.dropped} dropped; earlier promises: ${b.commitments.carriedDone} kept, ${b.commitments.carriedDropped} dropped`
        }))
    );
    for (const b of m.bots) console.log(b.name, 'triggers', b.triggers, 'outcomes', b.outcomes);
}
