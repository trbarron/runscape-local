// Builds agents/world-index/index.json from the game server's own content: every tree, rock,
// fishing spot, furnace, anvil, range, bank and monster in the free-to-play world, clustered
// into spots and named after the nearest place on the world map.
//
//   bun agents/world-index/build.ts
//
// Scope: free-to-play map zones (maps/free2play.csv), ground floor only, wilderness included.
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { findLongPath, initPathfinding } from '../../rs-sdk/sdk/pathfinding';
import { LANDMARKS } from '../world';

const CONTENT = join(import.meta.dir, '..', '..', 'rs-sdk', 'server', 'content');
const OUT = join(import.meta.dir, 'index.json');
/** The overworld ends here; higher z is other planes' map squares, not surface. */
const SURFACE_MAX_Z = 4000;
/** Tiles within this distance of each other join one spot. */
const CLUSTER = 12;

// ------------------------------------------------------------------ source data

const zones = new Set(
    readFileSync(join(CONTENT, 'maps', 'free2play.csv'), 'utf-8')
        .split('\n')
        .filter(l => /^\d/.test(l))
        .map(l => l.trim())
);
const inF2P = (x: number, z: number) => {
    const mx = x >> 6, mz = z >> 6;
    return zones.has(`0_${mx}_${mz}_${x & 56}_${z & 56}`) && z < SURFACE_MAX_Z;
};

const pack = (file: string) => {
    const m = new Map<number, string>();
    for (const l of readFileSync(join(CONTENT, 'pack', file), 'utf-8').split('\n')) {
        const [id, name] = l.split('=');
        if (name) m.set(+id, name.trim());
    }
    return m;
};
const locNames = pack('loc.pack');
const npcNames = pack('npc.pack');

/** NPC configs by debug name: display name, combat level, aggression, options. */
interface NpcConfig {
    name: string;
    level: number | null;
    hp: number | null;
    hunt: string;
    ops: string[];
}
function npcConfigs(): Map<string, NpcConfig> {
    const out = new Map<string, NpcConfig>();
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) walk(join(dir, e.name));
            else if (e.name.endsWith('.npc')) files.push(join(dir, e.name));
        }
    };
    walk(join(CONTENT, 'scripts'));
    for (const f of files) {
        let cur: NpcConfig | null = null;
        for (const line of readFileSync(f, 'utf-8').split('\n')) {
            const head = line.match(/^\[([^\]]+)\]/);
            if (head) {
                cur = { name: '', level: null, hp: null, hunt: '', ops: [] };
                out.set(head[1], cur);
                continue;
            }
            if (!cur) continue;
            const [k, v] = [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()];
            if (k === 'name') cur.name = v;
            else if (k === 'vislevel') cur.level = /^\d+$/.test(v) ? +v : null;
            else if (k === 'huntmode') cur.hunt = v;
            else if (k === 'hitpoints') cur.hp = /^\d+$/.test(v) ? +v : null;
            else if (/^op\d$/.test(k)) cur.ops.push(v);
        }
    }
    return out;
}
const npcs = npcConfigs();

/** Every LOC and NPC placed on the ground floor of a free-to-play tile. */
function placements() {
    const locs: { id: number; x: number; z: number }[] = [];
    const spawns: { id: number; x: number; z: number }[] = [];
    for (const file of readdirSync(join(CONTENT, 'maps'))) {
        const m = file.match(/^m(\d+)_(\d+)\.jm2$/);
        if (!m) continue;
        const [bx, bz] = [+m[1] * 64, +m[2] * 64];
        let section = '';
        for (const line of readFileSync(join(CONTENT, 'maps', file), 'utf-8').split('\n')) {
            const s = line.match(/^==== (\w+) ====/);
            if (s) {
                section = s[1];
                continue;
            }
            const p = line.match(/^(\d+) (\d+) (\d+): (\d+)/);
            if (!p || p[1] !== '0') continue;
            const x = bx + +p[2], z = bz + +p[3];
            if (!inF2P(x, z)) continue;
            if (section === 'LOC') locs.push({ id: +p[4], x, z });
            else if (section === 'NPC') spawns.push({ id: +p[4], x, z });
        }
    }
    return { locs, spawns };
}

// ------------------------------------------------------------------ classification

/** What a loc is for, by its debug name. */
function resourceOf(name: string): { kind: string; type: string } | null {
    if (/^tree[23]?$|^evergreen$/.test(name)) return { kind: 'tree', type: 'tree' };
    const tree = name.match(/^(oak|willow|maple|yew)tree$/);
    if (tree) return { kind: 'tree', type: tree[1] };
    const rock = name.match(/^(copper|tin|iron|coal|gold|silver|mithril|adamantite|runite|clay)rock\d$/);
    if (rock) return { kind: 'rock', type: rock[1] };
    if (/^furnace\d?$/.test(name)) return { kind: 'furnace', type: 'furnace' };
    if (name === 'anvil') return { kind: 'anvil', type: 'anvil' };
    // The Lumbridge castle range (cooksquestrange) only cooks after Cook's Assistant.
    if (name === 'range') return { kind: 'range', type: 'range' };
    if (name === 'bankbooth') return { kind: 'bank', type: 'bank' };
    if (name === 'spinningwheel') return { kind: 'spinning wheel', type: 'spinning wheel' };
    return null;
}

/** Fishing spots are NPCs; their options say how they are fished. */
function fishingOf(c: NpcConfig): string | null {
    if (c.name !== 'Fishing spot') return null;
    const ops = c.ops.map(o => o.toLowerCase());
    if (ops.includes('net') && ops.includes('bait')) return 'net/bait';
    if (ops.includes('lure')) return 'lure/bait';
    if (ops.includes('cage')) return 'cage/harpoon';
    if (ops.includes('net') && ops.includes('harpoon')) return 'net/harpoon';
    return null;
}

// ------------------------------------------------------------------ clustering and naming

interface Spot {
    kind: string;
    type: string;
    x: number;
    z: number;
    count: number;
    near: string;
    level?: number | null;
    hp?: number;
    aggressive?: boolean;
    /** Inside Al Kharid: through the 10-coin toll gate. */
    tollGate?: boolean;
    via?: 'Karamja';
}

function cluster(points: { key: string; kind: string; type: string; x: number; z: number; level?: number | null; hp?: number; aggressive?: boolean; via?: 'Karamja' }[]): Omit<Spot, 'near'>[] {
    const groups = new Map<string, typeof points>();
    for (const p of points) groups.set(p.key, [...(groups.get(p.key) ?? []), p]);
    const out: Omit<Spot, 'near'>[] = [];
    for (const pts of groups.values()) {
        const spots: { xs: number[]; zs: number[]; p: (typeof points)[number] }[] = [];
        for (const p of pts) {
            const s = spots.find(s => Math.hypot(s.xs.reduce((a, b) => a + b) / s.xs.length - p.x, s.zs.reduce((a, b) => a + b) / s.zs.length - p.z) <= CLUSTER);
            if (s) {
                s.xs.push(p.x);
                s.zs.push(p.z);
            } else spots.push({ xs: [p.x], zs: [p.z], p });
        }
        for (const s of spots) {
            const { kind, type, level, hp, aggressive, via } = s.p;
            out.push({
                kind,
                type,
                x: Math.round(s.xs.reduce((a, b) => a + b) / s.xs.length),
                z: Math.round(s.zs.reduce((a, b) => a + b) / s.zs.length),
                count: s.xs.length,
                ...(level !== undefined ? { level } : {}),
                ...(hp ? { hp } : {}),
                ...(aggressive ? { aggressive } : {}),
                ...(via ? { via } : {})
            });
        }
    }
    return out;
}

/** Place names from the world map (labels.txt): "=Barbarian/Village,3063,3416,1". */
const places = readFileSync(join(CONTENT, 'maps', 'labels.txt'), 'utf-8')
    .split('\n')
    .map(l => l.match(/^=([^,]+),(\d+),(\d+),(\d)/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map(m => ({ name: m[1].replace(/\//g, ' '), x: +m[2], z: +m[3], size: +m[4] }))
    .filter(p => p.size <= 1 && inF2P(p.x, p.z));

const dist = (a: { x: number; z: number }, x: number, z: number) => Math.hypot(a.x - x, a.z - z);
/** Mines the world map leaves unnamed (or names after something else nearby). */
const MINES = [
    { name: 'Al Kharid mine', x: 3300, z: 3305 },
    { name: 'Lumbridge Swamp mine', x: 3238, z: 3162 },
    { name: 'Varrock south-west mine', x: 3178, z: 3370 },
    { name: 'Rimmington mine', x: 2977, z: 3240 },
    { name: 'Barbarian Village mine', x: 3083, z: 3424 }
];

/** The party's own landmark names where they are close (they already know them), else the world map's. */
function nearestPlace(x: number, z: number): string {
    const mine = MINES.find(m => dist(m, x, z) <= 20);
    if (mine) return mine.name;
    const mark = LANDMARKS.reduce((a, b) => (dist(a, x, z) <= dist(b, x, z) ? a : b));
    if (dist(mark, x, z) <= 30) return mark.name;
    return places.reduce((a, b) => (dist(a, x, z) <= dist(b, x, z) ? a : b)).name;
}

// Guild interiors are behind doors only members of the guild may open.
const GUILDS = [{ name: 'Crafting Guild (Crafting 40 and a brown apron)', x: 2935, z: 3283, r: 12 }];
const inGuild = (x: number, z: number) => GUILDS.some(g => dist(g, x, z) <= g.r);

// Reachable on foot from Lumbridge, by the same pathfinder the bots walk with. This drops
// islands (Karamja, Crandor) and anything walled off.
initPathfinding();
function reachable(x: number, z: number): boolean {
    const path = findLongPath(0, 3222, 3218, x, z, 2000);
    const end = path.at(-1);
    return !!end && Math.max(Math.abs(end.x - x), Math.abs(end.z - z)) <= 3;
}
// Al Kharid's toll gate (10 coins) is a door to the pathfinder: a spot whose shortest walk
// from Lumbridge passes it costs the toll (there is a long free way round by the north).
const behindTollGate = (x: number, z: number) => findLongPath(0, 3222, 3218, x, z, 2000).some(w => w.x === 3268 && (w.z === 3227 || w.z === 3228));

// ------------------------------------------------------------------ build

const { locs, spawns } = placements();
const resourcePoints = locs.flatMap(l => {
    const r = resourceOf(locNames.get(l.id) ?? '');
    return r ? [{ key: `${r.kind}|${r.type}`, ...r, x: l.x, z: l.z }] : [];
});
const npcPoints = spawns.flatMap(s => {
    const c = npcs.get(npcNames.get(s.id) ?? '');
    if (!c) return [];
    const fish = fishingOf(c);
    if (fish) return [{ key: `fishing|${fish}`, kind: 'fishing', type: fish, x: s.x, z: s.z, ...(fish === 'cage/harpoon' ? { via: 'Karamja' as const } : {}) }];
    if (!c.ops.some(o => /^attack$/i.test(o)) || c.level == null) return [];
    // Every player hunt mode attacks on sight, 'cowardly' included: it is the standard one
    // (scorpions, hobgoblins, muggers), named for leaving alone players more than twice its
    // level. Ducks hunt only other ducks.
    const aggressive = !!c.hunt && !/duck_hunt|none/.test(c.hunt);
    return [{ key: `npc|${c.name}|${c.level}`, kind: 'monster', type: c.name.toLowerCase(), x: s.x, z: s.z, level: c.level, ...(c.hp ? { hp: c.hp } : {}), aggressive }];
});

const clustered = cluster([...resourcePoints, ...npcPoints]);
const spots: Spot[] = clustered
    .filter(s => !inGuild(s.x, s.z) && (reachable(s.x, s.z) || s.via === 'Karamja'))
    .map(s => ({ ...s, near: s.via === 'Karamja' ? 'Musa Point (Karamja)' : nearestPlace(s.x, s.z), ...(s.via !== 'Karamja' && behindTollGate(s.x, s.z) ? { tollGate: true } : {}) }));
console.log(`${clustered.length - spots.length} of ${clustered.length} spots dropped as unreachable on foot or inside a guild`);
spots.sort((a, b) => a.kind.localeCompare(b.kind) || a.type.localeCompare(b.type) || a.x - b.x);

writeFileSync(OUT, JSON.stringify({ built: new Date().toISOString(), scope: 'F2P, ground floor, wilderness included', places, spots }, null, 1) + '\n');
const counts = new Map<string, number>();
for (const s of spots) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
console.log(`${spots.length} spots, ${places.length} places -> ${OUT}`);
console.log([...counts].map(([k, n]) => `${k} ${n}`).join(', '));
