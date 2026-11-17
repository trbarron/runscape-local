import type { BotWorldState } from '../rs-sdk/sdk/types';
import { isMulticombat } from './multicombat';

/** Ignore ticks/animations and wandering within one combat zone; retain actionable scene changes. */
export function observationKey(s: BotWorldState): string {
    const p = s.player;
    return JSON.stringify([
        p && [p.worldX,p.worldZ,p.level,p.hp,p.isDead,p.combat.inCombat],
        s.nearbyNpcs.filter(n=>n.distance<=15).map(n=>[n.index,n.id,n.reachable,n.hp===0,n.inCombat,
            isMulticombat(n.tileX??n.x,n.tileZ??n.z,p?.level??0),n.optionsWithIndex.map(o=>o.text)]).sort(),
        s.nearbyLocs.filter(l=>l.distance<=12 && l.optionsWithIndex.length).map(l=>[l.id,l.x,l.z,l.optionsWithIndex.map(o=>o.text)]).sort(),
        s.groundItems.filter(i=>i.distance<=10).map(i=>[i.name,i.x,i.z]).sort(),
        (s.nearbyPlayers??[]).map(p=>[p.index,p.name,p.distance<=5]).sort(),
        s.equipment.map(i=>[i.name,i.count]).sort(),
        s.dialog?.pageId,s.dialog?.isOpen,s.dialog?.options.map(o=>o.text),
    ]);
}
