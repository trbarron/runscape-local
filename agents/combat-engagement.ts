import type { BotWorldState, NearbyNpc } from '../rs-sdk/sdk/types';
import type { Tactics } from './skills';

export function exactCombat(s:BotWorldState|null,n:NearbyNpc):boolean {
    return !!s?.player?.combat.inCombat&&s.player.combat.targetType==='npc'&&s.player.combat.targetIndex===n.index;
}
/** No fixed round limit: low HP without edible food must not fall through into a new target. */
export async function waitForEngagement(o:{
    target:NearbyNpc;state:()=>BotWorldState|null;going:()=>boolean;tactics:Tactics;
    eat:()=>Promise<void>;next:()=>Promise<unknown>;
}):Promise<'ended'|'unresolved'|'pass-ended'|'retreat'> {
    while(o.going()) {
        const s=o.state(),p=s?.player;
        if(!p)return 'unresolved';
        const foe=s!.nearbyNpcs.find(n=>n.index===o.target.index&&n.id===o.target.id);
        if(!foe||foe.hp===0||foe.healthPercent===0)return 'ended';
        if(p.combat.inCombat&&!exactCombat(s,o.target))return 'retreat';
        if(!exactCombat(s,o.target))return 'unresolved';
        if(p.hp<p.maxHp*o.tactics.eat_below/100)await o.eat();
        const now=o.state()?.player;if(!now)return 'unresolved';
        if(now.hp<now.maxHp*o.tactics.retreat_below/100) {
            const latest=o.state()?.nearbyNpcs.find(n=>n.index===o.target.index&&n.id===o.target.id);
            const finish=o.tactics.finish_if_enemy_below&&(latest?.healthPercent??100)<o.tactics.finish_if_enemy_below&&now.hp>=now.maxHp*.15;
            if(!finish)return 'retreat';
        }
        await o.next(); // always wait for game progress, including a failed/no-food eating attempt
    }
    return 'pass-ended';
}

/**
 * The game keeps `inCombat` set for a few ticks after a target dies or is lost, with no target. That is
 * the previous fight winding down, not another fight: wait briefly, and only if combat persists with no
 * target leave it to the caller's retreat rule. The client retains its damage flag for 400
 * client cycles (~8s), longer than ten accelerated server ticks. Allow up to 60 ticks,
 * but return immediately on fresh damage or a real target so the caller can reassess safety.
 */
export async function awaitCombatWindDown(o:{state:()=>BotWorldState|null;going:()=>boolean;next:()=>Promise<unknown>},maxTicks=60):Promise<void> {
    const initial=o.state()?.player;
    if(!initial)return;
    const hp=initial.hp,lastDamageTick=initial.combat.lastDamageTick;
    for(let i=0;i<maxTicks&&o.going();i++) {
        const player=o.state()?.player,combat=player?.combat;
        if(!player||player.hp<hp||combat?.lastDamageTick!==lastDamageTick)return;
        if(!combat?.inCombat||combat.targetType!=='none')return;
        await o.next();
    }
}
