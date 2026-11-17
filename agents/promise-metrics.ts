import type { AgentEvent } from './events';

/** Events belong to one character and the same reporting window. */
export function promiseMetrics(events: AgentEvent[]) {
    const created = new Map<number, number>();
    const resolved = new Map<number, { t: number; status: 'done' | 'dropped' }>();
    for (const e of events) {
        if (typeof e.id !== 'number' || !Number.isFinite(e.id)) continue;
        if (e.type === 'commit') created.set(e.id, Math.min(created.get(e.id) ?? Infinity, e.t));
        if (e.type === 'resolve' && (e.status === 'done' || e.status === 'dropped')) {
            if (!resolved.has(e.id) || resolved.get(e.id)!.t < e.t) resolved.set(e.id, { t: e.t, status: e.status });
        }
    }
    let done = 0, dropped = 0, carriedDone = 0, carriedDropped = 0;
    for (const [id, r] of resolved) {
        const made = created.get(id);
        if (made !== undefined) {
            if (r.t < made) continue;
            if (r.status === 'done') done++;
            else dropped++;
        } else if (r.status === 'done') carriedDone++;
        else carriedDropped++;
    }
    return { made: created.size, done, dropped, open: created.size - done - dropped, carriedDone, carriedDropped };
}
