import { expect, test } from 'bun:test';
import type { BotWorldState, NearbyNpc } from '../rs-sdk/sdk/types';
import { nearbyNpcSummary, npcTargetFacts } from './npc-observation';

const guard = (index: number, x = 3006, z = 3322) => ({name:'Guard',index,id:9,x,z,tileX:x,tileZ:z,
    distance:3,reachable:true,optionsWithIndex:[{text:'Attack',opIndex:2}]} as NearbyNpc);
test('live Falador guards expose exact identity, tile, zone and reachability', () => {
    expect(npcTargetFacts(guard(3149),0,100)).toBe('Guard#3149/9@3006,3322,p0 multi reachable');
    expect(npcTargetFacts(guard(3150,3005),0,100)).toContain('multi reachable');
    expect(npcTargetFacts(guard(3152,3006,3325),0,100)).toContain('multi reachable');
});
test('stale or missing floor does not authorize mapped target proof', () => {
    expect(npcTargetFacts(guard(1),0,5001)).toContain('zone unknown reachable stale');
    expect(npcTargetFacts(guard(1),undefined,100)).toContain('zone unknown');
    expect(npcTargetFacts({...guard(1),reachable:undefined},0,100)).toContain('reach unknown');
    expect(npcTargetFacts({...guard(1),reachable:false},0,100)).toContain('unreachable');
});
test('different same-name guards remain visible, nearest duplicate wins, output stays bounded', () => {
    const npcs = Array.from({length:12},(_,i)=>({...guard(i),distance:i}));
    npcs.push({...guard(0),distance:14});
    const s = {player:{level:0},nearbyNpcs:npcs} as BotWorldState;
    const rows=nearbyNpcSummary(s,0);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toContain('Guard#0/9');
    expect(rows[1]).toContain('Guard#1/9');
    expect(rows.filter(r=>r.includes('Guard#0/9'))).toHaveLength(1);
});
test('single combat and unknown floor are distinguished from multicombat', () => {
    expect(npcTargetFacts(guard(1,3255,3270),0,0)).toContain(' single ');
    expect(npcTargetFacts(guard(1),4,0)).toContain('zone unknown');
});
