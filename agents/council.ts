import {recordHuntGoal} from './hunt';
import {bindExpedition,mergeFieldProgress,recordFieldGoal} from './expedition';
import type {AgentEvent} from './events';
import { opportunityPool, missionSelectionReason } from './opportunities';
import { councilRequestSignature, missingOwners, assignCoverage, retainUnfinished } from './mission-coordination';
// Council: a short, bounded negotiation where all four agents talk in turn (up to three
// rounds) until they agree who does what. The result is pinned as the party plan, and
// everyone is interrupted to re-plan around it. Held at start-up, every hour, or
// when an agent says the plan no longer works (at most every 15 minutes).
import { agents } from './party';
import { councilPosts, post } from './board';
import { loadPlan, savePlan, type Milestone, type PartyPlan, type TeamGoal } from './memory';
import { allAchievements } from './achievements';
import { armourStatus, outfitStatus } from './armour';
import { evaluate, liveContext, refreshMissionWork, missionBlockers } from './missions';
import { CHARACTERS } from './characters';
import { councilTurn, goalTurn, type CouncilTurn, type Proposal } from './planner';
import type { Agent } from './agent';
import { emit } from './events';
import { SKILLS } from './skills';
import { budgetLeft } from './llm';

const EVERY_MS = 60 * 60_000;
const MIN_GAP_MS = 15 * 60_000;
const ROUNDS = 3;
/** Set when the game closes a milestone by itself, until a council has re-split the work. */
let staleSplit: string | undefined;
/** Every mission carries one milestone the game's achievements ledger checks: this many new unlocks. */
const ACHIEVEMENT_STEP = 5;

let running = false;

/** The action set before plans recorded their own (so older plans compare against it). */
const BASELINE = [
    'chop_trees',
    'fish',
    'mine',
    'fight',
    'bank_resources',
    'sell_to_shop',
    'buy_tools',
    'bury_bones',
    'withdraw_from_bank',
    'rest',
];
/** Actions added since the current plan was made. */
const newActions = (plan: PartyPlan) => Object.keys(SKILLS).filter((a) => !(plan.actions ?? BASELINE).includes(a));
let lastHeld = loadPlan().made;

let lastRequestedSignature: string | undefined;
export function requestCouncil(by: string): string | void {
    const plan=loadPlan();
    if(!plan.rescope&&plan.teamGoal?.milestones.every(m=>m.done)&&plan.teamGoal.milestones.some(m=>m.auto?.check?.kind==='hunt'))return;
    if (running || Date.now() - lastHeld < MIN_GAP_MS) return;
    const signature = councilRequestSignature(plan.teamGoal, [...agents.values()].map(a=>[a.name,a.memory.deaths]));
    if (signature === lastRequestedSignature && Date.now() - lastHeld < EVERY_MS)
        return 'Council already reviewed these unchanged milestones; continue coordination or feasible work until the hourly review. New game progress or death permits reassessment.';
    lastRequestedSignature = signature;
    hold(`${by} said the plan no longer works`).catch((e) => emit('council', 'error', { error: String(e?.stack ?? e) }));
}

export function startCouncils(): void {
    const check = () => {
        if (running || budgetLeft() <= 0) return;
        const plan = loadPlan();
        if(!plan.rescope&&plan.teamGoal?.milestones.every(m=>m.done)&&plan.teamGoal.milestones.some(m=>m.auto?.check?.kind==='hunt'))return; // operator reviews before escalation
        const ctx = liveContext(agents.values(), CHARACTERS.length);
        opportunityPool.get(ctx, [plan.teamGoal?.key ?? plan.teamGoal?.title ?? '', ...(plan.pastMissions ?? [])]);
        const selectReason = missionSelectionReason(plan.teamGoal, ctx, plan.rescope);
        // A mission made before the armour milestone existed gets it once.
        if (plan.teamGoal?.mission && !plan.teamGoal.milestones.some((m) => m.auto?.armour)) {
            plan.teamGoal.milestones.push(armourMilestone(Math.max(0, ...plan.teamGoal.milestones.map((m) => m.id)) + 1));
            emit('council', 'council', { phase: 'milestone', summary: 'added the standing armour milestone to the current mission' });
            savePlan(plan);
        }
        // The one-off outfit refresh is added once to the mission that is running when it first ships.
        if (plan.teamGoal?.mission && !plan.outfitAsked && !plan.teamGoal.milestones.some((m) => m.auto?.outfit)) {
            plan.outfitAsked = true;
            plan.teamGoal.milestones.push(outfitMilestone(Math.max(0, ...plan.teamGoal.milestones.map((m) => m.id)) + 1));
            emit('council', 'council', { phase: 'milestone', summary: 'added the outfit refresh milestone to the current mission' });
            savePlan(plan);
        }
        const closed = plan.teamGoal ? tickAchievementMilestones(plan.teamGoal) : [];
        if (closed.length) {
            savePlan(plan);
            // The work split was made while these were open; nothing tells the party they are closed until
            // the next council, so call one (it waits out the minimum gap) instead of leaving them to finish it.
            staleSplit = `the game closed ${closed.map((m) => `M${m.id}`).join(' and ')} (${closed
                .map((m) => m.what)
                .join('; ')
                .slice(0, 160)}); the work split was made before that`;
        }
        if (!plan.council) hold('the party has no plan yet');
        else if (!plan.teamGoal?.mission && Date.now() - lastHeld >= MIN_GAP_MS) hold('the party has no mission yet');
        else if (selectReason && (plan.operatorRescope || Date.now() - lastHeld >= MIN_GAP_MS)) hold(selectReason);
        else if (newActions(plan).length)
            hold(`new actions are available that the current plan never considered: ${newActions(plan).join(', ')}`);
        else if (staleSplit && Date.now() - lastHeld >= MIN_GAP_MS) hold(staleSplit);
        else if (Date.now() - lastHeld >= EVERY_MS) hold('the regular hourly check-in');
    };
    setTimeout(check, 30_000);
    setInterval(check, 60_000);
}

/** The titles of the last few missions, newest first, so the menu does not offer one straight back. */
function remember(old: TeamGoal | undefined, now: TeamGoal | undefined, past: string[] = []): string[] {
    const key = old?.key ?? old?.title;
    if (!key || key === (now?.key ?? now?.title)) return past;
    return [key, ...past.filter((t) => t !== key)].slice(0, 3);
}

/**
 * A new mission often restates a milestone the old one already finished; keep it finished
 * rather than send the party back over work that is done (same words, give or take a few).
 */
function carryDone(old: TeamGoal | undefined, next: TeamGoal): void {
    const words = (t: string) =>
        new Set(
            t
                .toLowerCase()
                .replace(/[^a-z0-9 ]/g, ' ')
                .split(/\s+/)
                .filter((w) => w.length > 2),
        );
    for (const m of next.milestones) {
        if (m.auto) continue;
        const w = words(m.what);
        const same = old?.milestones.find((o) => {
            if (!o.done || o.auto) return false;
            const v = words(o.what);
            const shared = [...w].filter((x) => v.has(x)).length;
            return shared / Math.max(w.size, v.size) >= 0.75;
        });
        if (same && !m.done) {
            m.done = true;
            m.doneAt = same.doneAt ?? Date.now();
            emit('council', 'council', {
                phase: 'milestone',
                summary: `milestone M${m.id} already done under the last mission: ${m.what}`,
            });
        }
    }
}

async function hold(reason: string): Promise<void> {
    if (liveContext(agents.values(), CHARACTERS.length).members.length < CHARACTERS.length) return;
    running = true;
    staleSplit = undefined;
    lastHeld = Date.now();
    const members = [...agents.values()].filter((a) => a.sdk.getState()?.inGame);
    const previous = loadPlan();
    const n = previous.council + 1;
    try {
        emit('council', 'council', { council: n, phase: 'start', reason, summary: `council #${n}: ${reason}` });
        let teamGoal = previous.teamGoal;
        let retiredMissions = previous.retiredMissions ?? [];
        const selectionReason = missionSelectionReason(teamGoal, liveContext(members, CHARACTERS.length), previous.rescope);
        if (selectionReason) {
            // Make the reason visible to the voting prompts, not just the operations log.
            savePlan({ ...previous, rescope: selectionReason });
            const chosen = await goalSession(members, n);
            if (chosen) {
                carryDone(previous.teamGoal, chosen);
                if (previous.teamGoal?.milestones.some((m) => !m.done)) {
                    const latestPrevious=loadPlan().teamGoal;
                    retiredMissions = retainUnfinished(latestPrevious?.key===previous.teamGoal.key&&latestPrevious?.set===previous.teamGoal.set?latestPrevious:previous.teamGoal, selectionReason, retiredMissions);
                    emit('council', 'council', {
                        phase: 'goal-retired',
                        summary: `retired unfinished mission "${previous.teamGoal.title}": ${selectionReason}; objectives retained in plan history`,
                    });
                }
            }
            teamGoal = chosen ?? teamGoal;
            // Save straight away so the work-split rounds below plan towards it.
            const currentPlan=loadPlan();
            if(!chosen&&teamGoal)mergeFieldProgress(teamGoal,currentPlan.teamGoal);
            savePlan({ ...currentPlan, teamGoal, retiredMissions, rescope: chosen ? undefined : selectionReason,operatorRescope:chosen?undefined:currentPlan.operatorRescope });
        }
        if (teamGoal) {
            tickAchievementMilestones(teamGoal);
            refreshMissionWork(teamGoal, liveContext(members, CHARACTERS.length));
            savePlan({ ...loadPlan(), teamGoal });
        }
        const last = new Map<string, CouncilTurn>();
        let agreed = false;
        for (let round = 1; round <= ROUNDS && !agreed; round++) {
            // Rotate who speaks first so nobody always frames the discussion.
            const order = members.slice((n + round) % members.length).concat(members.slice(0, (n + round) % members.length));
            const agreeing = new Set<string>();
            for (const a of order) {
                const transcript = councilPosts(n)
                    .map((p) => `${p.from}: ${p.text}`)
                    .join('\n');
                try {
                    const t = await councilTurn(a, n, reason, round, transcript);
                    last.set(a.name, t);
                    if (t.agree) agreeing.add(a.name);
                    post(a.name, 'all', t.message, { council: n });
                } catch (e: any) {
                    emit(a.name, 'error', { error: `council: ${e?.message ?? e}` });
                }
            }
            const uncovered = missingOwners(teamGoal, last.values());
            agreed = agreeing.size === members.length && uncovered.length === 0;
            if (uncovered.length) {
                const gap = `Unowned open milestones: ${uncovered.map((id) => `M${id}`).join(', ')}. Someone must accept each objective with a feasible next action and productive fallback.`;
                post('council', 'all', gap, { council: n });
                emit('council', 'council', { phase: 'coverage-gap', council: n, summary: gap });
            }
            emit('council', 'council', {
                council: n,
                phase: 'round',
                round,
                agreeing: agreeing.size,
                of: members.length,
                summary: `round ${round}: ${agreeing.size}/${members.length} agree`,
            });
        }
        // A milestone is done once at least two members say so.
        if (teamGoal?.mission) {
            const claims = new Map<number, number>();
            for (const t of last.values()) for (const id of new Set(t.milestones_done ?? [])) claims.set(id, (claims.get(id) ?? 0) + 1);
            const who = [...last]
                .map(([name, t]) => `${name} [${(t.milestones_done ?? []).map((id) => `M${id}`).join(' ') || '-'}]`)
                .join(', ');
            emit('council', 'council', { council: n, phase: 'claims', summary: `milestones claimed done: ${who}` });
            for (const m of teamGoal.milestones) {
                if (!m.done && !m.auto && (claims.get(m.id) ?? 0) >= 2) {
                    m.done = true;
                    m.doneAt = Date.now();
                    emit('council', 'council', { council: n, phase: 'milestone', summary: `milestone M${m.id} done: ${m.what}` });
                }
            }
        }
        if(teamGoal)mergeFieldProgress(teamGoal,loadPlan().teamGoal);
        if (teamGoal) tickAchievementMilestones(teamGoal);
        const plan: PartyPlan = {
            council: n,
            made: Date.now(),
            reason,
            agreed,
            entries: {},
            teamGoal,
            actions: Object.keys(SKILLS),
            outfitAsked: previous.outfitAsked,
            pastMissions: remember(previous.teamGoal, teamGoal, previous.pastMissions),
            retiredMissions,
            ...(selectionReason && teamGoal === previous.teamGoal ? { rescope: selectionReason,operatorRescope:previous.operatorRescope } : {}),
        };
        for (const [name, t] of last) plan.entries[name] = { commitment: t.commitment, asks: t.asks };
        plan.coverage = assignCoverage(
            teamGoal,
            last,
            members.map((a) => a.name),
        );
        for (const coverage of plan.coverage) {
            const milestone = teamGoal?.milestones.find((m) => m.id === coverage.milestone);
            if (milestone) milestone.owner = coverage.owner;
            const entry = (plan.entries[coverage.owner] ??= { commitment: '', asks: [] });
            entry.commitment += ` Accountable for M${coverage.milestone}: ${coverage.next}. Fallback: ${coverage.fallback}`;
        }
        savePlan(plan);
        emit('council', 'council', {
            council: n,
            phase: 'end',
            agreed,
            summary: `council #${n} ${agreed ? 'agreed' : 'ended without full agreement'}`,
        });
        for (const a of members)
            a.interrupt(
                `Council #${n} finished and set a new party plan${agreed ? ' everyone agreed to' : ' (not everyone agreed)'}. Set a routine that carries out your part.`,
            );
    } finally {
        running = false;
    }
}

/**
 * Mission setting from validated templates: a vote, then a runoff between the two leaders. Returns the winner, if any.
 */
async function goalSession(members: Agent[], n: number): Promise<TeamGoal | null> {
    const names = members.map((m) => m.name);
    // The game builds a menu of reachable missions with game-checked milestones; the characters choose.
    // Only if too few are reachable do they write their own, as before.
    const before = loadPlan();
    const recent = [before.teamGoal?.key ?? before.teamGoal?.title ?? '', ...(before.pastMissions ?? [])];
    const menuCtx = liveContext(members, CHARACTERS.length);
    // Selection always recomputes from fresh facts. Never replace a validated singleton with
    // unchecked freeform proposals just to manufacture a choice.
    const pool = opportunityPool.get(menuCtx, recent, Date.now(), true);
    const menu = pool.menu;
    if (!menu.length) {
        emit('council', 'error', {
            council: n,
            phase: 'goal-menu-short',
            error: `no feasible mission: ${pool.why.map((x) => `${x.template}: ${x.why}`).join('; ')}`,
        });
        return null;
    }
    const proposals: Proposal[] = menu;
    const transcript = () =>
        councilPosts(n)
            .map((p) => `${p.from}: ${p.text}`)
            .join('\n');
    emit('council', 'council', { council: n, phase: 'goal-start', summary: `council #${n}: choosing the party's mission` });
    emit('council', 'council', {
        council: n,
        phase: 'goal-menu',
        summary: `the game offered ${menu.length} validated missions (${pool.eligibleCount} eligible templates): ${menu.map((m) => `#${m.id} ${m.title}`).join(', ')}`,
    });
    const accept = (proposal: Proposal, unanimous: boolean): TeamGoal | null => {
        const probe = { milestones: proposal.milestones.map((m) => ({ done: false, auto: { check: m.check } })) };
        const ctx = liveContext(members, CHARACTERS.length);
        const blockers = ctx.members.length < ctx.size ? ['waiting for every character to reconnect'] : missionBlockers(probe, ctx);
        if (blockers.length) {
            emit('council', 'info', { phase: 'goal-revalidate', summary: `candidate no longer feasible: ${blockers.join('; ')}` });
            return null;
        }
        return toGoal(proposal, n, unanimous);
    };
    for (const p of proposals)
        emit(p.by, 'council', { council: n, phase: 'goal-proposal', summary: `proposed mission #${p.id}: "${p.title}" ${p.mission}` });
    if (!proposals.length) return null;
    if (proposals.length === 1) return accept(proposals[0], false);

    // Round 2: vote, never for your own proposal.
    const round2 = new Map<string, number>();
    for (const a of members) {
        try {
            const t = await goalTurn(a, n, 'vote', proposals, transcript());
            const own = proposals.find((p) => p.by === a.name)?.id;
            if (proposals.some((p) => p.id === t.vote) && t.vote !== own) round2.set(a.name, t.vote);
            post(a.name, 'all', t.message, { council: n });
        } catch (e: any) {
            emit(a.name, 'error', { error: `mission vote: ${e?.message ?? e}` });
        }
    }
    const tally2 = tally(round2);
    emit('council', 'council', {
        council: n,
        phase: 'goal-round',
        round: 2,
        summary: `mission vote: ${[...round2].map(([w, id]) => `${w}→#${id}`).join(', ') || 'no valid votes'}`,
    });
    if (!tally2.length) return null;
    if (round2.size === members.length && tally2.length === 1)
        return accept(
            proposals.find((p) => p.id === tally2[0][0])!,
            true,
        );

    // Round 3: runoff between the two leaders (ties broken by round-2 support, then id).
    const finalists = tally2.slice(0, 2).map(([id]) => proposals.find((p) => p.id === id)!);
    if (finalists.length < 2) return accept(finalists[0], false);
    const round3 = new Map<string, number>();
    for (const a of members) {
        try {
            const t = await goalTurn(a, n, 'runoff', finalists, transcript());
            if (finalists.some((p) => p.id === t.vote)) round3.set(a.name, t.vote);
            post(a.name, 'all', t.message, { council: n });
        } catch (e: any) {
            emit(a.name, 'error', { error: `mission runoff: ${e?.message ?? e}` });
        }
    }
    emit('council', 'council', {
        council: n,
        phase: 'goal-round',
        round: 3,
        summary: `mission runoff: ${[...round3].map(([w, id]) => `${w}→#${id}`).join(', ') || 'no valid votes'}`,
    });
    const support2 = new Map(tally2);
    const final = tally(round3).sort((x, y) => y[1] - x[1] || (support2.get(y[0]) ?? 0) - (support2.get(x[0]) ?? 0) || x[0] - y[0]);
    const winner = proposals.find((p) => p.id === (final[0]?.[0] ?? finalists[0].id))!;
    return accept(winner, round3.size === members.length && final.length === 1);
}

/** [proposal id, votes], most votes first, ties by lower id. */
function tally(votes: Map<string, number>): [number, number][] {
    const t = new Map<number, number>();
    for (const id of votes.values()) t.set(id, (t.get(id) ?? 0) + 1);
    return [...t].sort((x, y) => y[1] - x[1] || x[0] - y[0]);
}

export function toGoal(w: Proposal, n: number, unanimous: boolean): TeamGoal {
    const acceptedAt=Date.now();
    const expedition=w.milestones.some(m=>['expedition','hunt'].includes(m.check?.kind??''));
    const goal: TeamGoal = {
        mission: w.mission,
        key: w.key,
        template: w.template,
        work: w.work,
        title: w.title,
        why: w.why,
        milestones: [
            ...w.milestones.map((m, i) => ({
                id: i + 1,
                what: m.what,
                needs: m.needs,
                owner: m.owner,
                next: m.next,
                fallback: m.fallback,
                done: false,
                ...(m.check ? { auto: { check: bindExpedition(m.check,acceptedAt) } } : {}),
            })),
            ...(!expedition?[achievementMilestone(w.milestones.length + 1)]:[]),
            armourMilestone(w.milestones.length + (expedition?1:2)),
        ],
        proposedBy: w.by,
        council: n,
        set: acceptedAt,
        unanimous,
    };
    emit('council', 'council', {
        council: n,
        phase: 'goal',
        summary: `mission set: "${goal.title}" by ${goal.proposedBy}${unanimous ? ' (unanimous)' : ''}: ${goal.mission}`,
    });
    return goal;
}

/** The standing milestone: five more firsts, marks or monsters from PARTY ACHIEVEMENTS, counted by the game's ledger. */
function achievementMilestone(id: number): Milestone {
    const target = allAchievements().length + ACHIEVEMENT_STEP;
    return {
        id,
        what: `Unlock ${ACHIEVEMENT_STEP} new achievements (the ledger now shows ${target - ACHIEVEMENT_STEP}; the goal is ${target}), by any of you`,
        needs: 'All of you: each works towards the open firsts, marks and never-defeated monsters in PARTY ACHIEVEMENTS',
        done: false,
        auto: { achievements: target },
    };
}

/** The standing armour milestone: all four wear a helmet, body armour and leg armour, read from the game. */
function armourMilestone(id: number): Milestone {
    return {
        id,
        what: 'Everyone wears armour: a helmet, body armour and leg armour each, with fashion and useful stat bonuses as joint priorities',
        needs: "All of you: choose a look that suits your character, and weigh function (defence and combat bonuses), appearance and individuality together: do not copy a teammate's outfit, and consider the other slots too (shield, gloves, boots, cape). Buy, smith or trade for the pieces and equip them. Any metal counts; completion is checked from the three equipped slots.",
        done: false,
        auto: { armour: true },
    };
}

/** A one-off refresh: nobody looks like a teammate, and everyone wears something beyond helmet, body and legs. */
function outfitMilestone(id: number): Milestone {
    return {
        id,
        what: 'Outfit refresh: each of you wears a cape, shield, gloves or boots on top of helmet, body and legs, and no two of you wear the same helmet, body and legs',
        needs: "All of you: Thessalia's Fine Clothes in Varrock sells gloves, boots and a cape for a few coins and Cassie's Shield Shop in Falador sells shields. Weigh function, appearance and individuality together, and choose pieces that suit your character and differ from your teammates'. Completion is checked from what each of you wears.",
        done: false,
        auto: { outfit: true },
    };
}

/** Marks the standing milestones done: the achievements ledger reaching its target, everyone armoured. */
function tickAchievementMilestones(goal: TeamGoal): Milestone[] {
    const have = allAchievements().length;
    const armour = armourStatus();
    const outfit = outfitStatus();
    const closed: Milestone[] = [];
    for (const m of goal.milestones) {
        if (!m.auto || m.done) continue;
        const reached = m.auto.check
            ? evaluate(m.auto.check, liveContext(agents.values(), CHARACTERS.length)).met
            : m.auto.outfit
              ? outfit.known && !outfit.plain.length && !outfit.twins.length
              : m.auto.armour
                ? armour.known && Object.keys(armour.missing).length === 0 && armour.armoured.length > 0
                : have >= (m.auto.achievements ?? Infinity);
        if (!reached) continue;
        m.done = true;
        m.doneAt = Date.now();
        closed.push(m);
        emit('council', 'council', {
            phase: 'milestone',
            summary: m.auto.check
                ? `milestone M${m.id} done (the game checked it): ${m.what}`
                : m.auto.outfit
                  ? `milestone M${m.id} done (everyone is distinct): ${m.what}`
                  : m.auto.armour
                    ? `milestone M${m.id} done (everyone is armoured): ${m.what}`
                    : `milestone M${m.id} done (ledger shows ${have}): ${m.what}`,
        });
    }
    return closed;
}

/** Synchronous controller event progress; no model calls, replay or dependency on learning retention. */
export function recordExpeditionEvent(e:AgentEvent,run:string):void {
    if(e.type!=='order_end'&&!e.sharedEngagement)return;
    const plan=loadPlan();
    if(!plan.teamGoal)return;
    const prep=plan.teamGoal?.milestones.filter(m=>m.auto?.check&&['stock','wear'].includes(m.auto.check.kind))??[];
    const ctx=liveContext(agents.values(),CHARACTERS.length);
    const ready=ctx.members.length===ctx.size&&prep.length===2&&prep.every(m=>evaluate(m.auto!.check!,ctx).met);
    const next=recordHuntGoal(recordFieldGoal(plan.teamGoal,e,run)??plan.teamGoal!,e,run,ready);
    const fieldNext=next??recordFieldGoal(plan.teamGoal,e,run);
    if(!fieldNext)return;
    tickAchievementMilestones(fieldNext);
    savePlan({...plan,teamGoal:fieldNext});
    emit('council','info',{summary:`expedition evidence recorded for ${e.bot}: ${e.action}; game-checked project progress updated`});
}
