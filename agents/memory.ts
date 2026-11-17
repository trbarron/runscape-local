import type { MissionWork } from './mission-chain';
import type { BlockedOption } from './blocked-options';
// Per-agent memory (goal, commitments, notes) and the party plan agreed in council.
import { allAchievements } from './achievements';
import { armourProgress, outfitProgress } from './armour';
import { evaluate, liveContext, type Check } from './missions';
import { agents } from './party';
import { CHARACTERS } from './characters';
import { load, save } from './store';

export interface Commitment {
    id: number;
    /** Who it was promised to ('all' for the party). */
    to: string;
    what: string;
    made: number;
    status: 'open' | 'done' | 'dropped';
    closed?: number;
}

export interface Memory {
    /** Accepted decision following the optional ambition invitation; no repeated prompt this pilot. */
    ambitionInvitedAt?: number;
    /** Recent deterministic blockers, invalidated by relevant facts or a bounded expiry. */
    blockedOptions?: BlockedOption[];
    goal: string;
    commitments: Commitment[];
    /** Compressed long-term notes, rewritten by reflection. */
    notes: string;
    deaths: number;
    decisions: number;
    lastReflection: number;
    /** The one-time starter tool kit has been handed out (later losses stay lost). */
    kitGiven?: boolean;
    /** The routine being run and the step it is on, so a restart carries on without a decision. */
    routine?: { saved: number; name: string; repeat: boolean; steps: unknown[]; from: { step: number; loops: number } };
    /** The character's own fight rules (see skills.ts Tactics). */
    tactics?: Record<string, unknown>;
}

let nextCommitment = 1;

export function loadMemory(name: string): Memory {
    const m = load<Memory>(`memory-${name}`, { goal: '', commitments: [], notes: '', deaths: 0, decisions: 0, lastReflection: 0 });
    for (const c of m.commitments) nextCommitment = Math.max(nextCommitment, c.id + 1);
    return m;
}

export const saveMemory = (name: string, m: Memory) => save(`memory-${name}`, m);

export function commit(m: Memory, to: string, what: string): Commitment {
    const c: Commitment = { id: nextCommitment++, to, what: what.slice(0, 160), made: Date.now(), status: 'open' };
    m.commitments.push(c);
    // Keep the open ones plus the 10 most recently closed.
    const closed = m.commitments.filter((x) => x.status !== 'open').slice(-10);
    m.commitments = [...m.commitments.filter((x) => x.status === 'open'), ...closed].sort((a, b) => a.id - b.id);
    return c;
}

export interface Milestone {
    id: number;
    what: string;
    /** Who (or which strengths) it takes; every milestone needs at least two members. */
    needs: string;
    done: boolean;
    doneAt?: number;
    /** Checked by the game, not by vote: the achievements ledger reaching a count, or everyone wearing armour. */
    owner?: string;
    next?: MissionWork;
    fallback?: string;
    auto?: { achievements?: number; armour?: boolean; outfit?: boolean; check?: Check };
}

/** The party's mission: a long-running vision, broken into collaborative milestones. */
export interface TeamGoal {
    key?: string;
    template?: string;
    work?: MissionWork[];
    mission: string;
    title: string;
    why: string;
    milestones: Milestone[];
    proposedBy: string;
    council: number;
    set: number;
    unanimous: boolean;
}

export interface PartyPlan {
    council: number;
    made: number;
    reason: string;
    agreed: boolean;
    entries: Record<string, { commitment: string; asks: { to: string; what: string }[] }>;
    teamGoal?: TeamGoal;
    /** The actions the party could take when this plan was made. */
    actions?: string[];
    /** Set (with a reason) to hold a mission session at the next council, before its turn. */
    rescope?: string;
    /** Explicit operator/user mission change may bypass automatic council cooldown once. */
    operatorRescope?: boolean;
    /** Set once the one-off outfit refresh milestone has been added to a mission. */
    outfitAsked?: boolean;
    /** Titles of the last few missions, newest first; the menu skips them. A rebuilt plan must carry it. */
    pastMissions?: string[];
    /** Explicitly preserve unfinished objectives when rescoping an infeasible mission. */
    retiredMissions?: { goal: TeamGoal; reason: string; at: number }[];
    coverage?: { milestone: number; owner: string; next: string; fallback: string; source: 'council' | 'suggested' }[];
}

export const loadPlan = () => load<PartyPlan>('plan', { council: 0, made: 0, reason: '', agreed: false, entries: {} });
export const savePlan = (p: PartyPlan) => save('plan', p);

export function renderGoal(g: TeamGoal | undefined): string {
    if (!g?.mission) return 'Mission: none yet (the next council will set one).';
    const steps = g.milestones
        .map(
            (m) =>
                `  [${m.done ? 'x' : ' '}] M${m.id}: ${m.what}${m.owner ? ` [owner ${m.owner}]` : ''} (needs ${m.needs})${m.auto && !m.done ? (m.auto.check ? ` - ${evaluate(m.auto.check, liveContext(agents.values(), CHARACTERS.length)).progress}; the game checks it, no vote` : m.auto.outfit ? ` - ${outfitProgress()}; read from what you wear, no vote` : m.auto.armour ? ` - ${armourProgress()}` : ` - ${allAchievements().length} of ${m.auto.achievements} unlocked so far; the game's ledger records it, no vote`) : ''}`,
        )
        .join('\n');
    const next = g.milestones.find((m) => !m.done);
    const field=g.milestones.some(m=>m.auto?.check?.kind==='expedition');
    return `Mission (${g.proposedBy === 'operator' ? 'operator assignment; last council #' : 'council #'}${g.council}${g.unanimous ? ', unanimous' : ''}): "${g.title}" ${g.mission}\nWhy: ${g.why}\nMilestones:\n${steps}\n${next ? (field?'Contribute in parallel: every member has a named survey/test; coordinate three different field activities. Do not wait for M1 before doing your own contribution.':`Next milestone: M${next.id}.`) : 'All milestones done: the next council should set new ones.'}${g.work?.length ? `\n${field?'FIELDWORK OPTIONS (alternatives, not a routine to execute in full; choose contributions together)':'SUPPORTED WORK CHAIN (suggested owners; agree changes only if the replacement can do the work)'}:\n${g.work.map((w) => `- ${w.owner}: ${w.action} (${w.target})${w.to ? ` to ${w.to}` : ''}${w.amount ? ` x${w.amount}` : ''} — ${w.note}`).join('\n')}` : ''}`;
}

export function renderPlan(p: PartyPlan): string {
    if (!p.council) return `${renderGoal(p.teamGoal)}\n(no work split yet; a council will set one)`;
    const age = Math.round((Date.now() - p.made) / 60_000);
    const coverage = p.coverage?.map((c) => `M${c.milestone}: ${c.owner} owns next action ${c.next}; fallback: ${c.fallback}`).join('\n');
    const lines = Object.entries(p.entries).map(([name, e]) => {
        const asks = e.asks.map((a) => `asks ${a.to}: ${a.what}`).join('; ');
        return `- ${name}: ${e.commitment}${asks ? ` (${asks})` : ''}`;
    });
    return `${renderGoal(p.teamGoal)}\nWork split from council #${p.council}, ${age} min ago, ${p.agreed ? 'agreed by all' : 'no full agreement'}:\n${lines.join('\n')}${coverage ? `\nOBJECTIVE OWNERSHIP\n${coverage}` : ''}`;
}
