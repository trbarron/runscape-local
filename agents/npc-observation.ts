import type { BotWorldState, NearbyNpc } from '../rs-sdk/sdk/types';
import { isMulticombat } from './multicombat';

export function npcTargetFacts(n: NearbyNpc, plane: number | undefined, ageMs: number): string {
    const x = n.tileX ?? n.x, z = n.tileZ ?? n.z;
    const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 5000;
    const known = fresh && Number.isFinite(x) && Number.isFinite(z) && Number.isInteger(plane) && plane! >= 0 && plane! <= 3;
    const zone = known ? (isMulticombat(x, z, plane!) ? 'multi' : 'single') : 'zone unknown';
    return `${n.name}#${n.index}/${n.id}@${x ?? '?'},${z ?? '?'},p${plane ?? '?'} ${zone} ${n.reachable === true ? 'reachable' : n.reachable === false ? 'unreachable' : 'reach unknown'}${fresh ? '' : ' stale'}`;
}

/** Bound output, but keep separate attackable NPC identities instead of collapsing their names. */
export function nearbyNpcSummary(s: BotWorldState, ageMs: number): string[] {
    const seen = new Set<string>();
    const rows = [];
    for (const n of [...s.nearbyNpcs].filter(n => n.distance <= 15).sort((a,b) => a.distance - b.distance)) {
        const attackable = n.optionsWithIndex.some(o => /^attack$/i.test(o.text));
        const key = attackable ? `${n.index}:${n.id}` : n.name;
        if (seen.has(key)) continue;
        seen.add(key);
        const opts = n.optionsWithIndex.map(o => o.text).filter(t => t && !/^examine$/i.test(t)).join('/');
        rows.push(`${attackable ? npcTargetFacts(n, s.player?.level, ageMs) : n.name}${opts ? ` (${opts})` : ''}`);
        if (rows.length === 10) break;
    }
    return rows;
}
