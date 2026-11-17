// The party's travel log: every walk a skill makes is recorded with how it went, so the
// characters learn from experience which roads are safe instead of being told.
import { load, save } from './store';
import { nearestLandmark } from './world';

export type Outcome = 'safe' | 'hurt' | 'died' | 'failed';

export interface Route {
    from: string;
    to: string;
    trips: number;
    safe: number;
    hurt: number;
    died: number;
    failed: number;
    last: { bot: string; t: number; outcome: Outcome; note?: string };
}

const routes = load<Record<string, Route>>('routes', {});

export function recordWalk(bot: string, from: { x: number; z: number }, to: { x: number; z: number }, outcome: Outcome, note?: string): void {
    if (bot === 'rascaltest') return; // the skill test character is not part of the party
    const a = nearestLandmark(from.x, from.z);
    const b = nearestLandmark(to.x, to.z);
    if (a === b) return;
    const key = `${a} -> ${b}`;
    const r = (routes[key] ??= { from: a, to: b, trips: 0, safe: 0, hurt: 0, died: 0, failed: 0, last: { bot, t: 0, outcome } });
    r.trips++;
    r[outcome]++;
    r.last = { bot, t: Date.now(), outcome, ...(note ? { note } : {}) };
    save('routes', routes);
}

const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60_000);
    return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/** The most recently walked routes, as the party remembers them. */
export function renderRoutes(limit = 12): string {
    const list = Object.values(routes)
        .sort((a, b) => b.last.t - a.last.t)
        .slice(0, limit);
    if (!list.length) return 'No journeys recorded yet.';
    return list
        .map(r => {
            const tally = (['safe', 'hurt', 'died', 'failed'] as const).filter(k => r[k]).map(k => `${r[k]} ${k}`).join(', ');
            return `- ${r.from} -> ${r.to}: ${r.trips} walked (${tally}); last ${r.last.bot}, ${r.last.outcome}, ${ago(r.last.t)}${r.last.note ? ` (${r.last.note})` : ''}`;
        })
        .join('\n');
}

export const allRoutes = () => Object.values(routes);
