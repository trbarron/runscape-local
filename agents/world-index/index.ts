// Queries over the generated world index (index.json, built by build.ts): where things are,
// what they need, and what is near a character. Plain code over structured data, so answers
// are exact and cost no model calls.
import { readFileSync } from 'fs';
import { join } from 'path';
import { findLongPath, initPathfinding, isTileWalkable } from '../../rs-sdk/sdk/pathfinding';

export interface Spot {
    kind: 'tree' | 'rock' | 'fishing' | 'monster' | 'furnace' | 'anvil' | 'range' | 'bank' | 'spinning wheel';
    type: string;
    x: number;
    z: number;
    count: number;
    near: string;
    level?: number | null;
    hp?: number;
    aggressive?: boolean;
    tollGate?: boolean;
    /** Requires the Port Sarim ferry; currently used by the F2P Karamja fishing spots. */
    via?: 'Karamja';
}

const index = JSON.parse(readFileSync(join(import.meta.dir, 'index.json'), 'utf-8')) as { spots: Spot[]; places: { name: string; x: number; z: number }[] };
export const SPOTS = index.spots;

// Atlas labels are map-label points, not tiles a character can stand on: 13 of 41 sit on a blocked tile,
// and "Port Sarim" sits in the sea, so a walk there stopped 13 tiles short and every routine that began
// with it was blocked. Each unwalkable label is moved to the nearest tile a character can walk to from
// Lumbridge; a label that has a better home (the town's own shops) is anchored there by hand.
const ANCHORS: Record<string, { x: number; z: number }> = { 'Port Sarim': { x: 3014, z: 3224 } };
const START = { x: 3222, z: 3218 };
export function snapToReachable(p: { name: string; x: number; z: number }): { name: string; x: number; z: number } {
    try {
        const anchor = ANCHORS[p.name];
        if (anchor) return { ...p, ...anchor };
        if (isTileWalkable(0, p.x, p.z)) return p;
        const reaches = (x: number, z: number) => {
            if (!isTileWalkable(0, x, z)) return false;
            const end = findLongPath(0, START.x, START.z, x, z, 500).at(-1);
            return !!end && end.x === x && end.z === z;
        };
        for (let r = 1; r <= 8; r++) {
            let best: { x: number; z: number; d: number } | undefined;
            for (let dx = -r; dx <= r; dx++) {
                for (let dz = -r; dz <= r; dz++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !reaches(p.x + dx, p.z + dz)) continue;
                    const d = Math.hypot(dx, dz);
                    if (!best || d < best.d) best = { x: p.x + dx, z: p.z + dz, d };
                }
            }
            if (best) return { ...p, x: best.x, z: best.z };
        }
    } catch {
        // No collision data (a tool run without the game files): keep the label.
    }
    return p;
}
initPathfinding();
export const PLACE_NAMES = index.places.map(snapToReachable);

/** Skill levels needed to use a resource, from the game's rules. */
export const NEEDS: Record<string, { skill: string; level: number; what: string }> = {
    tree: { skill: 'Woodcutting', level: 1, what: 'logs' },
    oak: { skill: 'Woodcutting', level: 15, what: 'oak logs' },
    willow: { skill: 'Woodcutting', level: 30, what: 'willow logs' },
    maple: { skill: 'Woodcutting', level: 45, what: 'maple logs' },
    yew: { skill: 'Woodcutting', level: 60, what: 'yew logs' },
    clay: { skill: 'Mining', level: 1, what: 'clay' },
    copper: { skill: 'Mining', level: 1, what: 'copper ore' },
    tin: { skill: 'Mining', level: 1, what: 'tin ore' },
    iron: { skill: 'Mining', level: 15, what: 'iron ore' },
    silver: { skill: 'Mining', level: 20, what: 'silver ore' },
    coal: { skill: 'Mining', level: 30, what: 'coal' },
    gold: { skill: 'Mining', level: 40, what: 'gold ore' },
    mithril: { skill: 'Mining', level: 55, what: 'mithril ore' },
    adamantite: { skill: 'Mining', level: 70, what: 'adamantite ore' },
    runite: { skill: 'Mining', level: 85, what: 'runite ore' },
    'net/bait': { skill: 'Fishing', level: 1, what: 'net: shrimp and anchovies (small fishing net); bait: sardine and herring (fishing rod and bait)' },
    'lure/bait': { skill: 'Fishing', level: 20, what: 'lure: trout (20) and salmon (30) with a fly fishing rod and feathers; bait: pike (25) with a fishing rod and bait' },
    'cage/harpoon': { skill: 'Fishing', level: 35, what: 'harpoon: tuna (35) and swordfish (50); cage: lobster (40)' }
};

/** The wilderness starts at z 3520 and its level rises by one every 8 tiles north. */
export const wildernessLevel = (z: number) => (z >= 3520 ? Math.floor((z - 3520) / 8) + 1 : 0);

export const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

const describe = (s: Spot, from?: { x: number; z: number }) => {
    const where = `${s.near} (${s.x}, ${s.z})${from ? `, ${Math.round(dist(s, from))} tiles away` : ''}`;
    const extra = [
        s.kind === 'monster' ? `combat ${s.level}` : '',
        s.count > 1 ? `${s.count} ${s.kind === 'monster' ? 'of them' : 'here'}` : '',
        s.aggressive ? (wildernessLevel(s.z) ? 'attack anyone on sight' : 'attack on sight') : '',
        wildernessLevel(s.z) ? `wilderness level ${wildernessLevel(s.z)}` : '',
        s.tollGate ? 'from Lumbridge, the way runs through the Al Kharid toll gate (10 coins)' : ''
    ].filter(Boolean);
    const label = s.kind === 'rock' ? `${s.type} rocks` : s.kind === 'tree' ? (s.type === 'tree' ? 'trees' : `${s.type} trees`) : s.kind === 'fishing' ? `${s.type} fishing` : s.type;
    return `${label} at ${where}${extra.length ? ` [${extra.join(', ')}]` : ''}`;
};

/**
 * The nearest spots of a kind (and optionally a type), best first. Monster groups of one are
 * poor training grounds, so bigger groups win over slightly nearer singletons.
 */
export function nearest(kind: Spot['kind'], from: { x: number; z: number }, type?: string, opts: { allowToll?: boolean } = {}): Spot[] {
    const t = type?.trim().toLowerCase().replace(/s$/, '');
    return SPOTS.filter(s => s.kind === kind && (!t || s.type === t || s.type.replace(/s$/, '') === t) && (opts.allowToll || !s.tollGate)).sort(
        (a, b) => dist(a, from) / Math.min(a.count, 3) ** (kind === 'monster' ? 0.5 : 0) - dist(b, from) / Math.min(b.count, 3) ** (kind === 'monster' ? 0.5 : 0)
    );
}

/** Spot types of a kind that exist in the index. */
export const typesOf = (kind: Spot['kind']) => [...new Set(SPOTS.filter(s => s.kind === kind).map(s => s.type))];

/**
 * A free-text question ("coal", "hill giant", "furnace", "oak trees near falador"): the
 * nearest matching spots to the asker, with what they need.
 */
export function lookup(query: string, from: { x: number; z: number }, limit = 5): string {
    const q = query.trim().toLowerCase();
    if (!q) return 'Ask about a resource, monster or place, e.g. "coal", "willow", "lure", "barbarian", "furnace".';
    const place = PLACE_NAMES.find(p => q.includes(p.name.toLowerCase()));
    const anchor = place ?? from;
    const words = q.replace(place ? place.name.toLowerCase() : '', '').replace(/\b(near|at|in|where|is|are|the|rocks?|trees?|ore|to|mine|chop|fish|fight)\b/g, ' ').trim().replace(/s$/, '');
    // Whole words only, so "shrimp" does not find imps.
    const has = (hay: string, needle: string) => new RegExp(`\\b${needle.replace(/[^a-z0-9 ]/g, '')}s?\\b`).test(hay);
    const matches = SPOTS.filter(s => {
        if (!words) return true;
        return has(words, s.type) || has(s.type, words) || s.kind === words || (s.kind === 'fishing' && s.type.split('/').some(m => has(words, m)));
    }).sort((a, b) => dist(a, anchor) - dist(b, anchor));
    if (!matches.length) {
        const known = ['rocks: ' + typesOf('rock').join(', '), 'trees: ' + typesOf('tree').join(', '), 'fishing: ' + typesOf('fishing').join(', ')];
        return `Nothing called "${query}" in the free-to-play world. Lookup finds places and things, not how-tos: your actions list says what each action does. Known ${known.join('; ')}; monsters by name, e.g. barbarian, unicorn, guard, hobgoblin.`;
    }
    const need = NEEDS[matches[0].type];
    return [`Nearest ${place ? `to ${place.name}` : 'to you'} for "${query}":`, ...matches.slice(0, limit).map(s => `- ${describe(s, from)}`), need ? `Needs ${need.skill} ${need.level}: ${need.what}.` : ''].filter(Boolean).join('\n');
}

/** A short block of what each gathering skill offers near a character, and the next unlock. */
export function nearbyOptions(from: { x: number; z: number }, levels: Record<string, number>): string {
    const lines: string[] = [];
    const row = (kind: 'rock' | 'tree' | 'fishing', skill: string) => {
        const usable = typesOf(kind)
            .filter(t => (levels[skill] ?? 1) >= (NEEDS[t]?.level ?? 1))
            .map(t => nearest(kind, from, t)[0])
            .filter(Boolean)
            .sort((a, b) => (NEEDS[b.type]?.level ?? 0) - (NEEDS[a.type]?.level ?? 0) || dist(a, from) - dist(b, from))
            .slice(0, 3);
        const next = typesOf(kind)
            .filter(t => (NEEDS[t]?.level ?? 1) > (levels[skill] ?? 1))
            .sort((a, b) => (NEEDS[a]?.level ?? 0) - (NEEDS[b]?.level ?? 0))[0];
        const nextSpot = next ? nearest(kind, from, next)[0] : undefined;
        lines.push(
            `- ${skill} ${levels[skill] ?? 1}: ${usable.map(s => `${s.type} at ${s.near} (${Math.round(dist(s, from))} tiles${wildernessLevel(s.z) ? `, wilderness level ${wildernessLevel(s.z)}` : ''})`).join('; ') || 'nothing in reach'}${next ? `. Next: ${next} at ${NEEDS[next].level}${nextSpot ? `, nearest at ${nextSpot.near}` : ''}` : ''}`
        );
    };
    row('rock', 'Mining');
    row('tree', 'Woodcutting');
    row('fishing', 'Fishing');
    const combat = levels.Combat ?? 3;
    const fights = [...new Set(SPOTS.filter(s => s.kind === 'monster' && s.count >= 2 && !s.tollGate && (s.level ?? 0) <= combat + 10).map(s => s.type))]
        .map(t => nearest('monster', from, t)[0])
        .sort((a, b) => (b.level ?? 0) - (a.level ?? 0))
        .slice(0, 4);
    lines.push(`- Fights around your combat ${combat}: ${fights.map(s => `${s.type} ${s.level}${s.aggressive ? ' (attacks on sight)' : ''} at ${s.near} (${Math.round(dist(s, from))} tiles${wildernessLevel(s.z) ? `, wilderness level ${wildernessLevel(s.z)}` : ''})`).join('; ')}`);
    return lines.join('\n');
}
