import { expect, test } from 'bun:test';
import type { BotWorldState, NearbyNpc } from '../rs-sdk/sdk/types';
import { FightObservation } from './fight-report';
const npc=(index=7,id=12,hp=8)=>({index,id,hp,healthPercent:hp?100:0,name:'Cow'} as NearbyNpc);
const state=(npcs:NearbyNpc[],target=7,hp=50,lifeId=1)=>({nearbyNpcs:npcs,player:{hp,lifeId,combat:{inCombat:target>=0,targetType:target>=0?'npc':'none',targetIndex:target}},inventory:[]} as unknown as BotWorldState);

test('whole-order observations accumulate across passes; identical and unrelated NPC updates do not create kills',()=>{
    let now=0;const r=new FightObservation(()=>now);
    for(let pass=0;pass<3;pass++) {
        const n=npc(7+pass);r.select(n);r.observe(state([n],n.index));
        now+=90_000;r.observe(state([npc(n.index,n.id,0)],-1));
        r.observe(state([npc(n.index,n.id,0)],-1));
    }
    const result=r.finish({Attack:96});
    expect(result.engagements).toBe(3);expect(result.observedTargetDefeats).toBe(3);
    expect(result.elapsedMs).toBe(270_000);expect(result.xpPerHour.Attack).toBe(1280);
    expect(r.summary()).toContain('whole order');expect(r.summary()).not.toContain('cows killed');
});
test('other nearby deaths, missing targets, config reuse and unfinished encounters are not confirmed kills',()=>{
    const r=new FightObservation();r.select(npc());r.observe(state([npc(),npc(8,12,0)]));
    expect(r.report.observedTargetDefeats).toBe(0);
    r.observe(state([npc(7,99,0)],-1));
    expect(r.report.unresolvedEnds).toBe(1);expect(r.report.observedTargetDefeats).toBe(0);
    r.select(npc(9));r.observe(state([npc(9)],9));r.finish();
    expect(r.report.unresolvedEnds).toBe(2);expect(r.report.observedTargetDefeats).toBe(0);
});
test('failed attack submissions and an already dead target are not engagements',()=>{
    const r=new FightObservation();r.select(npc());r.observe(state([npc(7,12,0)],-1));r.finish();
    expect(r.report.engagements).toBe(0);expect(r.report.observedTargetDefeats).toBe(0);
});
test('same active target survives pass selection; respawned index can start a new observed engagement',()=>{
    const r=new FightObservation();r.select(npc());r.observe(state([npc()]));
    r.select(npc());r.observe(state([npc()]));expect(r.report.engagements).toBe(1);
    r.observe(state([npc(7,12,0)],-1));r.select(npc());r.observe(state([npc()]));
    r.observe(state([npc(7,12,0)],-1));
    expect(r.finish().observedTargetDefeats).toBe(2);
});
test('timed operations partition the whole order even on errors, and late cleanup cannot mutate a finished report',async()=>{
    let now=0;const r=new FightObservation(()=>now);
    now=10;await r.during('moving',async()=>{now=30;});
    await r.during('combat',async()=>{now=100;});
    try {await r.during('looting',async()=>{now=120;throw Error('interrupted');});}catch{}
    now=130;const result=r.finish();
    expect(result.phaseMs).toEqual({other:20,moving:20,combat:70,looting:20});
    expect(Object.values(result.phaseMs).reduce((a,b)=>a+b,0)).toBe(result.elapsedMs);
    const frozen=JSON.stringify(result);now=999;r.observe(state([npc(7,12,0)]));r.setPhase('combat');r.finish();
    expect(JSON.stringify(result)).toBe(frozen);
});
test('observed HP losses dedupe snapshots and do not count respawn reset; food counts only observed successful eating',()=>{
    const r=new FightObservation();r.observe(state([], -1,50));r.observe(state([],-1,45));r.observe(state([],-1,45));
    r.observe(state([],-1,20,2));expect(r.report.observedHpLost).toBe(5);
    const before=state([],-1,45),after=state([],-1,50);
    before.inventory=[{name:'Trout',count:5}] as BotWorldState['inventory'];after.inventory=[{name:'Trout',count:4}] as BotWorldState['inventory'];
    r.observe(after);expect(r.report.foodEaten).toBe(0); // deposit/trade change alone is not eating
    r.food(before,after,false);expect(r.report.foodEaten).toBe(0);
    r.food(before,after,true);expect(r.report.foodEaten).toBe(1);
    expect(r.report.nominalHealingConsumed).toBe(7);expect(r.report.foodByName).toEqual({Trout:1});
});

test('structured defeat retains actual target tile and requires fresh observation independently of aggregate counts',()=>{
 let time=10000;const r=new FightObservation(()=>time);const n=npc();Object.assign(n,{name:'Guard',tileX:2960,tileZ:3381});
 r.select(n);r.observe(state([n]),time);r.observe(state([{...n,hp:0,healthPercent:0}]),time);
 expect(r.defeats[0]).toMatchObject({t:10000,index:n.index,id:n.id,name:'Guard',x:2960,z:3381});
 const stale=new FightObservation(()=>time);stale.select(n);stale.observe(state([n]),time);time+=6000;stale.observe(state([{...n,hp:0,healthPercent:0}]),10000);
 expect(stale.report.observedTargetDefeats).toBe(1);expect(stale.defeats).toHaveLength(0);
});
