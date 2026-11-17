import { npcTargetFacts } from './npc-observation';
import type { BotWorldState, NearbyNpc } from '../rs-sdk/sdk/types';
import type { Ctx, Tactics } from './skills';
import { abortable, executionContext } from '../rs-sdk/sdk/execution-context';
import { isMulticombat } from './multicombat';

export const ASSIST_MS = 15 * 60_000;
export interface AssistPair {
    id: number; leader: string; assistant: string; leaderRoutine: number; fightStep: number;
    created: number; expires: number; phase: 'invited' | 'accepted' | 'ready' | 'active';
    engagements?: number; moves?: number; sharedKey?: string;
    readyAt?: number; separatedAt?: number; idleAt?: number; mismatchAt?: number;
}
export class AssistRegistry {
    private pairs = new Map<number, AssistPair>();
    private serial = 0;
    constructor(private now = Date.now) {}
    get(name: string): AssistPair | undefined {
        for (const [id, p] of this.pairs) {
            if (p.expires <= this.now() || (!p.readyAt && this.now() > p.created + 60_000)) { this.pairs.delete(id); continue; }
            if (p.leader === name || p.assistant === name) return p;
        }
    }
    offer(leader: string, assistant: string, leaderRoutine: number, fightStep: number): AssistPair | string {
        if (leader === assistant) return 'choose another character';
        if (this.get(leader) || this.get(assistant)) return 'one of you already has an assist invitation or session';
        const p: AssistPair = { id: ++this.serial, leader, assistant, leaderRoutine, fightStep,
            created: this.now(), expires: this.now() + ASSIST_MS, phase: 'invited' };
        this.pairs.set(p.id, p); return p;
    }
    accept(assistant: string, leader: string): AssistPair | string {
        const p = this.get(assistant);
        if (!p || p.leader !== leader || p.assistant !== assistant) return 'no current invitation from that leader';
        if (p.phase === 'invited') p.phase = 'accepted';
        return p;
    }
    end(id: number): void { this.pairs.delete(id); }
    cancelMember(name: string, keepIncoming = false): void { const p = this.get(name); if (p && !(keepIncoming && p.assistant === name && p.phase === 'invited')) this.end(p.id); }
    describe(name: string): string {
        const p = this.get(name);
        return p ? `Assist #${p.id}: ${p.leader} leads, ${p.assistant} assists; ${p.phase}, ${Math.max(0, Math.ceil((p.expires-this.now())/60_000))} min left. ${p.phase === 'invited' && p.assistant === name ? `You may accept with assist (${p.leader}) or choose other work.` : ''}` : 'No current assist agreement.';
    }
}
export const assistPairs = new AssistRegistry();

export interface AssistPeer {
    state: BotWorldState | null; receivedAt: number; connected: boolean;
    action: string | null; routineId: number; step: number;
}
export type PeerLookup = (name: string) => AssistPeer | undefined;
const distance = (a: {worldX:number;worldZ:number}, b:{worldX:number;worldZ:number}) => Math.hypot(a.worldX-b.worldX,a.worldZ-b.worldZ);

export function peerBlocker(own: AssistPeer, peer: AssistPeer | undefined, now: number): string | null {
    if (!peer || !own.connected || !peer.connected || !own.state?.inGame || !peer.state?.inGame) return 'partner or assistant disconnected';
    if (![own.receivedAt, peer.receivedAt].every(t => t > 0 && now-t >= 0 && now-t <= 5000)
        || ![own.state.tick,peer.state.tick].every(Number.isFinite) || Math.abs(own.state.tick-peer.state.tick) > 5) return 'stale or disagreeing game publications';
    const a=own.state.player, b=peer.state.player;
    if (!a || !b || ![a.hp,a.maxHp,b.hp,b.maxHp].every(v=>Number.isFinite(v)&&v>0) || a.isDead || b.isDead) return 'partner or assistant not alive';
    if (![a.worldX,a.worldZ,b.worldX,b.worldZ].every(Number.isFinite) || a.level !== 0 || b.level !== 0) return 'assist requires known positions on ground floor';
    if (distance(a,b)>64) return 'partner is over 64 tiles away; meet safely before inviting';
    return null;
}
export function sharedTarget(own: BotWorldState, leader: BotWorldState): NearbyNpc | undefined {
    const combat=leader.player?.combat;
    if (!combat?.inCombat || combat.targetType !== 'npc') return;
    const remote=leader.nearbyNpcs.find(n=>n.index===combat.targetIndex);
    const local=own.nearbyNpcs.find(n=>n.index===combat.targetIndex);
    if (!remote || !local || !Number.isFinite(local.distance) || local.distance<0 || local.id!==remote.id || ![remote.tileX,remote.tileZ,local.tileX,local.tileZ].every(v=>typeof v==='number'&&Number.isFinite(v))) return;
    if (Math.hypot(local.tileX!-remote.tileX!,local.tileZ!-remote.tileZ!)>2 || local.reachable!==true
        || local.hp===0 || local.healthPercent===0 || !local.optionsWithIndex.some(o=>/^attack$/i.test(o.text))) return;
    return local;
}
export function assistRoutineProblem(steps: {action:string;until:{type:string;value:number}}[], repeat: boolean): string | null {
    if (!steps.some(s=>/^(assist|invite_assist)$/.test(s.action))) return null;
    if (repeat) return 'assist sessions cannot repeat; agree a fresh session';
    const invite=steps.findIndex(s=>s.action==='invite_assist');
    if (invite>=0 && (invite!==0 || steps.filter(s=>s.action==='invite_assist').length!==1 || steps[1]?.action!=='fight'))
        return 'invite_assist must be the first step, immediately followed by fight';
    if (steps.some(s=>s.action==='assist') && (steps.length!==1 || steps[0].action!=='assist')) return 'assist must be the only step in its routine';
    for (const s of steps.filter(s=>/^(assist|invite_assist)$/.test(s.action) || (invite===0&&s===steps[1]))) {
        if (s.until.type!=='minutes' || !Number.isFinite(s.until.value) || s.until.value<1 || s.until.value>15) return 'assist and its agreed fight require minutes stops from 1 to 15';
        if (s.action==='invite_assist' && s.until.value!==1) return 'invite_assist uses minutes 1 (60-second rendezvous)';
    }
    return null;
}

export interface AssistOps {
    peers: PeerLookup; registry: AssistRegistry; tactics: Tactics;
    eat: () => Promise<unknown>; flee: () => Promise<unknown>; style: () => Promise<unknown>;
    announce: (text:string) => void;
    engagement?:(e:{at:number;target:string;index:number;id:number;x:number;z:number;plane:number;leader:string;assistant:string;leaderRoutine:number})=>void;
    invite: (to:string,text:string) => boolean;
    now?: () => number;
}
const live = (p: AssistPair, peers: PeerLookup, registry: AssistRegistry, now:number): string | null => {
    if (registry.get(p.leader)?.id!==p.id || now>=p.expires) return 'assist agreement ended or expired';
    const l=peers(p.leader), a=peers(p.assistant);
    if (!a) return 'assistant disconnected';
    const bad=peerBlocker(a,l,now); if(bad) return bad;
    if (l!.routineId!==p.leaderRoutine || !((l!.action==='invite_assist'&&l!.step===p.fightStep-1)
        || (l!.action==='fight'&&l!.step===p.fightStep))) return 'leader changed the agreed activity';
    return null;
};
const safeHp = (s: BotWorldState | null, t:Tactics) => !!s?.player && s.player.hp>=s.player.maxHp*t.retreat_below/100;

/** Waits and movement are cancellable even when a fake/third-party action ignores its timeout. */
async function guarded<T>(c:Ctx, ms:number, guard:()=>boolean, work:()=>Promise<T>): Promise<T | undefined> {
    if (!guard() || c.signal.aborted) return;
    const stop=new AbortController();
    const signal=AbortSignal.any([c.signal,stop.signal]);
    const timer=setTimeout(()=>stop.abort(new Error('assist action deadline')),Math.max(1,ms));
    const watch=setInterval(()=>{if(!guard())stop.abort(new Error('assist state changed'));},200);
    try { return await executionContext.run({signal},()=>abortable(work(),signal)); }
    catch(e) { if(!signal.aborted) throw e; }
    finally { clearTimeout(timer);clearInterval(watch); }
}

export async function runInvite(c:Ctx, assistant:string, ops:AssistOps):Promise<string|void> {
    const now=ops.now??Date.now;
    const leader=ops.peers(c.name);
    if(!leader || !ops.peers(assistant)) return 'unknown or offline partner';
    const bad=peerBlocker(leader,ops.peers(assistant),now());if(bad)return bad;
    const made=ops.registry.offer(c.name,assistant,leader.routineId,leader.step+1);
    if(typeof made==='string')return made;
    const p=made;
    let ready=false;
    try {
        ops.announce(`assist #${p.id} invited ${assistant}`);
        if(!ops.invite(assistant,`I invite you to assist my next fight for at most 15 minutes. You may choose assist (${c.name}) now or decline by continuing your work. Meet me within 60 seconds; keep your own safety rules.`)) return 'invitation could not be delivered';
        while(!c.signal.aborted && now()<Math.min(c.deadline,p.created+60_000)) {
            const bad=live(p,ops.peers,ops.registry,now());if(bad)return bad;
            const s=c.sdk.getState();
            if(s?.player && s.player.hp<s.player.maxHp*ops.tactics.eat_below/100) await ops.eat();
            if(!safeHp(c.sdk.getState(),ops.tactics))return 'leader below own retreat threshold';
            if(p.readyAt && !c.sdk.getState()?.player?.combat.inCombat) { ready=true;ops.announce(`assist #${p.id} ready with ${assistant}`);return; }
            await c.sdk.waitForTicks(1);
        }
        return 'assist invitation timed out without a ready partner';
    } finally { if(!ready)ops.registry.end(p.id); }
}

export async function runAssist(c:Ctx, leader:string, ops:AssistOps):Promise<string|void> {
    const now=ops.now??Date.now;
    const accepted=ops.registry.accept(c.name,leader);
    if(typeof accepted==='string')return accepted;
    const p=accepted;
    let terminal=false, reason='pass ended';
    p.engagements??=0; p.moves??=0; p.sharedKey??='';
    const valid=()=>!c.signal.aborted&&!live(p,ops.peers,ops.registry,now());
    const end=(why:string)=>{terminal=true;reason=why;return why;};
    ops.announce(`assist #${p.id} ${c.name} accepted/following ${leader}`);
    try {
        const initialBad=live(p,ops.peers,ops.registry,now());if(initialBad)return end(initialBad);
        await ops.style();
        while(!c.signal.aborted && now()<c.deadline) {
            const bad=live(p,ops.peers,ops.registry,now());if(bad)return end(bad);
            const own=c.sdk.getState()!;
            if(own.player!.hp<own.player!.maxHp*ops.tactics.eat_below/100)await ops.eat();
            if(!safeHp(c.sdk.getState(),ops.tactics))return end('assistant below own retreat threshold');
            if(!valid())continue;
            const remote=ops.peers(leader)!, s=c.sdk.getState()!, a=s.player!, b=remote.state!.player!;
            const d=distance(a,b);
            if(d>4) {
                p.separatedAt??=now();
                const deadline=p.readyAt?p.separatedAt+20_000:p.created+60_000;
                if(now()>=deadline)return end('could not regroup in time');
                // Do not drag an unrelated fight or leave an old target attacking on a follow walk.
                if(a.combat.inCombat)return end('separated while fighting; disengaging');
                const fraction=Math.min(1,8/d);
                const x=Math.round(a.worldX+(b.worldX-a.worldX)*fraction), z=Math.round(a.worldZ+(b.worldZ-a.worldZ)*fraction);
                await guarded(c,Math.min(3000,deadline-now(),p.expires-now(),c.deadline-now()),
                    ()=>valid()&&safeHp(c.sdk.getState(),ops.tactics),()=>{p.moves!++;return c.bot.walkTo(x,z,2,{timeout:3000});});
                continue;
            }
            p.separatedAt=undefined;
            if(!p.readyAt && !a.combat.inCombat){p.readyAt=now();p.phase='ready';ops.announce(`assist #${p.id} rendezvous ready`);}
            if(remote.action==='invite_assist') {
                if(now()>=p.created+60_000)return end('leader did not start agreed fight');
                await c.sdk.waitForTicks(1);continue;
            }
            const npc=sharedTarget(s,remote.state!);
            const ownCombat=a.combat;
            if(ownCombat.inCombat && (!npc || ownCombat.targetType!=='npc' || ownCombat.targetIndex!==npc.index))
                return end('leader left or changed target; disengaging');
            if(!remote.state!.player!.combat.inCombat || remote.state!.player!.combat.targetType!=='npc') {
                p.sharedKey='';p.idleAt??=now();
                if(now()-p.idleAt>=30_000)return end('leader has no NPC fight for 30 seconds');
                await c.sdk.waitForTicks(1);continue;
            }
            p.idleAt=undefined;
            if(!npc){p.sharedKey='';p.mismatchAt??=now();if(now()-p.mismatchAt>=3000)return end('could not verify the exact shared NPC');await c.sdk.waitForTicks(1);continue;}
            p.mismatchAt=undefined;
            if(!isMulticombat(npc.tileX!,npc.tileZ!,0))return end(`target is outside mapped multicombat; cannot join: ${npcTargetFacts(npc,s.player?.level,now()-(ops.peers(c.name)?.receivedAt ?? NaN))}`);
            if(npc.distance>2) { // move near the leader/target, then fully revalidate in a new iteration
                if(ownCombat.inCombat){await c.sdk.waitForTicks(1);continue;}
                await guarded(c,Math.min(3000,p.expires-now(),c.deadline-now()),()=>valid()&&safeHp(c.sdk.getState(),ops.tactics)&&sharedTarget(c.sdk.getState()!,ops.peers(leader)!.state!)?.index===npc.index,
                    ()=>{p.moves!++;return c.bot.walkTo(npc.tileX!,npc.tileZ!,2,{timeout:3000});});
                continue;
            }
            const key=`${npc.index}:${npc.id}`;
            if(ownCombat.inCombat) {
                p.phase='active';
                if(p.sharedKey!==key){p.engagements++;p.sharedKey=key;ops.engagement?.({at:now(),target:npc.name,index:npc.index,id:npc.id,x:npc.tileX!,z:npc.tileZ!,plane:0,leader:p.leader,assistant:p.assistant,leaderRoutine:p.leaderRoutine});ops.announce(`assist #${p.id} confirmed shared engagement ${npc.name} [${key}]`);}
            } else {
                p.sharedKey='';
                // No await between final identity/consent checks and synchronous SDK dispatch.
                if(!valid()||!safeHp(c.sdk.getState(),ops.tactics))continue;
                const fresh=sharedTarget(c.sdk.getState()!,ops.peers(leader)!.state!);
                if(!fresh||fresh.index!==npc.index||fresh.id!==npc.id||fresh.distance>2||!isMulticombat(fresh.tileX!,fresh.tileZ!,0))continue;
                const option=fresh.optionsWithIndex.find(o=>/^attack$/i.test(o.text))!;
                const result=await guarded(c,Math.min(3000,p.expires-now(),c.deadline-now()),valid,
                    ()=>c.sdk.sendInteractNpc(fresh.index,option.opIndex));
                if(result&&!result.success)return end(`server refused assist attack: ${result.message}`);
                // Never count packet submission as shared engagement. Wait for state, no tight retries.
                const before=c.sdk.getState()?.revision??c.sdk.getState()?.tick;
                await guarded(c,3000,valid,()=>c.sdk.waitForCondition(st=>(st.revision??st.tick)!==before,2500));
                const after=c.sdk.getState();
                if(valid() && !(after?.player?.combat.inCombat&&after.player.combat.targetType==='npc'&&after.player.combat.targetIndex===fresh.index))
                    return end('no confirmed shared engagement after attack; not retrying');
            }
            await c.sdk.waitForTicks(1);
        }
        if (!c.signal.aborted && c.finalPass) { terminal=true; reason='agreed assist duration reached'; }
    } catch (error) {
        if (c.signal.aborted) throw error;
        return end(`assist observation/action failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        c.notes?.push(`assist report #${p.id}: ${p.engagements} confirmed shared engagements, ${p.moves} follow attempts (session totals); ${reason}; no shared kills inferred`);
        if(c.signal.aborted)ops.registry.end(p.id);
        if(terminal) {
            ops.registry.end(p.id);ops.announce(`assist #${p.id} ended: ${reason}`);
            if(!c.signal.aborted&&c.sdk.getState()?.player?.combat.inCombat)
                await guarded(c,10_000,()=>!c.signal.aborted,ops.flee);
        }
    }
}
