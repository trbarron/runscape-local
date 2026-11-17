import { opportunityPool } from './opportunities';
import { captureGameShot, storeGameShot } from './game-shots';
import { readManifest, PORTRAIT_DIR } from './portraits/manifest';
// Dashboard: periodic screenshots + a snapshot.json + a static page, all written into
// agents/public/ (copy that folder to any web host) and also served live on :7790.
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, renameSync } from 'fs';
import { join, extname } from 'path';
import { agents, partyTotal } from './party';
import { recentPosts } from './board';
import { CHARACTERS, leanings, leaningLabel } from './characters';
import { loadPlan } from './memory';
import { buildMenu, evaluate, explainMenu, liveContext } from './missions';
import { liveMetrics } from './metrics';
import { missingTools } from './planner';
import { LANDMARKS, locationLabel } from './world';
import { emit, subscribe, type AgentEvent } from './events';
import { load, save } from './store';
import { computeScorecard } from './scorecard';
import { allRoutes } from './routes';
import { bankOf } from './banks';
import { openWants } from './wants';
import { allAchievements } from './achievements';
import { assetBase, publishShot, publishSnapshot, publishing } from './publish';
import { splitSnapshot } from './lanes';

const PUBLIC = join(import.meta.dir, 'public');
export const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT ?? 7790);
const shotInterval = Number(process.env.SHOT_EVERY_MS ?? 600_000);
const SHOT_EVERY_MS = Number.isFinite(shotInterval) ? Math.max(60_000, shotInterval) : 600_000;
const startedAt = Date.now();
const shotAt = new Map<string, number>();
const publishedShots = load<Record<string, number>>('published-shots', {});

// Position trails (every 15s, last ~10 min) and total-level history (every minute, kept
// across restarts) for the map and the chart.
const TRAIL_POINTS = 40;
const trails = new Map<string, { x: number; z: number }[]>();
const history = load('history', { samples: [] as { t: number; levels: Record<string, number> }[] });

// The decision log: notable events, newest last, kept across restarts.
const LOG_TYPES = new Set(['decision', 'order_end', 'death', 'trade', 'council', 'commit', 'resolve', 'lookup']);
const log = load('log', { entries: [] as { t: number; bot: string; kind: string; title: string; detail?: string }[] });

function toLogEntry(e: AgentEvent): { kind: string; title: string; detail?: string } {
    const s = (v: unknown) => (v == null ? '' : String(v));
    switch (e.type) {
        case 'decision':
            return { kind: e.source === 'cooldown' ? 'cooldown' : 'decided', title: s(e.summary).split(' | ')[0], detail: s(e.thought) || undefined };
        case 'order_end': {
            const summary = s(e.summary);
            return { kind: s(e.outcome), title: summary.slice(summary.indexOf(': ') + 2) };
        }
        case 'lookup':
            return { kind: 'lookup', title: `asked the atlas: "${s(e.query)}"`, detail: s(e.summary).replace(/^looked up "[^"]*": /, '') || undefined };
        case 'commit':
        case 'resolve':
            return { kind: 'promise', title: s(e.summary) };
        default:
            return { kind: e.type, title: s(e.summary) };
    }
}

function sampleTrails(): void {
    for (const a of agents.values()) {
        const p = a.sdk.getState()?.player;
        if (!p) continue;
        const t = trails.get(a.name) ?? [];
        const last = t.at(-1);
        if (!last || last.x !== p.worldX || last.z !== p.worldZ) t.push({ x: p.worldX, z: p.worldZ });
        if (t.length > TRAIL_POINTS) t.shift();
        trails.set(a.name, t);
    }
}

function recordLevels(): void {
    const levels: Record<string, number> = {};
    for (const a of agents.values()) if (a.sdk.getState()?.inGame) levels[a.name] = a.totalLevel();
    if (!Object.keys(levels).length) return;
    history.samples.push({ t: Date.now(), levels });
    if (history.samples.length > 3000) history.samples.splice(0, history.samples.length - 3000);
    save('history', history);
}

/** At most n samples, evenly spaced, always keeping the latest. */
function downsample<T>(xs: T[], n: number): T[] {
    if (xs.length <= n) return xs;
    const step = xs.length / n;
    const out = Array.from({ length: n - 1 }, (_, i) => xs[Math.floor(i * step)]);
    out.push(xs[xs.length - 1]);
    return out;
}

interface Deps {
    browser: any;
    /** Each bot's game page, for JPEG screenshots straight from its canvas. */
    pages: Map<string, any>;
    gameUrl: string;
    spend: () => { spentUsd: number; budgetUsd: number; calls: number; model: string };
}

// The scorecard reads every run's event log, so it is refreshed every few minutes only.
let card: { at: number; rows: ReturnType<typeof computeScorecard> } = { at: 0, rows: [] };
function scorecard() {
    if (Date.now() - card.at > 5 * 60_000) card = { at: Date.now(), rows: computeScorecard() };
    return card.rows.map(({ t, name, note, from, to, activeHours, decisionsPerHour, stepsPerHour, medianStepSeconds, blocked, interrupted, postsPerHour, xpPerHour, xpShare, deaths, milestones, costPerHour }) => ({
        t, name, note, from, to, activeHours, decisionsPerHour, stepsPerHour, medianStepSeconds, blocked, interrupted, postsPerHour, xpPerHour, xpShare, deaths, milestones, costPerHour
    }));
}

function snapshot(deps: Deps) {
    const metrics = liveMetrics();
    const portraits = readManifest(PORTRAIT_DIR, '.published.json');
    const bots = [...agents.values()].map(a => {
        const c = a.character;
        const st = a.sdk.getState();
        const p = st?.player;
        const m = metrics.bots.find(b => b.name === a.name);
        return {
            name: a.name,
            epithet: [c.race, c.class].filter(Boolean).join(" "),
            background: c.background,
            trait: c.trait,
            abilities: c.abilities,
            leans: leanings(c).slice(0, 2).map(l => leaningLabel(l.activity)),
            totalLevel: a.totalLevel(),
            combat: p?.combatLevel ?? null,
            hp: p ? { cur: p.hp, max: p.maxHp } : null,
            action: a.activityLabel(),
            actionSince: a.orderSince,
            location: p ? locationLabel(p.worldX, p.worldZ) : 'unknown',
            pos: p ? { x: p.worldX, z: p.worldZ } : null,
            trail: trails.get(a.name) ?? [],
            skills: (st?.skills ?? []).map(s => ({ name: s.name, level: s.baseLevel })),
            missing: st ? missingTools(a) : [],
            goal: a.memory.goal,
            routine: a.routine && { name: a.routine.name, repeat: a.routine.repeat, step: a.routineStep, steps: a.routine.steps.map(o => o.label) },
            bank: bankOf(a.name) ?? null,
            deaths: a.memory.deaths,
            lastResult: a.history.at(-1) ?? null,
            shotAt: shotAt.get(a.name) ?? 0,
            portraitVersion: portraits[a.name]?.version,
            portraitAngles: portraits[a.name]?.angles,
            portraitAt: portraits[a.name]?.renderedAt,
            metrics: m && {
                decisionsPerHour: m.decisionsPerHour,
                repeatRate: m.repeatRate,
                xpPerHour: m.xpPerHour,
                leaningAlignment: m.leaningAlignment,
                rest: m.timeShare.rest,
                commitments: m.commitments,
                costUsd: m.costUsd,
                cacheHitRate: m.cacheHitRate
            }
        };
    });
    const s = deps.spend();
    const plan = loadPlan();
    return {
        generatedAt: Date.now(),
        lastEventAt,
        uptimeMin: Math.round((Date.now() - startedAt) / 60_000),
        partyTotal: partyTotal(),
        bots,
        plan: plan.council ? { council: plan.council, made: plan.made, agreed: plan.agreed, entries: plan.entries } : null,
        teamGoal: plan.teamGoal ?? null,
        board: recentPosts(14),
        log: log.entries.slice(-150),
        history: downsample(history.samples, 240),
        landmarks: LANDMARKS,
        routes: allRoutes()
            .sort((x, y) => y.last.t - x.last.t)
            .slice(0, 40),
        wants: openWants(),
        achievements: allAchievements(),
        scorecard: scorecard(),
        party: { costPerHour: metrics.costPerHour, cacheHitRate: metrics.cacheHitRate, councils: metrics.councils, councilsAgreed: metrics.councilsAgreed },
        spend: { usd: Number(s.spentUsd.toFixed(4)), budgetUsd: s.budgetUsd, calls: s.calls, model: s.model }
    };
}

/** When a character last did or decided anything: tells a moving party from a frozen one. */
let lastEventAt = Date.now();

async function takeShots(deps: Deps) {
    for (const a of agents.values()) {
        // Preserve the last good image when a client is offline or still logging in.
        if (!a.sdk.getState()?.inGame || a.sdk.getStateAge() > 30_000) continue;
        try {
            const jpeg = await captureGameShot(a.name, deps.pages, deps.browser);
            await storeGameShot(jpeg, Date.now(), {
                local: (bytes, at) => {
                    const file = join(PUBLIC, 'shots', `${a.name}.jpg`);
                    writeFileSync(file + '.tmp', bytes);
                    renameSync(file + '.tmp', file);
                    shotAt.set(a.name, at);
                },
                publish: bytes => publishShot(a.name, bytes),
                published: at => { publishedShots[a.name] = at; save('published-shots', publishedShots); }
            });
        } catch (e: any) {
            emit(a.name, 'error', { error: `screenshot: ${e?.message ?? e}` });
        }
    }
}

export function startDashboard(deps: Deps) {
    mkdirSync(join(PUBLIC, 'shots'), { recursive: true });
    // Show the last screenshots from before a restart until fresh ones arrive.
    for (const name of agents.keys()) {
        const f = join(PUBLIC, 'shots', `${name}.jpg`);
        if (existsSync(f)) shotAt.set(name, statSync(f).mtimeMs);
    }
    subscribe(e => {
        if (e.bot !== 'party' && e.type !== 'error') lastEventAt = e.t;
        if (!LOG_TYPES.has(e.type) || e.bot === 'party') return;
        log.entries.push({ t: e.t, bot: e.bot, ...toLogEntry(e) });
        if (log.entries.length > 400) log.entries.splice(0, log.entries.length - 400);
    });
    const write = () => {
        const data = snapshot(deps);
        writeFileSync(join(PUBLIC, 'snapshot.json'), JSON.stringify(data));
        // A new cache-busting timestamp must refer to bytes confirmed in Redis, not just on disk.
        const remote = { ...data, assetBase: assetBase(), bots: data.bots.map(bot => ({ ...bot, shotAt: Date.now() - (publishedShots[bot.name] ?? 0) < 7 * 24 * 3600_000 ? publishedShots[bot.name] : 0 })) };
        publishSnapshot(splitSnapshot(remote));
    };
    write();
    setInterval(() => {
        sampleTrails();
        write();
        save('log', log);
    }, 15_000);
    setInterval(recordLevels, 60_000);
    setTimeout(function loop() {
        takeShots(deps).finally(() => setTimeout(loop, SHOT_EVERY_MS));
    }, 45_000);

    const types: Record<string, string> = { '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
    Bun.serve({
        port: DASHBOARD_PORT,
        hostname: '127.0.0.1',
        fetch(req) {
            const url = new URL(req.url);
            if (url.pathname === '/snapshot.json') return Response.json(snapshot(deps), { headers: { 'cache-control': 'no-store' } });
            if (url.pathname === '/menu.json') {
                const ctx = liveContext(agents.values(), CHARACTERS.length);
                const plan = loadPlan();
                const exclude = [plan.teamGoal?.key ?? plan.teamGoal?.title ?? '', ...(plan.pastMissions ?? [])];
                const pool = opportunityPool.get(ctx, exclude);
                return Response.json(
                    {
                        generatedAt: pool.generatedAt,
                        eligibleCount: pool.eligibleCount,
                        why: pool.why,
                        menu: pool.menu.map((m) => ({
                            ...m,
                            milestones: m.milestones.map((x) => ({
                                what: x.what,
                                needs: x.needs,
                                progress: evaluate(x.check, ctx).progress,
                            })),
                        })),
                    },
                    { headers: { 'cache-control': 'no-store' } },
                );
            }
            if (url.pathname === '/metrics.json') return Response.json(liveMetrics(), { headers: { 'cache-control': 'no-store' } });
            const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
            const file = join(PUBLIC, rel);
            if (!file.startsWith(PUBLIC) || !existsSync(file)) return new Response('not found', { status: 404 });
            return new Response(readFileSync(file), { headers: { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' } });
        }
    });
    emit('party', 'info', { summary: `dashboard on http://localhost:${DASHBOARD_PORT} (static copy in agents/public/)${publishing() ? '; publishing to Redis for the website' : ''}` });
}
