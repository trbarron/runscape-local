import { expect,test } from 'bun:test';
import type { BotWorldState } from '../rs-sdk/sdk/types';
import { observationKey } from './observation-cadence';
const state=()=>({tick:1,player:{worldX:3000,worldZ:3320,level:0,hp:80,isDead:false,combat:{inCombat:false}},
    nearbyNpcs:[{index:1,id:9,x:3005,z:3322,distance:5,reachable:true,hp:20,inCombat:false,optionsWithIndex:[{text:'Attack'}]}],
    nearbyLocs:[],nearbyPlayers:[],equipment:[],groundItems:[],dialog:{isOpen:false,options:[]}} as unknown as BotWorldState);
test('idle ticks and same-zone wandering do not provoke another model decision',()=>{
    const a=state(),b=state(); b.tick++; b.nearbyNpcs[0].x=3006;
    expect(observationKey(a)).toBe(observationKey(b));
});
test('target zone, reachability, death, arrival and combat changes remain actionable',()=>{
    for(const change of [
        (s:BotWorldState)=>{s.nearbyNpcs[0].x=3009;},
        (s:BotWorldState)=>{s.nearbyNpcs[0].reachable=false;},
        (s:BotWorldState)=>{s.nearbyNpcs[0].hp=0;},
        (s:BotWorldState)=>{s.player!.combat.inCombat=true;},
        (s:BotWorldState)=>{s.player!.hp--;},
        (s:BotWorldState)=>{s.nearbyNpcs.push({...s.nearbyNpcs[0],index:2});},
    ]) {const a=state(),b=state();change(b);expect(observationKey(a)).not.toBe(observationKey(b));}
});
