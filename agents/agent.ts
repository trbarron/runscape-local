import { observationKey } from './observation-cadence';
import { inFerryHold, onTutorialIsland } from './ferry-navigation';
import {FieldObservation,FIELD_ACTIONS,expeditionRoutineProblem} from './expedition';
import {observeWorld,type WorldObservation} from './world-observation';
import {automaticProductionCycle,ownedProduction,productionBatchText,isProduction} from './production-cycle';
import { freshPosition } from './learning-pilot';
import { learning } from './learning';
import { safeFoodRecovery } from './combat-food';
import { FightObservation } from './fight-report';
import { assistPairs, assistRoutineProblem, type AssistPeer } from './assist';
import { progressLevel } from './game-requirements';
import { blockedOption, rememberBlockedOption, renderBlockedOptions, type OptionFacts } from './blocked-options';
import { nextPreparation, preflightRoutine, satisfiedStep } from './readiness';
import { bankOf } from './banks';
import { cleanLookupText } from './lookup-text';
import { idlePass, stepTimeLimit, withStallCause } from './execution-outcomes';
import { productionWithdrawal, productiveLoopProgress, routineBankOutputs, measuredWorkProgress } from './production-batch';
import { SmeltingObservation, ironLossYield } from './smelting-report';
// One party member: executes standing orders with scripted skills, and calls the planner
// only at decision points (order finished or blocked, a teammate posted to them, death,
// a new party plan). Interrupts abort the running skill through the SDK's execution
// context, so a cancelled action really stops before the next one starts.
import type { BotActions } from '../rs-sdk/sdk/actions';
import type { BotSDK } from '../rs-sdk/sdk/index';
import { executionContext, abortable } from '../rs-sdk/sdk/execution-context';
import type { Character } from './characters';
import { SKILLS, crossGangplank, checkTactics, danger, goNear, huntedAt, packFull, renderTactics, type Args, workRequirements, heldNeed } from './skills';
import { commit, loadMemory, saveMemory, loadPlan, type Memory } from './memory';
import { post, takeUnread, unreadCount } from './board';
import { emit } from './events';
import { addWant, dropWant, noteDelivery } from './wants';
import { recordHandoff } from './handoffs';
import { checkFight } from './achievements';
import { BudgetExceeded, budgetLeft } from './llm';
import { answerLookup, decide, reflect, systemPrompt, type Decision, type Step } from './planner';
import { agents } from './party';

const MAX_ORDER_MS = 20 * 60_000;
/** A repeating routine does not start another loop after this long. */
const ROUTINE_MS = 30 * 60_000;
/** How long a rest at full health, with nothing on the way, lasts. */
const IDLE_REST_MIN = 10;
const PASS_MS = 90_000;
/** Loop breaker: more decisions than this in 10 minutes forces a scripted rest. */
const MAX_DECISIONS_PER_10_MIN = 10;
/** How long a character waits for the world to change after a routine blocks at once. */
const BLOCK_WAIT_MS = 120_000;
/** A routine saved this recently is carried on after a restart. */
const RESUME_MS = 20 * 60_000;
const REFLECT_EVERY = 12;

/** Tools a fresh character is given once: [label, inventory match, item debug name]. */
const STARTER_KIT: [string, RegExp, string][] = [
    ['bronze axe', /^bronze axe$/i, 'bronze_axe'],
    ['bronze pickaxe', /^bronze pickaxe$/i, 'bronze_pickaxe'],
    ['small fishing net', /fishing net/i, 'net'],
    ['tinderbox', /^tinderbox$/i, 'tinderbox']
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface Handoff {
    from: string;
    item: string;
    amount: number;
    ready?: { x: number; z: number };
    onReady?: () => void;
}

interface Order {
    action: string;
    args: Args;
    until: { type: Step['until_type']; value: number; skill: string | null; item: string | null };
    give?: { to: string; item: string; amount: number | null };
    label: string;
}

interface Routine {
    name: string;
    repeat: boolean;
    steps: Order[];
    /** Where to pick up, when resuming after an interruption. */
    from?: { step: number; loops: number };
}

type Ended = { kind: string; why: string };

const routineLabel = (r: Routine) => (r.steps.length === 1 && !r.repeat ? r.steps[0].label : `${r.name}: ${r.steps.map(o => o.label).join(' -> ')}${r.repeat ? ' (repeat)' : ''}`);

export class Agent {
    readonly name: string;
    private assistRoutineId = 0;
    private productionDeadline?:number;
    /** Existing planning transaction dependencies, isolated for acceptance-boundary tests. */
    private planningIO = {
        decide:(trigger:string,unread:Set<number>)=>decide(this,trigger,unread),
        lookup:(q:string)=>answerLookup(this,q),budget:()=>budgetLeft(),
        unread:()=>takeUnread(this.name),
        learn:(d:Decision)=>learning.acceptDecision(this.name,d,true),
        save:()=>saveMemory(this.name,this.memory),
        bank:()=>bankOf(this.name),now:()=>Date.now(),
        fieldGoal:()=>loadPlan().teamGoal,
        fieldMission:()=>loadPlan().teamGoal?.milestones.some(m=>!m.done&&['expedition','hunt'].includes(m.auto?.check?.kind??''))??false,
    };
    readonly system: string;
    memory: Memory;
    /** Recent order summaries, newest last (fed back to the planner). */
    history: string[] = [];
    inbox: Handoff[] = [];
    order: Order | null = null;
    routine: Routine | null = null;
    /** Index of the step running now, while a routine runs. */
    routineStep = 0;
    /** The last routine, if an interruption stopped it part-way: it can be resumed. */
    private paused: Routine | null = null;
    private lastEnd: Ended['kind'] | null = null;
    orderSince = Date.now();
    private status = 'logging in';
    private pending: string | null = null;
    private pass: AbortController | null = null;
    private decisions: number[] = [];
    private stopped = false;
    /** respawnCount is per client session, so deaths are counted against this baseline. */
    private seenRespawns = 0;
    /** The last blocked order and how many times in a row it was blocked the same way. */
    private lastBlock = { key: '', n: 0 };
    private kitWaiting = false;

    constructor(
        readonly character: Character,
        readonly sdk: BotSDK,
        readonly bot: BotActions,
        mates: string[]
    ) {
        this.name = character.username;
        this.system = systemPrompt(character, mates.filter(m => m !== character.username));
        this.memory = loadMemory(this.name);
    }

    assistPeer(): AssistPeer {
        return { state: this.sdk.getState(), receivedAt: this.sdk.getStateReceivedAt(),
            connected: this.sdk.getConnectionState() === 'connected', action: this.order?.action ?? null,
            routineId: this.assistRoutineId, step: this.routineStep };
    }

    /** Sum of real skill levels (the client also reports placeholder 'Stat18'-style slots). */
    totalLevel(): number {
        return this.sdk.getState()?.skills.filter(k => !/^stat\d+$/i.test(k.name)).reduce((s, k) => s + k.baseLevel, 0) ?? 0;
    }

    /** The routine under way, as a teammate sees it, and whether any step hands something to them. */
    routineFor(viewer: string): string {
        const r = this.routine;
        if (!r) return '';
        const gives = r.steps.filter(o => o.give && o.give.to.toLowerCase() === viewer.toLowerCase()).map(o => `${o.give!.item} to you`);
        return `routine "${r.name}"${r.repeat ? ' (repeating)' : ''}: ${gives.length ? `includes giving ${gives.join(', ')}` : 'no hand-off to you in it'}`;
    }

    activityLabel(): string {
        const mins = Math.round((Date.now() - this.orderSince) / 60_000);
        return `${this.status}${this.routine ? ` (${mins} min)` : ''}`;
    }

    /** Set when a gathering step banked a full pack partway through. */
    private bankedMidStep = false;
    /** Facts skills add to the current step's report (fight reports). */
    private stepNotes: string[] = [];
    private worldObservation?:WorldObservation;
    private fightObservation?: FightObservation;

    private packCounts(): Map<string, number> {
        const m = new Map<string, number>();
        for (const i of this.sdk.getInventory()) m.set(i.name, (m.get(i.name) ?? 0) + i.count);
        return m;
    }

    /** Ask for a fresh decision: aborts the running pass, keeps the first reason given. */
    interrupt(reason: string): void {
        assistPairs.cancelMember(this.name, true);
        this.pending ??= reason;
        this.pass?.abort(new Error(`interrupted: ${reason}`));
    }

    /** A teammate wants to hand over items; serve it without asking the planner. */
    deliver(h: Handoff): void {
        this.inbox.push(h);
        this.pass?.abort(new Error('handoff'));
    }

    stop(): void {
        assistPairs.cancelMember(this.name);
        this.stopped = true;
        this.pass?.abort(new Error('shutdown'));
    }

    // ------------------------------------------------------------ main loop

    private previousLookKey: string | undefined;

    async run(): Promise<void> {
        let trigger = this.memory.decisions ? 'You are back after a restart. Pick up where you left off.' : 'You have just arrived. Nothing is decided yet.';
        // A restart of the party carries on with the routine that was running, without a model call.
        const saved = this.memory.routine?.steps.some(s => /^(assist|invite_assist)$/.test((s as Partial<Order>)?.action ?? '')) ? undefined : this.memory.routine;
        let carryOn: Routine | null = saved && Date.now() - saved.saved < RESUME_MS ? { name: saved.name, repeat: saved.repeat, steps: saved.steps as Order[], from: saved.from } : null;
        while (!this.stopped) {
            if (!(await this.waitAlive())) continue;
            const state = this.sdk.getState();
            if (state && this.sdk.getStateAge() < 2000 && inFerryHold(state)) {
                const ac = new AbortController();
                const problem = await crossGangplank({ bot: this.bot, sdk: this.sdk, name: this.name,
                    signal: ac.signal, deadline: Date.now() + 45_000 });
                emit(this.name, 'info', { summary: problem ? `ferry hold recovery: ${problem}` : 'recovered from ferry hold to shore' });
                if (!problem) {
                    carryOn = null;
                    trigger = 'You climbed out of the ferry hold and crossed the gangplank to shore. Mainland travel and bank_resources now handle the return ferry for 30 carried coins. Recheck fresh position; old unreachable-from-the-hold notes do not prove the island is inaccessible.';
                }
            }
            await this.leaveTutorial();
            await this.giveStarterKit();
            await this.serveInbox();
            if (carryOn) emit(this.name, 'info', { summary: `carrying on with "${carryOn.name}" from step ${carryOn.from!.step + 1} after a restart` });
            const routine = carryOn ?? (await this.decideRoutine(trigger));
            carryOn = null;
            const started = Date.now();
            try { trigger = await this.runRoutine(routine); }
            finally { assistPairs.cancelMember(this.name, true); }
            if (this.lastEnd === 'blocked' && Date.now() - started < 30_000) trigger += await this.waitForChange();
            if (routine.steps.every(step => step.action === 'look')) {
                const key = observationKey(this.sdk.getState()!);
                if (key === this.previousLookKey && Date.now() - started < 30_000)
                    trigger += await this.waitForChange(key);
                this.previousLookKey = key;
            } else this.previousLookKey = undefined;
            trigger += this.idleNote(routine);
        }
    }

    /**
     * After a routine blocks straight away, waits (up to two minutes) for something that could
     * change the outcome: a delivery, a post to this character, a change in the pack, or an
     * interrupt. Deciding again before then mostly meets the same block.
     */
    private async waitForChange(scene?: string): Promise<string> {
        const pack = () => JSON.stringify(this.sdk.getInventory().map(i => [i.name, i.count]));
        const before = pack();
        const posts = unreadCount(this.name, { urgent: true });
        const start = Date.now();
        this.status = scene ? 'waiting for new information after repeated look' : 'waiting for something to change after a block';
        while (!this.stopped && Date.now() - start < BLOCK_WAIT_MS) {
            const state = this.sdk.getState();
            if (state?.player?.isDead || state?.player?.combat.inCombat || (state?.player && state.player.hp < state.player.maxHp))
                return '\nHealth or combat needs attention; reassess now.';
            if (scene && state && observationKey(state) !== scene) return '\nThe nearby scene changed while you waited.';
            if (this.pending) {
                const why = this.pending;
                this.pending = null;
                return `\nWhile you waited: ${why}`;
            }
            if (this.inbox.length) return '\nA teammate came to hand you something while you waited.';
            // Only urgent posts end the wait, as only urgent posts interrupt a routine; otherwise
            // two characters messaging each other keep waking each other up.
            if (unreadCount(this.name, { urgent: true }) > posts) return '\nAn urgent post for you arrived while you waited.';
            if (pack() !== before) return '\nYour pack changed while you waited.';
            await sleep(2000);
        }
        return `\nNothing changed in the ${Math.round((Date.now() - start) / 1000)} s you waited for new information.`;
    }

    private restStreak = 0;

    /** A nudge after repeated rests at full health: resting is the easy default, not a plan. */
    private idleNote(r: Routine): string {
        const p = this.sdk.getState()?.player;
        this.restStreak = r.steps.every(o => o.action === 'rest') && p && p.hp >= p.maxHp ? this.restStreak + 1 : 0;
        if (this.restStreak < 2) return '';
        return ` You have now rested ${this.restStreak} times in a row at full health. Resting does not move the mission forward: pick something productive, even outside your planned role (see the ways to recover missing tools above, if you lack any).`;
    }

    /** New characters start on Tutorial Island, which blocks normal play. */
    private async leaveTutorial(): Promise<void> {
        const p = this.sdk.getState()?.player;
        if (!p || !onTutorialIsland(p)) return;
        emit(this.name, 'info', { summary: 'on Tutorial Island, skipping the tutorial' });
        await this.bot.skipTutorial().catch(e => emit(this.name, 'error', { error: `skipTutorial: ${e?.message ?? e}` }));
    }

    /**
     * Fresh characters get the starter tools once, through the admin ::give command
     * (the party accounts have staff level 3). Sent by this code only: the model has no
     * way to issue commands, and its posts never reach in-game chat.
     */
    private async giveStarterKit(): Promise<void> {
        if (this.memory.kitGiven) return;
        const st = this.sdk.getState();
        if (!st?.player || onTutorialIsland(st.player)) return; // still on Tutorial Island
        // The first frames after login can arrive before the inventory: never judge an empty one.
        if (!st.inventory.length) return;
        const have = [...st.inventory, ...st.equipment];
        const missing = STARTER_KIT.filter(([, re]) => !have.some(i => re.test(i.name)));
        if (missing.length > 28 - st.inventory.length) {
            if (!this.kitWaiting) {
                emit(this.name, 'info', { summary: `starter kit waiting for ${missing.length} free inventory slots` });
                this.history.push(`Your free starter tools (${missing.map(m => m[0]).join(', ')}) are waiting, but your pack is full: bank_resources or give items away to free ${missing.length} slots`);
            }
            this.kitWaiting = true;
            return;
        }
        const given: string[] = [];
        let failed = false;
        for (const [name, re, obj] of missing) {
            await this.sdk.say(`::give ${obj}`);
            const ok = await this.sdk.waitForCondition(s => s.inventory.some(i => re.test(i.name)), 5000).then(() => true, () => false);
            given.push(ok ? name : `${name} (failed)`);
            failed ||= !ok;
        }
        this.memory.kitGiven = !failed;
        saveMemory(this.name, this.memory);
        emit(this.name, 'info', { summary: given.length ? `starter kit: ${given.join(', ')}` : 'starter kit: already had every tool' });
    }

    private async waitAlive(): Promise<boolean> {
        const st = this.sdk.getState();
        if (st?.inGame && st.player?.maxHp && !st.player.isDead) return true;
        await sleep(2000);
        return false;
    }

    /** Returns a death message if the character has died since we last looked. */
    private checkDeath(): string | null {
        const respawns = this.sdk.getState()?.player?.respawnCount ?? 0;
        if (respawns < this.seenRespawns) this.seenRespawns = respawns; // the client restarted
        if (respawns === this.seenRespawns) return null;
        this.memory.deaths += respawns - this.seenRespawns;
        this.seenRespawns = respawns;
        saveMemory(this.name, this.memory);
        emit(this.name, 'death', { summary: `died (death #${this.memory.deaths})` });
        return 'You died and respawned in Lumbridge. Your whole inventory, tools included, was lost.';
    }

    // ------------------------------------------------------------ deciding

    private notices: string[] = [];

    /** A fact for this character's next decision, without interrupting what they are doing. */
    notice(text: string): void {
        if (!this.notices.includes(text)) this.notices.push(text);
    }

    private optionFacts(): OptionFacts {
        const state = this.sdk.getState()!;
        return { inventory: state.inventory, equipment: state.equipment, skills: state.skills, bank: bankOf(this.name) };
    }

    /** Public only so the planner can include the same exclusions the executor enforces. */
    recentBlockedOptions(): string {
        return renderBlockedOptions(this.memory.blockedOptions ??= [], this.optionFacts());
    }

    private knownBlock(step: Order): string | null {
        if (!this.memory || step.give || satisfiedStep(this.sdk.getState()!, step)) return null;
        const option = blockedOption(this.memory.blockedOptions ??= [], step, this.optionFacts());
        return option ? `temporarily excluded ${step.action} (${step.args.target ?? ''}): ${option.reason}; relevant facts have not changed` : null;
    }

    private rememberBlock(step: Order, reason: string): void {
        if (!this.memory || step.give) return;
        const material = workRequirements(this.sdk.getState()!, step.action, step.args).items.find((item) =>
            reason.includes(` ${item.name}; not enough usable stock`),
        );
        if (
            rememberBlockedOption(
                (this.memory.blockedOptions ??= []),
                step,
                reason,
                this.optionFacts(),
                Date.now(),
                material
                    ? {
                          pattern: material.match.source,
                          flags: material.match.flags,
                          ...(material.tool ? {skill:material.tool} : step.action === 'cook' ? { skill: 'Cooking' } : step.action === 'craft' ? { skill: 'Crafting' } : {}),
                      }
                    : undefined,
            )
        ) {
            saveMemory(this.name, this.memory);
            emit(this.name, 'info', {
                phase: 'option-blocked',
                action: step.action,
                target: step.args.target,
                summary: `remembered unavailable option ${step.action} (${step.args.target ?? ''}): ${reason}`,
            });
        }
    }

    private routineRejection(steps: Order[]): string | null {
        const fieldProblem=expeditionRoutineProblem(this.planningIO?.fieldGoal?.(),this.name,steps);
        if(fieldProblem)return fieldProblem;
        // Later steps may deliberately acquire stock or levels through earlier work. Check cached
        // constraints only for the first unfinished step; execute checks again at each step boundary.
        const first = steps.findIndex(step => !satisfiedStep(this.sdk.getState()!, step));
        if (first >= 0) {
            const known = this.knownBlock(steps[first]);
            if (known) {
                emit(this.name, 'info', { phase: 'option-suppressed', action: steps[first].action, target: steps[first].args.target, summary: known });
                return `step ${first + 1}: ${known}`;
            }
        }
        const rejection = preflightRoutine(this.sdk.getState()!, bankOf(this.name)?.items ?? {}, steps);
        if (rejection) {
            const located = rejection.match(/^step (\d+): ([\s\S]*)$/);
            const step = steps[located ? Number(located[1]) - 1 : 0];
            const reason = located ? located[2] : rejection;
            // A later purchase can be affordable alone but exceed the whole routine's budget.
            // Do not turn that aggregate rejection into a ban on the individual purchase.
            if (step && !(located && Number(located[1]) > 1 && reason.startsWith('purchases exceed'))) this.rememberBlock(step, reason);
        }
        return rejection;
    }

    private async decideRoutine(trigger: string): Promise<Routine> {
        if (this.notices.length) trigger += `\n${this.notices.splice(0).join('\n')}`;
        const now = Date.now();
        this.decisions = this.decisions.filter(t => now - t < 600_000);
        if (this.decisions.length >= MAX_DECISIONS_PER_10_MIN) {
            emit(this.name, 'decision', { trigger, action: 'rest', source: 'cooldown', summary: 'too many decisions, resting 3 min' });
            return this.restOrder(3, 'cooling down');
        }
        this.decisions.push(now);
        const unread = this.planningIO.unread();

        let d: Decision;
        try {
            // A lookup is answered from the world index and the agent asked again at once, so
            // it can plan with the answer (at most two lookups a decision).
            let asked = '';
            for (let lookups = 0; ; lookups++) {
                if (this.planningIO.budget() <= 0) throw new BudgetExceeded('budget spent');
                d = await this.planningIO.decide(trigger + asked, unread);
                const q = d.lookup?.trim();
                if (!q || lookups >= 2) {
                    const candidate = d.resume && this.paused ? this.paused : this.toRoutine(d);
                    const steps = candidate.steps.slice(candidate.from?.step ?? 0);
                    const rejection = assistRoutineProblem(candidate.steps, candidate.repeat) ?? this.routineRejection(steps);
                    if (rejection && !asked.includes('PREFLIGHT REJECTED')) {
                        emit(this.name, 'info', { summary: `routine preflight rejected: ${rejection}` });
                        asked += `\n\nPREFLIGHT REJECTED: ${rejection}. No actions or messages from that proposal were carried out. Choose a feasible routine; missing usable tools and known banked materials can be fetched automatically. Do not repeat this impossible plan.`;
                        continue;
                    }
                    if (rejection) {
                        this.history.push(`Routine preflight blocked: ${rejection}`);
                        return this.restOrder(2, 'preflight could not find a feasible routine');
                    }
                    break;
                }
                const answer = this.planningIO.lookup(q);
                emit(this.name, 'lookup', { query: q, summary: `looked up "${q}": ${answer.split('\n')[1] ?? answer}` });
                asked += `\n\nYOU LOOKED UP "${q}"\n${answer}\nNow set your routine (lookup again only if you still need to).`;
            }
        } catch (e: any) {
            emit(this.name, 'error', { error: `planner: ${e?.message ?? e}` });
            return this.restOrder(2, 'planner unavailable');
        }

        const previous = this.order?.action;
        this.applyMemory(d);
        for (const m of d.messages ?? []) {
            const to = m.to.toLowerCase() === 'all' ? 'all' : ([...agents.keys()].find(n => n.toLowerCase() === m.to.toLowerCase()) ?? 'all');
            if (m.text.trim()) post(this.name, to, m.text, { replyTo: m.reply_to ?? undefined, urgent: !!m.urgent });
        }
        if (d.call_council) {
            const deferred = (await import('./council')).requestCouncil(this.name);
            if (deferred) this.notices.push(deferred);
        }

        const resumed = !!d.resume && !!this.paused;
        const routine = resumed ? this.paused! : this.toRoutine(d);
        this.paused = null;
        const first = routine.steps[routine.from?.step ?? 0];
        emit(this.name, 'decision', {
            trigger,
            action: first.action,
            target: first.args.target,
            until: first.until,
            repeat: previous === first.action,
            routine: { name: routine.name, repeat: routine.repeat, steps: routine.steps.map(o => o.label) },
            thought: d.thought,
            activeAmbition: learning.snapshot()?.ambitions[this.name]?.revision ?? null,
            resumed,
            summary: `${resumed ? `resume at step ${routine.from!.step + 1}: ` : ''}${routineLabel(routine)} | ${d.thought}`
        });

        this.memory.decisions++;
        this.planningIO.save();
        if (this.memory.decisions - this.memory.lastReflection >= REFLECT_EVERY) this.reflectSoon();
        return routine;
    }

    private applyMemory(d: Decision): void {
        if (learning.invitationDue(this.name,this.memory.ambitionInvitedAt)) this.memory.ambitionInvitedAt=Date.now();
        const updated=this.planningIO.learn(d);
        if(updated.warning)this.notice(updated.warning);
        if(updated.changed)emit(this.name,'info',{summary:'learning pilot: self-authored ambition or unverified interpretation updated (not an achievement)'});
        if (d.goal?.trim()) this.memory.goal = d.goal.trim().slice(0, 200);
        for (const c of d.commit ?? []) {
            const made = commit(this.memory, c.to, c.what);
            emit(this.name, 'commit', { id: made.id, to: made.to, summary: `promised ${made.to}: ${made.what}` });
        }
        for (const w of d.wants ?? []) addWant(this.name, w);
        for (const id of d.drop_wants ?? []) dropWant(this.name, id);
        if (d.tactics) {
            const t = checkTactics(d.tactics as any);
            if (JSON.stringify(t) !== JSON.stringify(checkTactics(this.memory.tactics as any))) {
                this.memory.tactics = t as unknown as Record<string, unknown>;
                emit(this.name, 'info', { summary: `set fight tactics: ${renderTactics(t)}` });
            }
        }
        for (const r of d.resolve ?? []) {
            const c = this.memory.commitments.find(x => x.id === r.id && x.status === 'open');
            if (!c) continue;
            c.status = r.status;
            c.closed = Date.now();
            emit(this.name, 'resolve', { id: c.id, status: r.status, ageMin: Math.round((c.closed - c.made) / 60_000), summary: `${r.status}: ${c.what}` });
        }
    }

    private reflectSoon(): void {
        this.memory.lastReflection = this.memory.decisions;
        reflect(this)
            .then(notes => {
                this.memory.notes = notes;
                saveMemory(this.name, this.memory);
                emit(this.name, 'reflect', { summary: notes });
            })
            .catch(e => emit(this.name, 'error', { error: `reflect: ${e?.message ?? e}` }));
    }

    private toRoutine(d: Decision): Routine {
        const steps = (d.steps ?? []).slice(0, 6).map(st => this.toOrder(st));
        if (!steps.length) return this.restOrder(2, 'no steps given');
        return { name: (d.routine || steps[0].label).slice(0, 60), repeat: !!d.repeat && steps.some(o => o.action !== 'rest'), steps };
    }

    private toOrder(d: Step): Order {
        d = { ...d, target: d.target == null ? d.target : cleanLookupText(d.target),
            give_item: d.give_item == null ? d.give_item : cleanLookupText(d.give_item),
            until_item: d.until_item == null ? d.until_item : cleanLookupText(d.until_item) };
        const until = {
            type: d.until_type,
            value: Math.max(1, d.until_value || 10),
            skill: d.until_skill,
            item: d.until_item
        };
        if (d.action === 'give') {
            const give = { to: d.give_to ?? '', item: d.give_item ?? '', amount: d.give_amount };
            return { action: 'give', args: { target: null }, until, give, label: `giving ${give.item || 'items'} to ${give.to}` };
        }
        const action = SKILLS[d.action] ? d.action : 'rest';
        if (action === 'rest') {
            // A rest at full health with nobody bringing anything is idle time: it runs 10 minutes,
            // so an idle character is not re-planning (and paying for a decision) every few minutes.
            if (this.idleRest()) Object.assign(until, { type: 'minutes', value: IDLE_REST_MIN });
            else if (until.type === 'minutes') until.value = Math.min(until.value, 5);
        }
        const name = `${action.replace(/_/g, ' ')}${d.target ? ` (${d.target})` : ''}`;
        if (SKILLS[action].oneShot) {
            const amount = until.type === 'gathered' ? until.value : null;
            return { action, args: { target: d.target, amount }, until, label: amount ? `${name} x${amount}` : name };
        }
        const stop = until.type === 'minutes' ? `${Math.min(until.value, 20)} min` : until.type === 'skill_level' ? `${until.skill} ${until.value}` : until.type === 'exhausted' ? 'out of materials or pack full' : `${until.value} ${until.item}`;
        return { action, args: { target: d.target }, until, label: `${name} until ${stop}` };
    }

    /** At full health, and no teammate's routine hands anything to this character. */
    private idleRest(): boolean {
        const p = this.sdk.getState()?.player;
        if (!p || p.hp < p.maxHp) return false;
        return ![...agents.values()].some(a => a !== this && a.routine?.steps.some(o => o.give?.to.toLowerCase() === this.name.toLowerCase()));
    }

    private restOrder(minutes: number, why: string): Routine {
        const label = `resting (${why})`;
        return { name: label, repeat: false, steps: [{ action: 'rest', args: { target: null }, until: { type: 'minutes', value: minutes, skill: null, item: null }, label }] };
    }

    // ------------------------------------------------------------ executing

    /**
     * Runs a routine's steps in order (looping if it repeats) until one does not finish, the
     * loop stops paying off, or time is up. Returns the next decision's trigger: how each
     * step went, so a failed step can be fixed without re-planning the rest.
     */
    private async runRoutine(r: Routine): Promise<string> {
        const rejected = this.routineRejection(r.steps.slice(r.from?.step ?? 0));
        if (rejected) {
            this.lastEnd = 'blocked';
            return `Routine preflight blocked before starting: ${rejected}. Choose a feasible plan.`;
        }
        const autoCycle=!r.repeat&&automaticProductionCycle(r.steps);
        const cycleNow=()=>this.planningIO.now?.()??Date.now();
        if(autoCycle&&!r.repeat)emit(this.name,'info',{summary:`executor will continue chosen own-stock production pipeline across carried batches, within30min and existing interruption/readiness limits: ${r.name}`});
        const bankOutputs = routineBankOutputs(r.steps);
        r = { ...r, steps: r.steps.map(o => o.action === 'bank_resources' ? { ...o, args: { ...o.args, bankOutputs } } : o) };
        this.routine = r;
        this.assistRoutineId++;
        this.orderSince = Date.now();
        const start = cycleNow();
        this.productionDeadline=autoCycle?start+ROUTINE_MS:undefined;
        let loops = r.from?.loops ?? 0;
        let first = r.from?.step ?? 0;
        const lines: string[] = r.steps.slice(0, first).map((o, i) => `${i + 1}. ${o.label}: done before the interruption`);
        let end: (Ended & { step: number }) | null = null;
        while (!end) {
            let loopProgress = false;
            for (let i = first; i < r.steps.length && !end; i++) {
                if(autoCycle&&cycleNow()>=start+ROUTINE_MS){end={kind:'done',why:'production cycle time window finished',step:i};break;}
                this.routineStep = i;
                this.memory.routine = { saved: Date.now(), name: r.name, repeat: r.repeat, steps: r.steps, from: { step: i, loops } };
                this.planningIO.save();
                this.status = `${r.name}: step ${i + 1}/${r.steps.length}, ${r.steps[i].label}${loops ? ` (loop ${loops + 1})` : ''}`;
                const batch = productionWithdrawal(this.sdk.getState()!, r.steps, i);
                if (batch === 0) {
                    lines[i] = `${i + 1}. ${r.steps[i].label}: current production batch already supplied; no withdrawal needed`;
                    continue;
                }
                const order = batch === null ? r.steps[i] : {
                    ...r.steps[i], args: { ...r.steps[i].args, amount: batch },
                    label: `${r.steps[i].label} (current production batch: ${batch})`,
                };
                const res = await this.execute(order);
                loopProgress ||= productiveLoopProgress(r.steps, order.give ? 'give' : order.action, res.progress);
                lines[i] = `${i + 1}. ${res.summary}${loops ? ' (latest loop)' : ''}`;
                if (res.ended.kind !== 'done') end = { ...res.ended, step: i };
            }
            first = 0;
            if (end) break;
            loops++;
            if (!r.repeat&&!autoCycle) end = { kind: 'done', why: '', step: r.steps.length - 1 };
            else if (!loopProgress) end = { kind: 'stopped', why: 'a whole loop made no productive progress; banking, equipping and withdrawing alone do not advance production', step: r.steps.length - 1 };
            else if (cycleNow() - start >= ROUTINE_MS) end = { kind: 'done', why: `looped ${loops} times, the time limit for one routine`, step: r.steps.length - 1 };
            else if(autoCycle) {
                if(this.stopped||this.pending){end={kind:'interrupted',why:this.stopped?'shutting down':this.pending!,step:r.steps.length-1};if(!this.stopped)this.pending=null;}
                else if(!((this.sdk.getStateAge?.()??Infinity)>=0&&(this.sdk.getStateAge?.()??Infinity)<=30_000))end={kind:'done',why:'production cycle ended: fresh state needed before continuing',step:r.steps.length-1};
                else {
                    const own=ownedProduction(this.sdk.getState()!,this.planningIO.bank(),r.steps,cycleNow());
                    if(!own.known||own.units<1)end={kind:'done',why:`production cycle ended: ${productionBatchText(own)}`,step:r.steps.length-1};
                    else emit(this.name,'info',{summary:`continuing chosen production pipeline from verified own-bank stock (${own.units} recipe units supported); completed ${loops} productive lap(s)`});
                }
            }
        }
        assistPairs.cancelMember(this.name, true);
        this.routine = null;
        this.productionDeadline=undefined;
        this.lastEnd = end.kind;
        // Cut short by stopping the party: keep it saved, to carry on after the restart.
        if (!this.stopped) {
            delete this.memory.routine;
            this.planningIO.save();
        }
        this.status = 'deciding';
        for (let i = 0; i < r.steps.length; i++) lines[i] ??= `${i + 1}. ${r.steps[i].label}: not reached`;
        const canResume = (end.kind === 'interrupted' || end.kind === 'yielded') && !this.stopped;
        this.paused = canResume ? { ...r, from: { step: end.step, loops } } : null;

        const label = routineLabel(r);
        const head = end.kind === 'done' ? `finished${end.why?` - ${end.why}`:''}` : `${end.kind} at step ${end.step + 1}${end.why ? ` - ${end.why}` : ''}`;
        const looped = r.repeat||autoCycle ? ` after ${loops} full loop${loops === 1 ? '' : 's'}` : '';
        this.history.push(`routine "${r.name}" ${head}${looped}`);
        if (this.history.length > 8) this.history.shift();
        const key = `${label}|${end.step}|${end.why}`;
        this.lastBlock = end.kind === 'blocked' ? { key, n: this.lastBlock.key === key ? this.lastBlock.n + 1 : 1 } : { key: '', n: 0 };
        const again = this.lastBlock.n >= 2 ? ` This exact routine has now been blocked ${this.lastBlock.n} times in a row at the same step for the same reason; it will not work until something changes.` : '';
        const resume = canResume ? ` You can resume it from step ${end.step + 1} (resume: true) or set a new routine.` : '';
        return `Your routine "${r.name}" ${head}${looped}.${again}${resume}\nSteps:\n${lines.join('\n')}`;
    }

    /** Runs one step until it ends. */
    private async execute(order: Order): Promise<{ ended: Ended; summary: string; progress: boolean }> {
        // Party facts label cooked fish "Shrimps (cooked)"; the item itself is plain "Shrimps".
        // "X (cooked)" becomes "cooked X", which withdraw, bank and give read as the cooked item.
        const plain = (t: string) => cleanLookupText(t).replace(/^(.*?)\s*\(cooked\)\s*$/i, 'cooked $1').trim();
        if (order.args.target) order.args.target = plain(order.args.target);
        if (order.give) order.give.item = plain(order.give.item);
        if (order.until.item) order.until.item = cleanLookupText(order.until.item).replace(/\s*\(cooked\)/i, '').trim();
        this.order = order;
        const start = Date.now();
        const observedStartPosition=freshPosition(this.sdk.getState()?.player,this.sdk.getStateReceivedAt?.(),start);
        const xp0 = this.xp();
        const gathered = new Map<string, number>();
        const pack0 = this.packCounts();
        const smelting = order.action === 'smelt' ? new SmeltingObservation(this.sdk.getState()?.gameMessages) : undefined;
        const fighting=order.action==='fight'?new FightObservation():undefined;
        const field=FIELD_ACTIONS.has(order.action)&&this.planningIO?.fieldMission?.()?new FieldObservation(start):undefined;
        field?.observe(this.sdk.getState(),this.sdk.getStateReceivedAt?.(),start);
        this.fightObservation=fighting;
        if(fighting)fighting.observe(this.sdk.getState()!);
        this.bankedMidStep = false;
        this.stepNotes = [];
        this.worldObservation=undefined;
        let ended: Ended;

        const u = order.until;
        const satisfied = satisfiedStep(this.sdk.getState()!, order);
        const known = this.knownBlock(order);
        if (satisfied) {
            ended = { kind: 'done', why: satisfied };
        } else if (known) {
            ended = { kind: 'blocked', why: known };
        } else if (order.give) {
            const msg = await this.give(order.give);
            ended = { kind: msg.startsWith('gave') ? 'done' : 'blocked', why: msg };
        } else {
            const unsubscribe = (smelting||fighting||field) && this.sdk.onStateUpdate?.(s => {smelting?.observe(s.gameMessages);fighting?.observe(s,this.sdk.getStateReceivedAt?.());field?.observe(s,this.sdk.getStateReceivedAt?.());});
            try { ended = await this.runOrder(order, start, gathered, smelting); }
            finally {
                smelting?.observe(this.sdk.getState()?.gameMessages);
                unsubscribe?.();
            }
        }

        field?.observe(this.sdk.getState(),this.sdk.getStateReceivedAt?.());
        fighting?.observe(this.sdk.getState()!,this.sdk.getStateReceivedAt?.());
        fighting?.finish(this.xpGainedSince(xp0));
        this.fightObservation=undefined;
        if (ended.kind === 'blocked' && !known) this.rememberBlock(order, ended.why);
        const xpGained = this.xpGainedSince(xp0);
        if (order.action === 'fight') checkFight(this.name, order.args.target ?? 'cow', xpGained);
        const gains = [...gathered].map(([n, c]) => `+${c} ${n}`).join(', ');
        const xpText = Object.entries(xpGained).map(([s, v]) => `+${Math.round(v)} ${s} xp`).join(', ');
        // What left the pack, and where it went: a deposit reported as "nothing gained" reads as
        // a deposit that failed, and gets re-checked.
        const pack1 = this.packCounts();
        const left = [...pack0].filter(([n, c]) => (pack1.get(n) ?? 0) < c).map(([n, c]) => `${c - (pack1.get(n) ?? 0)} ${n}`);
        const where: Record<string, string> = { bank_resources: 'into your bank', sell_to_shop: 'sold', equip: 'now worn', bury_bones: 'buried' };
        // Crafting uses up materials; other actions (fishing banks a full pack) say nothing.
        const how = order.give
            ? `to ${order.give.to}`
            : (where[order.action] ?? (/^(smelt|smith|cook|fletch|firemake)$/.test(order.action) ? 'used up' : this.bankedMidStep ? 'into your bank (the pack filled mid-step, so it was banked)' : ''));
        // A net inventory decrease understates consumption after bank resupply.
        // Smelting observations carry confirmed recipe inputs instead.
        const moved = smelting?.report.resolvedAttempts ? '' : left.length && how ? `${left.join(', ')} ${how}` : '';
        const batch=order.until.type==='exhausted'&&ended.kind==='done'&&isProduction(order.action)
            ?ownedProduction(this.sdk.getState()!,this.planningIO?.bank?.()??bankOf(this.name),this.routine?.steps??[order]):undefined;
        if(batch)ended={...ended,why:`${ended.why&&!/^ran out:|^pack full$/.test(ended.why)?ended.why+'; ':''}${productionBatchText(batch)}`};
        const reports = fighting ? ` [${fighting.summary()}]` : this.stepNotes.length ? ` [${this.stepNotes.slice(-1)[0]}]` : '';
        const smeltText = smelting?.summary();
        const summary = `${order.label}: ${[xpText, smelting?.report.resolvedAttempts?'':gains, moved, smeltText].filter(Boolean).join(', ') || 'nothing gained'} -> ${ended.kind}${ended.why ? ` (${ended.why})` : ''}${reports}`;
        const observedPosition=freshPosition(this.sdk.getState()?.player,this.sdk.getStateReceivedAt?.());
        emit(this.name, 'order_end', {
            orderStartedAt:start,
            routineId:this.assistRoutineId,
            ...(field&&fighting?.defeats.length?{fightDefeats:fighting.defeats}:{}),
            ...(field?.samples.length?{fieldWork:{startedAt:field.startedAt,samples:field.samples}}:{}),
            target: order.args.target ?? order.give?.item,
            ...(this.worldObservation?{worldObservation:this.worldObservation}:{}),
            ...(observedPosition?{observedPosition}:{}),
            ...(observedStartPosition?{observedStartPosition}:{}),
            action: order.action,
            activity: order.give ? 'errands' : SKILLS[order.action]?.activity ?? 'rest',
            outcome: ended.kind,
            reason: ended.why,
            durationMs: Date.now() - start,
            xp: xpGained,
            ...(batch?{productionBatch:batch}:{}),
            ...(smelting ? { smelting: smelting.report } : {}),
            ...(fighting ? { fight: fighting.report } : {}),
            ...(order.action === 'withdraw_from_bank' && order.until.type === 'gathered' ? {
                withdrawal: { requested: order.until.value, batch: order.args.amount ?? order.until.value,
                    received: [...gathered.values()].reduce((n, v) => n + v, 0) },
            } : {}),
            summary
        });
        this.order = null;
        return { ended, summary, progress: measuredWorkProgress(order.action, gathered, xpGained) || (order.give != null && ended.kind === 'done') };
    }

    private async runOrder(order: Order, start: number, gathered: Map<string, number>, smelting?: SmeltingObservation): Promise<Ended> {
        const invalidAssist = assistRoutineProblem(this.routine?.steps ?? [order], this.routine?.repeat ?? false);
        if (invalidAssist) return { kind: 'blocked', why: invalidAssist };
        const def = SKILLS[order.action];
        const stepLimit = order.until.type === 'minutes' ? Math.min(order.until.value, 20) * 60_000 : MAX_ORDER_MS;
        const limit = Math.min(stepLimit, this.productionDeadline===undefined?Infinity:Math.max(0,this.productionDeadline-start));
        const exhaust = order.until.type === 'exhausted';
        let idlePasses = 0;
        let worked = false;
        let prepared = false;
        let preparations = 0;
        const iron = order.action === 'smelt' && /^iron(?:\s|$)/i.test(order.args.target ?? '');

        for (;;) {
            if (this.stopped) return { kind: 'interrupted', why: 'shutting down' };
            if (this.pending) {
                const why = this.pending;
                this.pending = null;
                return { kind: 'interrupted', why };
            }
            if (this.inbox.length) {
                await this.serveInbox();
                continue;
            }
            const died = this.checkDeath();
            if (died) return { kind: 'died', why: died };
            if (!(await this.waitAlive())) continue;

            const st = this.sdk.getState()!;
            if (this.untilMet(order, gathered)) return { kind: 'done', why: '' };
            if (iron && smelting?.retryLimitReached) return ironLossYield(smelting);
            if (Date.now() - start >= limit) {
                if (iron && smelting?.report.impurityFailures && !worked && order.until.type !== 'minutes')
                    return { kind:'yielded', why:'smelting time budget reached after confirmed normal iron impurity losses; target remains unfinished' };
                return stepTimeLimit(order.until.type, worked);
            }
            if (!prepared) {
                const ready = nextPreparation(st, bankOf(this.name)?.items ?? {}, order);
                if (ready.blocker) return iron && smelting?.report.impurityFailures && !workRequirements(st, order.action, order.args).blocker
                    ? { kind:'partial', why:`normal iron impurity losses consumed ore; target remains unfinished; preparation: ${ready.blocker}` }
                    : { kind: 'blocked', why: `preparation: ${ready.blocker}` };
                if (ready.preparation) {
                    if (++preparations > 10) return { kind: 'blocked', why: 'preparation limit reached; reassess this routine' };
                    const prep = ready.preparation;
                    emit(this.name, 'info', {
                        summary: `preparing for ${order.action}: ${prep.reason} (${prep.action}: ${prep.args.target})`,
                    });
                    const before = JSON.stringify(this.sdk.getInventory());
                    const result = await this.runPass(prep.action, prep.args, start + limit);
                    if (result.aborted) continue;
                    if (result.blocker) return { kind: 'blocked', why: `preparation ${prep.action}: ${result.blocker}` };
                    if (before === JSON.stringify(this.sdk.getInventory()))
                        return {
                            kind: 'blocked',
                            why: `preparation ${prep.action} changed no inventory; check bank stock, funds or space`,
                        };
                    this.stepNotes.push(prep.reason);
                    continue;
                }
                prepared = true;
            }
            const why = def.requires?.(st, order.args);
            // Consumables can run out during a long pass. Re-enter bounded readiness instead of
            // repeatedly asking the planner for the same missing feathers/bait.
            if (why && !(exhaust && worked)) {
                const readiness = nextPreparation(st, bankOf(this.name)?.items ?? {}, order);
                if (readiness.preparation) {
                    prepared = false;
                    preparations = 0;
                    continue;
                }
                if (readiness.blocker) return iron && smelting?.report.impurityFailures && !workRequirements(st, order.action, order.args).blocker
                    ? { kind:'partial', why:`normal iron impurity losses consumed ore; target remains unfinished: ${readiness.blocker}` }
                    : worked && /^(smith|smelt|cook|craft|fletch|firemake)$/.test(order.action)
                    ? { kind: 'partial', why: `made progress; target remains unfinished: ${readiness.blocker}` }
                    : { kind: 'blocked', why: `preparation: ${readiness.blocker}` };
            }
            if (why) return exhaust && worked ? { kind: 'done', why: `ran out: ${why}` } : { kind: 'blocked', why };

            if (def.gathers && packFull(st)) {
                if (exhaust) return worked ? { kind: 'done', why: 'pack full' } : { kind: 'blocked', why: 'pack is already full' };
                const banked = await this.runPass('bank_resources', { target: null }, start + limit);
                if (banked.blocker) return { kind: 'blocked', why: `pack is full and banking failed: ${banked.blocker}` };
                this.bankedMidStep = true;
                continue;
            }

            // Stop the pass as soon as the step's goal is met, not at the end of a long pass.
            const lossesBefore = smelting?.report.impurityFailures ?? 0;
            const reachBefore = smelting?.report.reachFailures ?? 0;
            const r = await this.runPass(
                order.action,
                order.args,
                start + limit,
                def.oneShot
                    ? undefined
                    : (gainedSoFar) => {
                          const tally = new Map(gathered);
                          for (const [n, c] of gainedSoFar) tally.set(n, (tally.get(n) ?? 0) + c);
                          return this.untilMet(order, tally);
                      },
                iron ? smelting : undefined,
            );
            for (const [n, c] of r.gained) gathered.set(n, (gathered.get(n) ?? 0) + c);
            worked ||= r.progress;
            if (this.untilMet(order, gathered)) return { kind: 'done', why: '' };
            if (r.blocker) {
                if (smelting && smelting.report.reachFailures > reachBefore)
                    return { kind:'blocked', why:`server reported a smelting reach failure: ${r.blocker}` };
                const fresh = this.sdk.getState()!;
                const req = workRequirements(fresh, order.action, order.args);
                const depleted = /^(smith|smelt|cook|craft|fletch|firemake)$/.test(order.action)
                    && req.items.some(n => !n.tool && heldNeed(fresh, n) < n.count);
                if (!exhaust && depleted && worked) {
                    const readiness = nextPreparation(fresh, bankOf(this.name)?.items ?? {}, order);
                    if (readiness.preparation) { prepared = false; preparations = 0; continue; }
                    return { kind: 'partial', why: `made progress but usable inputs ran out; target remains unfinished: ${r.blocker}` };
                }
                return exhaust && worked ? { kind: 'done', why: `ran out: ${r.blocker}` } : { kind: 'blocked', why: r.blocker };
            }
            if (iron && smelting?.retryLimitReached) return ironLossYield(smelting);
            if (r.aborted) continue;
            if (def.oneShot) return { kind: 'done', why: '' };
            if (iron && smelting && smelting.report.impurityFailures > lossesBefore && smelting.report.reachFailures === reachBefore) {
                // A confirmed failed refinement proves an attempt ran, but is
                // not a bar or XP gain. Keep its separate finite retry budget.
                idlePasses = 0;
                continue;
            }
            // Assist has its own finite rendezvous/regroup/idle deadlines; following is not XP.
            if (order.action === 'assist') continue;
            const idle = idlePass(order.action, r.progress, idlePasses);
            idlePasses = idle.idlePasses;
            if (idle.stuck) return smelting && smelting.report.reachFailures > reachBefore
                ? { kind:'blocked', why:'server reported reach failures during repeated smelting passes without output' }
                : withStallCause(idle.stuck, r.stall);
        }
    }

    private async runPass(action: string, args: Args, orderEnd: number, stopWhen?: (gained: Map<string, number>) => boolean, smelting?: SmeltingObservation) {
        const def = SKILLS[action];
        const controller = new AbortController();
        this.pass = controller;
        const deadline = Math.min(Date.now() + PASS_MS, orderEnd);
        // Hard stop in case a skill ignores its deadline.
        const hard = setTimeout(() => controller.abort(new Error('pass overran')), deadline - Date.now() + 45_000);
        const xp0 = this.xp();
        const inv0 = this.inventoryCounts();
        const stall: { why?: string } = {};
        let blocker: string | void = undefined;
        let aborted = false;
        const gainedNow = () => {
            const m = new Map<string, number>();
            for (const [n, c] of this.inventoryCounts()) if (c > (inv0.get(n) ?? 0)) m.set(n, c - (inv0.get(n) ?? 0));
            return m;
        };
        const watch = stopWhen && setInterval(() => stopWhen(gainedNow()) && controller.abort(new Error('step goal reached')), 1000);
        const watchLosses = smelting && this.sdk.onStateUpdate?.(s => {
            smelting.observe(s.gameMessages);
            if (smelting.retryLimitReached) controller.abort(new Error('confirmed iron impurity retry budget reached'));
        });
        try {
            const ctx = { bot: this.bot, sdk: this.sdk, name: this.name, deadline, finalPass: deadline === orderEnd, fightReport: this.fightObservation, signal: controller.signal, tactics: this.memory.tactics as any, notes: this.stepNotes, stall, observeWorld:(dialogue?:string,dispatch?:{success:boolean;message:string})=>{
                this.worldObservation=observeWorld(this.sdk.getState(),this.sdk.getStateReceivedAt?.(),Date.now(),dialogue,dispatch);
            } };
            // Every step starts with the danger check (eat, or flee under attack at low HP): walks to a
            // bank or a teammate are where hurt characters died.
            const hurt = action === 'rest' || safeFoodRecovery(this.sdk.getState(),action,args.target) ? undefined : await danger(ctx);
            blocker = hurt ?? (await executionContext.run({ signal: controller.signal }, () => abortable(def.run(ctx, args))));
        } catch (e: any) {
            if (controller.signal.aborted) aborted = true;
            else {
                blocker = `${action} failed: ${e?.message ?? e}`;
                emit(this.name, 'error', { error: blocker });
            }
        } finally {
            clearTimeout(hard);
            if (watch) clearInterval(watch);
            watchLosses?.();
            smelting?.observe(this.sdk.getState()?.gameMessages);
            this.pass = null;
        }
        const gained = gainedNow();
        const progress = measuredWorkProgress(action, gained, this.xpGainedSince(xp0));
        return { blocker, aborted, gained: action === 'bank_resources' ? new Map<string, number>() : gained, progress, stall: progress ? undefined : stall.why };
    }

    private untilMet(order: Order, gathered: Map<string, number>): boolean {
        const u = order.until;
        if (u.type === 'skill_level' && u.skill) {
            const level = progressLevel(this.sdk.getState(), u.skill);
            return level >= u.value;
        }
        if (u.type === 'gathered' && u.item) {
            const re = new RegExp(escape(u.item.replace(/s$/i, '')), 'i');
            let n = 0;
            for (const [name, c] of gathered) if (re.test(name)) n += c;
            return n >= u.value;
        }
        return false;
    }

    // ------------------------------------------------------------ giving

    private async serveInbox(): Promise<void> {
        while (this.inbox.length && !this.stopped) {
            const h = this.inbox.shift()!;
            const p = this.sdk.getState()?.player;
            if (!p) return;
            const prev = this.status;
            this.status = `receiving ${h.item} from ${h.from}`;
            h.ready = { x: p.worldX, z: p.worldZ };
            h.onReady?.();
            const r = await this.bot
                .serveTrades({ from: new RegExp(`^${escape(h.from)}$`, 'i'), maxTrades: 1, timeout: 120_000 })
                .catch(e => ({ success: false, message: String(e) }));
            // serveTrades "succeeds" when its window simply ends; only a completed trade is a receipt.
            const got = r.success && !/after 0 completed/.test(r.message ?? '');
            emit(this.name, 'trade', { summary: `received from ${h.from}: ${got ? 'ok' : 'nothing received'} (${r.message})` });
            this.status = prev;
        }
    }

    private async give(g: { to: string; item: string; amount: number | null }): Promise<string> {
        const to = [...agents.values()].find(x => x.name.toLowerCase() === g.to.toLowerCase());
        if (!to || to === this) return `no teammate named ${g.to}`;
        // Bank notes carry the item's own name in the pack, so "copper ore noted" is copper ore.
        g = { ...g, item: g.item.replace(/\(?\bnoted?\b\)?/i, '').trim() };
        // "cooked shrimps" is the pack's "Shrimps" exactly, never its "Raw shrimps".
        const cooked = /^cooked\s+/i.test(g.item);
        if (cooked) g = { ...g, item: g.item.replace(/^cooked\s+/i, '') };
        if (!g.item) return 'no item named';
        const base = escape(g.item.replace(/s$/i, ''));
        const pattern = new RegExp(`^${base}s?$`, 'i');
        const matching = this.sdk.getInventory().filter(i => pattern.test(i.name));
        if (new Set(matching.map(i => i.id)).size > 1)
            return `ambiguous ${g.item}: your pack contains different item forms matching that name. Bank them, then withdraw only the intended form before giving; nothing traded`;
        const have = this.sdk.countInventoryItems(pattern);
        // Agents reach for give to receive items; say which way it goes.
        if (have <= 0) return `you have no ${g.item} in your pack. Giving only hands over what you carry; ${to.name} would have to give it to you`;
        let amount = g.amount && g.amount > 0 ? Math.min(g.amount, have) : have;
        // Unstacked items need a free slot each on the other side: hand over what fits.
        const stacked = this.sdk.getInventory().some(i => pattern.test(i.name) && i.count > 1);
        const free = 28 - to.sdk.getInventory().length;
        if (!stacked && free <= 0) {
            to.notice(`${this.name} tried to give you ${amount} ${g.item}, but your pack had no free slot, so nothing was handed over.`);
            return `trade failed: ${to.name}'s pack has no free slot; they have been told`;
        }
        const short = !stacked && amount > free ? amount - free : 0;
        amount -= short;

        const h: Handoff = { from: this.name, item: g.item, amount };
        const ready = new Promise<void>(res => (h.onReady = res));
        to.deliver(h);
        const met = await Promise.race([ready.then(() => true), sleep(120_000).then(() => false)]);
        if (!met || !h.ready) {
            to.inbox = to.inbox.filter(x => x !== h);
            return `${to.name} was too busy to meet`;
        }
        // goNear pays the Al Kharid toll on the way; a bare walk stops at the gate.
        const ac = new AbortController();
        const ctx = { bot: this.bot, sdk: this.sdk, name: this.name, deadline: Date.now() + 90_000, signal: ac.signal };
        // Where the receiver waits may be a place that hunts the giver: attacks close the trade screen.
        const st = this.sdk.getState();
        const hunted = st ? huntedAt(st, h.ready) : null;
        if (hunted) {
            to.inbox = to.inbox.filter(x => x !== h);
            return `trade abandoned: ${to.name} waits where ${hunted}; being attacked closes the trade screen`;
        }
        // A hand-over is no safer than any other step: eat or run if something is attacking.
        const hurt = (await danger(ctx)) ?? (await goNear(ctx, h.ready.x, h.ready.z, 2)) ?? (await danger(ctx));
        if (hurt && /HP \d+/.test(hurt)) {
            to.inbox = to.inbox.filter(x => x !== h);
            return `trade abandoned: ${hurt}`;
        }
        const r = await this.bot.trade(to.name, { give: [{ item: pattern, amount }], requestTimeout: 30_000, timeout: 45_000 });
        emit(this.name, 'trade', { summary: `gave ${amount} ${g.item} to ${to.name}: ${r.success ? 'ok' : r.message}` });
        if (r.success) {
            noteDelivery(this.name, to.name, g.item, amount);
            recordHandoff({ from: this.name, to: to.name, item: g.item, amount });
        }
        if (!r.success && /inventory space/i.test(r.message)) {
            // Only the giver hears about it otherwise, and the receiver's pack stays full.
            const slots = to.sdk.getInventory().length;
            to.notice(`${this.name} tried to give you ${amount} ${g.item}, but your pack had only ${28 - slots} free slots (${slots}/28 used), so the trade failed.`);
            return `trade failed: ${to.name}'s pack had only ${28 - slots} free slots (${slots}/28 used); they have been told`;
        }
        if (r.success && short) to.notice(`${this.name} gave you ${amount} ${g.item}; ${short} more did not fit in your pack (it is now full).`);
        return r.success ? `gave ${amount} ${g.item} to ${to.name}${short ? `; ${short} more did not fit in ${to.name}'s pack, so you still carry them` : ''}` : `trade failed: ${r.message}`;
    }

    // ------------------------------------------------------------ helpers

    private xp(): Map<string, number> {
        return new Map((this.sdk.getState()?.skills ?? []).map(s => [s.name, s.experience]));
    }

    private xpGainedSince(xp0: Map<string, number>): Record<string, number> {
        const out: Record<string, number> = {};
        for (const s of this.sdk.getState()?.skills ?? []) {
            const d = s.experience - (xp0.get(s.name) ?? s.experience);
            if (d > 0) out[s.name] = d;
        }
        return out;
    }

    private inventoryCounts(): Map<string, number> {
        const counts = new Map<string, number>();
        for (const i of this.sdk.getInventory()) counts.set(i.name, (counts.get(i.name) ?? 0) + i.count);
        return counts;
    }
}
