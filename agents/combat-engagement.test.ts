import {expect,test} from 'bun:test';
import type {BotWorldState,NearbyNpc} from '../rs-sdk/sdk/types';
import {waitForEngagement,exactCombat,awaitCombatWindDown} from './combat-engagement';
const target={index:7,id:12,hp:52,healthPercent:100} as NearbyNpc;
const s=()=>({player:{hp:60,maxHp:100,combat:{inCombat:true,targetType:'npc',targetIndex:7}},nearbyNpcs:[{...target}]} as BotWorldState);
const tactics={eat_below:75,retreat_below:35,finish_if_enemy_below:0,target:'nearest',style:'keep',loot:'bones'} as const;
test('low HP with no food cannot fall out after six immediate rounds; active zero-XP target stays selected',async()=>{
    const state=s();let ticks=0,eats=0;
    const result=await waitForEngagement({target,state:()=>state,tactics,going:()=>ticks<12,
        eat:async()=>{eats++;},next:async()=>{ticks++;if(ticks===10)state.nearbyNpcs[0].hp=0;}});
    expect(result).toBe('ended');expect(ticks).toBe(10);expect(eats).toBe(10); // no XP evidence required
});
test('pass boundary retains live engagement, instead of allowing loot or replacement',async()=>{
    const state=s();let ticks=0;
    expect(await waitForEngagement({target,state:()=>state,tactics,going:()=>ticks<3,eat:async()=>{},next:async()=>{ticks++;}})).toBe('pass-ended');
    expect(exactCombat(state,target)).toBe(true);
});
test('retreat threshold and unrelated NPC/player target are honored',async()=>{
    for(const mode of ['low','npc','player']) {
        const state=s();if(mode==='low')state.player!.hp=30;else{state.player!.combat.targetIndex=9;state.player!.combat.targetType=mode as 'npc'|'player';}
        expect(await waitForEngagement({target,state:()=>state,tactics,going:()=>true,eat:async()=>{},next:async()=>{throw Error('should retreat');}})).toBe('retreat');
    }
});
test('eating does not itself end an unresolved live encounter',async()=>{
    const state=s();let ticks=0;
    const result=await waitForEngagement({target,state:()=>state,tactics,going:()=>ticks<5,
        eat:async()=>{state.player!.hp=90;},next:async()=>{ticks++;if(ticks===3)state.nearbyNpcs=[];}});
    expect(result).toBe('ended');expect(ticks).toBe(3);
});

test('a lingering combat flag with no target is waited out, not treated as another fight',async()=>{
    const state=s();state.player!.combat={inCombat:true,targetType:'none',targetIndex:-1,lastDamageTick:-1};
    let ticks=0;
    await awaitCombatWindDown({state:()=>state,going:()=>true,next:async()=>{if(++ticks===3)state.player!.combat.inCombat=false;}});
    expect(ticks).toBe(3);
});
test('wind-down is bounded, ignores real targets and stops when the order stops',async()=>{
    const state=s();state.player!.combat={inCombat:true,targetType:'none',targetIndex:-1,lastDamageTick:-1};
    let ticks=0;
    await awaitCombatWindDown({state:()=>state,going:()=>true,next:async()=>{ticks++;}},10);
    expect(ticks).toBe(10);
    state.player!.combat={inCombat:true,targetType:'npc',targetIndex:7,lastDamageTick:-1};ticks=0;
    await awaitCombatWindDown({state:()=>state,going:()=>true,next:async()=>{ticks++;}});
    expect(ticks).toBe(0);
    state.player!.combat={inCombat:true,targetType:'none',targetIndex:-1,lastDamageTick:-1};
    await awaitCombatWindDown({state:()=>state,going:()=>false,next:async()=>{ticks++;}});
    expect(ticks).toBe(0);
});

test('wind-down stops immediately on fresh damage, lost state or a new real target',async()=>{
    for(const change of ['hp','damage','target','lost']) {
        let state:BotWorldState|null=s();
        state.player!.combat={inCombat:true,targetType:'none',targetIndex:-1,lastDamageTick:5};
        let ticks=0;
        await awaitCombatWindDown({state:()=>state,going:()=>true,next:async()=>{
            ticks++;
            if(change==='hp')state!.player!.hp--;
            if(change==='damage')state!.player!.combat.lastDamageTick++;
            if(change==='target')state!.player!.combat={inCombat:true,targetType:'npc',targetIndex:9,lastDamageTick:5};
            if(change==='lost')state=null;
        }});
        expect(ticks).toBe(1);
    }
});
