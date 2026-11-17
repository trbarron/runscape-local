import type { TeamGoal, PartyPlan } from './memory';
/** Ordinary repeated requests with no goal/progress/death change can wait for the hourly review. */
export function councilRequestSignature(goal: TeamGoal | undefined, deaths: [string, number][]): string {
    return JSON.stringify([goal?.key,goal?.title,goal?.set,
        goal?.milestones.map(m=>[m.id,m.done]),[...deaths].sort()]);
}
export interface OwnershipClaim {
    milestone_ids?: number[];
    commitment: string;
}
export const missingOwners = (goal: TeamGoal | undefined, claims: Iterable<OwnershipClaim>) => {
    const claimed = new Set([...claims].flatMap((c) => c.milestone_ids ?? []));
    return goal?.milestones.filter((m) => !m.done && !claimed.has(m.id)).map((m) => m.id) ?? [];
};
/** Preserve character choices where they claimed work; fill coverage gaps explicitly, never mark them done. */
export function assignCoverage(
    goal: TeamGoal | undefined,
    claims: Map<string, OwnershipClaim>,
    names: string[],
): NonNullable<PartyPlan['coverage']> {
    if (!goal || !names.length) return [];
    return goal.milestones
        .filter((m) => !m.done)
        .map((m, index) => {
            const required=m.auto?.check?.kind==='expedition'?m.auto.check.member:undefined;
            const claimant = [...claims].find(([name, c]) => names.includes(name) && c.milestone_ids?.includes(m.id))?.[0];
            const owner = required&&names.includes(required)?required:claimant ?? (names.includes(m.owner ?? '') ? m.owner! : names[index % names.length]);
            const task = m.auto?.check?.kind==='expedition'&&m.next?.owner===owner?m.next:goal.work?.find((w) => w.owner === owner) ?? m.next;
            const next = task
                ? `${task.owner}: ${task.action} (${task.target})${task.to ? ` to ${task.to}` : ''} — ${task.note}`
                : `choose a feasible next action for ${m.what} from live facts`;
            return {
                milestone: m.id,
                owner,
                next,
                fallback: m.fallback ?? 'Do useful independent work if blocked; report the dependency instead of waiting indefinitely.',
                source: claimant ? ('council' as const) : ('suggested' as const),
            };
        });
}

/** Retiring a goal preserves its unfinished checks; it is not an implicit completion. */
export function retainUnfinished(
    previous: TeamGoal | undefined,
    reason: string,
    history: NonNullable<PartyPlan['retiredMissions']> = [],
    now = Date.now(),
): NonNullable<PartyPlan['retiredMissions']> {
    return previous?.milestones.some((m) => !m.done) ? [...history, { goal: previous, reason, at: now }].slice(-10) : history;
}
