import { createHash } from 'crypto';
import { opportunityMenu, missionBlockers, type Ctx } from './missions';
import { sites } from './mission-chain';

export const MENU_REFRESH_MS = 5 * 60_000;
/** Cheap fact-driven cache. Refreshing offers never mutates the active mission or party plan. */
export class OpportunityPool {
    private cached?: ReturnType<typeof opportunityMenu> & { generatedAt: number; fingerprint: string };
    constructor(private readonly build = opportunityMenu) {}
    get(ctx: Ctx, exclude: string[] = [], now = Date.now(), force = false) {
        const canonical = (obj: Record<string, unknown>) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
        const input = {
            members: [...ctx.members]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((m) => ({
                    ...m,
                    worn: [...m.worn].sort(),
                    skills: canonical(m.skills),
                    carried: canonical(m.carried),
                    bank: canonical(m.bank),
                })),
            size: ctx.size,
            sharedProjects:!!ctx.sharedProjects,
            exclude,
            sites: sites(ctx),
            kills: [
                ...new Set(
                    sites(ctx)
                        .filter((s) => s.kind === 'monster')
                        .map((s) => s.type),
                ),
            ]
                .sort()
                .map((type) => [type, ctx.has(`kill:${type}`)]),
        };
        const fingerprint = createHash('sha1').update(JSON.stringify(input)).digest('hex');
        if (force || !this.cached || this.cached.fingerprint !== fingerprint || now - this.cached.generatedAt >= MENU_REFRESH_MS)
            this.cached = { ...this.build(ctx, exclude), generatedAt: now, fingerprint };
        return this.cached;
    }
}
export const opportunityPool = new OpportunityPool();

export interface ActiveMission {
    mission: string;
    milestones: { done: boolean; auto?: { check?: import('./missions').Check } }[];
}
/** The council counter is intentionally irrelevant: work reassignment is not mission replacement. */
export function missionSelectionReason(goal: ActiveMission | undefined, ctx: Ctx, rescope?: string): string | null {
    if (ctx.members.length < ctx.size) return null;
    if (rescope) return rescope;
    if (!goal?.mission) return 'the party has no mission';
    if (goal.milestones.length && goal.milestones.every((m) => m.done))
        return goal.milestones.some(m=>m.auto?.check?.kind==='hunt')?null:'all mission milestones are complete';
    // Lost tools/funding are recoverable dependencies, not grounds to abandon a chosen mission.
    const blockers = missionBlockers(goal, ctx).filter(
        (reason) => !reason.includes('cannot fund') && !reason.startsWith('no complete training chain'),
    );
    return blockers.length ? `current mission is not executable: ${blockers.join('; ')}` : null;
}
