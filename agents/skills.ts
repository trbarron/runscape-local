import { nearbyNpcSummary } from './npc-observation';
import { leaveDockedFerry } from './ferry-navigation';
import { bestHealingFood } from './combat-food';
import { awaitCombatWindDown, exactCombat, waitForEngagement } from './combat-engagement';
import type { FightObservation, FightPhase } from './fight-report';
import { assistPairs, runAssist, runInvite, type AssistOps } from './assist';
import { agents } from './party';
import { post } from './board';
import { ORE_PAIRS, partnerNeed } from './smelting';
import { FISHING, fishMethod } from './fishing';
import { equipmentBlocker, usableTool, smithRecipe, cookingLevel, isStackable, withdrawAmount, CUT_LEVELS, JEWELLERY_LEVELS } from './game-requirements';
import { cleanLookupText } from './lookup-text';
// Scripted skills. The planner only picks one (as a standing order) and its parameters;
// everything inside is deterministic SDK code that costs no tokens.
//
// Each skill declares what it needs (`requires`), so the planner is only offered actions
// it can actually do, with the reason for the rest. `run` does one bounded pass: it stops
// at the deadline, when the pack is full, or when the abort signal fires, and returns a
// blocker string if it cannot continue.
import type { BotActions } from '../rs-sdk/sdk/actions';
import type { BotSDK } from '../rs-sdk/sdk/index';
import type { BotWorldState } from '../rs-sdk/sdk/types';
import type { Activity } from './characters';
import { BANKS, DANGERS, LANDMARKS, PLACES } from './world';
import { bestBuyer, shopSelling, SHOPS, type Shop } from './shops';
import { NEEDS, PLACE_NAMES, SPOTS, dist as tiles, nearest, typesOf, wildernessLevel, type Spot } from './world-index/index';
import { recordWalk } from './routes';
import { findLongPath } from '../rs-sdk/sdk/pathfinding';
import { bankOf, noteBank } from './banks';
import { recordSale } from './handoffs';
import { load, save } from './store';
import { emit } from './events';
import { depositPlan, reserveWithdrawal } from './food-reserve';

export interface Ctx {
    /** This pass reaches the actual order deadline, rather than an intermediate pass boundary. */
    finalPass?: boolean;
    fightReport?: FightObservation;
    /** Executor captures fresh SDK scene and dialogue actually read by this skill. */
    observeWorld?: (dialogue?:string,dispatch?:{success:boolean;message:string})=>void;
    bot: BotActions;
    sdk: BotSDK;
    name: string;
    /** End of this pass, ms since epoch. */
    deadline: number;
    signal: AbortSignal;
    /** The character's own fight rules (defaults where unset). */
    tactics?: Partial<Tactics>;
    /** Facts a skill adds to its step's report (e.g. a fight's kills and damage). */
    notes?: string[];
    /** Why this pass is producing nothing, kept current by the skill; read if the order is declared stuck. */
    stall?: { why?: string };
}

/**
 * A character's fight rules, set by the character and run by the fight loop every tick. Values
 * are checked here: HP thresholds stay between a hard floor and full health.
 */
export interface Tactics {
    /** Eat when HP falls below this percentage. */
    eat_below: number;
    /** With no food left, leave the fight below this percentage. */
    retreat_below: number;
    /** Stay to land the kill while the enemy's HP is below this percentage (0 = never). */
    finish_if_enemy_below: number;
    target: 'nearest' | 'lowest_hp' | 'not_fighting';
    style: 'keep' | 'accurate' | 'aggressive' | 'defensive' | 'controlled';
    loot: 'bones' | 'none';
}
export const DEFAULT_TACTICS: Tactics = { eat_below: 50, retreat_below: 50, finish_if_enemy_below: 0, target: 'nearest', style: 'keep', loot: 'bones' };
/** Nobody fights on below this, whatever their card says. */
const HP_FLOOR = 15;

export function checkTactics(t: Partial<Tactics> | null | undefined): Tactics {
    const pct = (v: unknown, d: number, lo: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(95, Math.round(v))) : d);
    const pick = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);
    const d = DEFAULT_TACTICS;
    return {
        eat_below: pct(t?.eat_below, d.eat_below, HP_FLOOR),
        retreat_below: pct(t?.retreat_below, d.retreat_below, HP_FLOOR),
        finish_if_enemy_below: pct(t?.finish_if_enemy_below, d.finish_if_enemy_below, 0),
        target: pick(t?.target, ['nearest', 'lowest_hp', 'not_fighting'] as const, d.target),
        style: pick(t?.style, ['keep', 'accurate', 'aggressive', 'defensive', 'controlled'] as const, d.style),
        loot: pick(t?.loot, ['bones', 'none'] as const, d.loot)
    };
}

export const renderTactics = (t: Tactics) =>
    `eat below ${t.eat_below}% HP; with no food, retreat below ${t.retreat_below}%${t.finish_if_enemy_below ? ` unless the enemy is below ${t.finish_if_enemy_below}% (never below ${HP_FLOOR}%)` : ''}; target ${t.target.replace('_', ' ')}; style ${t.style}; loot ${t.loot}`;

export interface Args {
    target: string | null;
    /** How many, for actions that take an amount (from a step's "gathered" count). */
    amount?: number | null;
    /** Executor-supplied outputs of this routine; never changes explicit item deposits. */
    bankOutputs?: string[];
}

export interface SkillDef {
    description: string;
    /** What `target` means for this skill. */
    target?: string;
    /** Activity this counts as, for leaning metrics. */
    activity: Activity | 'rest';
    /** Gathering skills: the executor banks automatically when the pack fills. */
    gathers?: boolean;
    /** Errands that are finished after one successful pass (bank, sell, buy). */
    oneShot?: boolean;
    /** null when the skill can run now, else why not. */
    requires?: (s: BotWorldState, a: Args) => string | null;
    /** One pass. Returns a blocker if the character cannot carry on. */
    run: (ctx: Ctx, a: Args) => Promise<string | void>;
}

const pos = (c: Ctx) => {
    const p = c.sdk.getState()?.player;
    return p ? { x: p.worldX, z: p.worldZ } : { x: 0, z: 0 };
};
const dist = (c: Ctx, x: number, z: number) => {
    const p = pos(c);
    return Math.hypot(p.x - x, p.z - z);
};
const going = (c: Ctx) => !c.signal.aborted && c.deadline - Date.now() > 0;
export const packFull = (s: BotWorldState | null | undefined) => (s?.inventory.length ?? 0) >= 28;

const carried = (s: BotWorldState, pattern: RegExp) => [...s.inventory, ...s.equipment].some(i => pattern.test(i.name));
const needs = (what: string, pattern: RegExp) => (s: BotWorldState) => ([...s.inventory, ...s.equipment].some(i => pattern.test(i.name) && usableTool(s, i.name, what === 'pickaxe' ? 'Mining' : 'Woodcutting')) ? null : `needs a usable ${what}`);

export const TOOLS: [string, RegExp][] = [
    ['axe', /(?<!pick)axe$/i], // a pickaxe is not an axe
    ['pickaxe', /pickaxe$/i],
    ['small fishing net', /fishing net/i],
    ['tinderbox', /tinderbox/i]
];

/**
 * Whether the shortest walk between two points goes through Al Kharid's 10-coin toll gate,
 * and which way: walks treat the gate as a door, so it has to be paid on purpose.
 */
function tollOnWay(from: { x: number; z: number }, to: { x: number; z: number }): 'east' | 'west' | null {
    // Paths are corner waypoints, so look for a leg that crosses x 3268 at the gate's rows.
    const path = [from, ...findLongPath(0, from.x, from.z, to.x, to.z, 2000)];
    for (let i = 1; i < path.length; i++) {
        const [a, b] = [path[i - 1], path[i]];
        if ((a.x < 3268) === (b.x < 3268)) continue;
        const z = a.z + ((b.z - a.z) * (3268 - a.x)) / (b.x - a.x);
        if (z >= 3226.5 && z <= 3228.5) return a.x < 3268 ? 'east' : 'west';
    }
    return null;
}

/** Pays the Al Kharid toll and steps through the gate, towards `east` or back west. */
async function crossTollGate(c: Ctx, east: boolean): Promise<string | void> {
    let coins = c.sdk.getInventory().filter(i => /^coins$/i.test(i.name)).reduce((n, i) => n + i.count, 0);
    // Short of the fare: fetch it from your own bank on this side of the gate, if it holds coins.
    if (coins < 10 && (bankOf(c.name)?.items.Coins ?? 0) >= 10 - coins) {
        const side = [...BANKS].filter(b => (b.x >= 3268) === (pos(c).x >= 3268)).sort((a, b) => dist(c, a.x, a.z) - dist(c, b.x, b.z))[0];
        if (side && !(await goNear(c, side.x, side.z, 4)) && (await c.bot.openBank()).success) {
            await c.bot.withdrawItem(/^coins$/i, Math.min(bankOf(c.name)!.items.Coins, 50));
            await c.sdk.waitForTicks(1);
            noteBank(c.name, c.sdk);
            await c.bot.closeBank();
            coins = c.sdk.getInventory().filter(i => /^coins$/i.test(i.name)).reduce((n, i) => n + i.count, 0);
        }
    }
    if (coins < 10) return `the Al Kharid toll gate costs 10 coins each way, and you carry ${coins} (coins in your bank can be withdrawn at any bank, Al Kharid's included)`;
    // Stand clear of the gate itself: opening it from the gate tile does nothing.
    const [sideX, otherX] = east ? [3266, 3269] : [3270, 3267];
    const wasEast = pos(c).x >= 3268;
    const r = await c.bot.walkTo(sideX, 3228, 0, { timeout: 60_000 });
    if (!r.success && Math.abs(pos(c).x - sideX) > 2) return `could not reach the toll gate: ${r.message}`;
    const gate = c.sdk.getState()?.nearbyLocs.find(l => /gate/i.test(l.name) && Math.abs(l.x - 3268) <= 1 && Math.abs(l.z - 3227.5) <= 2);
    if (!gate) return 'no toll gate found';
    const open = gate.optionsWithIndex.find(o => /open|pay/i.test(o.text)) ?? gate.optionsWithIndex[0];
    await c.sdk.sendInteractLoc(gate.x, gate.z, gate.id, open?.opIndex ?? 1);
    // The guard walks up and talks first (a few ticks); agree to pay when he asks.
    await c.sdk.waitForCondition(st => !!st.dialog?.isOpen, 8_000).catch(() => {});
    for (let i = 0; i < 12 && !c.signal.aborted && c.sdk.getState()?.dialog?.isOpen; i++) {
        const d = c.sdk.getState()!.dialog!;
        const yes = d.options.find(o => /yes/i.test(o.text));
        await c.sdk.sendClickDialog(yes?.index ?? 0);
        await c.sdk.waitForTicks(2);
    }
    await c.sdk.waitForTicks(2);
    await c.bot.walkTo(otherX + (east ? 4 : -4), 3228, 2, { timeout: 30_000 });
    if ((pos(c).x >= 3268) === wasEast) return 'the toll gate did not let you through';
}

/** Walks somewhere, and records in the travel log how the walk went. */
export async function goNear(c: Ctx, x: number, z: number, within = 12): Promise<string | void> {
    if (dist(c, x, z) <= within) return;
    const toll = tollOnWay(pos(c), { x, z });
    if (toll) {
        const crossed = await crossTollGate(c, toll === 'east');
        if (crossed) return crossed;
    }
    const from = pos(c);
    const hp0 = c.sdk.getState()?.player?.hp ?? 0;
    const r = await c.bot.walkTo(x, z, 3, { timeout: Math.max(20_000, c.deadline - Date.now()) });
    const p = c.sdk.getState()?.player;
    const arrived = r.success || dist(c, x, z) <= within;
    const died = /died/i.test(r.message ?? '');
    const lost = p ? hp0 - p.hp : 0;
    if (!c.signal.aborted || died) {
        const outcome = died ? 'died' : !arrived ? 'failed' : p && lost > 0 && lost >= p.maxHp * 0.2 ? 'hurt' : 'safe';
        recordWalk(c.name, from, { x, z }, outcome, lost > 0 && !died ? `lost ${lost} HP` : undefined);
    }
    if (!arrived) return `could not walk there: ${r.message}`;
}

/** Any place in the atlas by name ("varrock mine", "Varrock east bank"), or "x, z". */
export function findPlace(target: string | null): { name: string; x: number; z: number } | null {
    const t = (target ?? '').trim().toLowerCase().replace(/_/g, ' ');
    if (!t) return null;
    const xz = t.match(/^\(?\s*(\d{4})\s*,\s*(\d{4})\s*\)?$/);
    if (xz) return { name: t, x: +xz[1], z: +xz[2] };
    const all = [...Object.entries(PLACES).map(([k, p]) => ({ name: k.replace(/_/g, ' '), ...p })), ...BANKS, ...DANGERS, ...LANDMARKS, ...SHOPS, ...PLACE_NAMES];
    return all.find(p => p.name.toLowerCase() === t) ?? all.find(p => p.name.toLowerCase().includes(t)) ?? null;
}

/** Atlas names sharing the most words with a name that is not in it. */
function similarPlaces(target: string): string[] {
    const words = target.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3);
    const names = [...new Set([...Object.keys(PLACES).map(k => k.replace(/_/g, ' ')), ...BANKS.map(b => b.name), ...LANDMARKS.map(l => l.name), ...SHOPS.map(s => s.name), ...PLACE_NAMES.map(p => p.name)])];
    return names
        .map(n => ({ n, score: words.filter(w => n.toLowerCase().includes(w)).length }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .map(x => x.n);
}

/** The nearest bank, leaving Al Kharid's (behind the toll gate) to those already inside. */
const nearestBank = (c: Ctx) => avoidToll(c, [...BANKS].sort((x, y) => dist(c, x.x, x.z) - dist(c, y.x, y.z)));

/** The first of some places (nearest first) that can be reached without the toll, else the nearest. */
function avoidToll<T extends { x: number; z: number }>(c: Ctx, sorted: T[]): T {
    return sorted.slice(0, 5).find(p => !tollOnWay(pos(c), p)) ?? sorted[0];
}

/** The nearest spot of a kind not yet tried this pass (at most three), avoiding the toll where it can. */
function nextSpot(c: Ctx, kind: Spot['kind'], type: string, tried: Spot[], opts: { hunted?: boolean } = {}): Spot | undefined {
    if (tried.length >= 3) return undefined;
    // Spots where monsters would hunt this character are left out, as for fishing (unless fighting).
    const s = c.sdk.getState();
    const left = nearest(kind, pos(c), type, { allowToll: true }).filter(x => !tried.includes(x) && !isBad(x) && (opts.hunted || !(s && huntedAt(s, x))));
    return left.length ? avoidToll(c, left) : undefined;
}

// Stations where the work did nothing with usable materials in hand: the index counts every
// door as open, so a range in a locked house (Draynor Manor) looks reachable until tried.
//
// A mark takes two failures on separate occasions and lapses after a few hours: a single unlucky
// pass (a dialog in the way, a recipe the character could not make) must not write off a
// working furnace or training ground for good.
interface Mark {
    why: string;
    /** When it last failed. */
    t: number;
    strikes: number;
}
const MARK_STRIKES = 2;
const MARK_TTL_MS = 6 * 3600_000;
const STRIKE_GAP_MS = 60_000;
const badStations: Record<string, Mark> = Object.fromEntries(
    Object.entries(load<Record<string, Mark | string>>('stations', {})).map(([k, v]) => [k, typeof v === 'string' ? { why: v, t: Date.now(), strikes: MARK_STRIKES } : v])
);
const stationKey = (s: { x: number; z: number }) => `${s.x},${s.z}`;
const isBad = (s: { x: number; z: number }) => {
    const m = badStations[stationKey(s)];
    return !!m && m.strikes >= MARK_STRIKES && Date.now() - m.t < MARK_TTL_MS;
};
/** Records one failure at a spot; it is avoided once it has failed on two separate occasions. */
function strike(s: { x: number; z: number }, why: string): void {
    const key = stationKey(s);
    const m = badStations[key];
    const fresh = m && Date.now() - m.t < MARK_TTL_MS;
    if (fresh && Date.now() - m.t < STRIKE_GAP_MS) return; // the same occasion
    badStations[key] = { why, t: Date.now(), strikes: fresh ? m.strikes + 1 : 1 };
    save('stations', badStations);
    if (badStations[key].strikes === MARK_STRIKES) emit('party', 'info', { summary: `spot marked unusable: ${why} (${key})` });
}

const combatXp = (c: Ctx) => c.sdk.getState()?.skills.filter(k => /^(attack|strength|defence|hitpoints|ranged|magic)$/i.test(k.name)).reduce((n, k) => n + k.experience, 0) ?? 0;

/**
 * Walks to the nearest working station of a kind and runs the work there. If it does nothing
 * at all while the materials are usable (unnoted items never stack), the station is remembered
 * as unusable and the next one tried, up to three.
 */
async function atStation(c: Ctx, kind: Spot['kind'], material: RegExp, work: () => Promise<string | void>, stationAtFault: () => boolean = () => true): Promise<string | void> {
    const tried: Spot[] = [];
    const snapshot = () => JSON.stringify(c.sdk.getInventory().map(i => [i.name, i.count]));
    let last: string | void = `no ${kind} known`;
    for (let spot = nextSpot(c, kind, kind, tried); spot; spot = nextSpot(c, kind, kind, tried)) {
        tried.push(spot);
        const w = await goNear(c, spot.x, spot.z, 4);
        if (w) return w;
        const before = snapshot();
        last = await work();
        const usable = c.sdk.getInventory().some(i => material.test(i.name) && i.count === 1);
        if (!last || snapshot() !== before || !usable || !going(c) || !stationAtFault()) return last;
        strike(spot, `${kind} near ${spot.near} did nothing`);
    }
    return last;
}

/** The nearest spot of a kind, avoiding the toll gate where a free one is in the shortlist. */
const spotNear = (c: Ctx, kind: Spot['kind'], type?: string) => avoidToll(c, nearest(kind, pos(c), type, { allowToll: true }));

const level = (s: BotWorldState, skill: string) => s.skills.find(k => k.name === skill)?.baseLevel ?? 1;

/** A resource type's level requirement, as a blocker if not met. */
function levelFor(s: BotWorldState, type: string): string | null {
    const need = NEEDS[type];
    if (!need) return null;
    const have = level(s, need.skill);
    return have >= need.level ? null : `${type} needs ${need.skill} ${need.level} (you are ${have})`;
}

/** Aggressive monsters that would hunt this character at a spot. */
export function huntedAt(s: BotWorldState, spot: { x: number; z: number }): string | null {
    const combat = s.player?.combatLevel ?? 3;
    // Outside the wilderness aggressive monsters spare anyone over twice their level; inside it they attack everyone.
    const threat = SPOTS.find(m => m.kind === 'monster' && m.aggressive && tiles(m, spot) <= 15 && (wildernessLevel(m.z) > 0 || (m.level ?? 0) * 2 > combat));
    if (!threat) return null;
    const wild = wildernessLevel(threat.z);
    return wild
        ? `${threat.type}s (combat ${threat.level}) in wilderness level ${wild} attack anyone near ${spot.x}, ${spot.z}, whatever their level`
        : `${threat.type}s (combat ${threat.level}) attack on sight near ${spot.x}, ${spot.z}; you are combat ${combat}`;
}

/** Drops every matching item (burnt food is worth nothing). */
async function dropAll(c: Ctx, pattern: RegExp): Promise<void> {
    await c.sdk.waitForTicks(2); // the last cook's result lands a tick or two late
    for (const item of [...c.sdk.getInventory()].reverse()) {
        if (!pattern.test(item.name) || c.signal.aborted) continue;
        await c.sdk.sendDropItem(item.slot);
        await c.sdk.waitForTicks(1);
    }
}

const treeType = (target: string | null) => {
    const t = (target ?? '').trim().toLowerCase().replace(/s$/, '').replace(/ ?trees?$/, '').replace(/^regular$|^normal$/, 'tree');
    return typesOf('tree').includes(t) ? t : 'tree';
};
const rockType = (target: string | null) => {
    const t = (target ?? '').trim().toLowerCase().replace(/ ?(ore|rocks?)$/, '').replace(/^adamant$/, 'adamantite');
    return typesOf('rock').includes(t) ? t : null;
};

/** A monster type in the index, from a target like "barbarians" or "Unicorn". */
const fightSpot = (target: string | null) => {
    const t = (target ?? '').trim().toLowerCase();
    if (!t) return undefined;
    const types = typesOf('monster');
    return types.find(m => m === t) ?? types.find(m => m === t.replace(/s$/, '')) ?? types.find(m => m === t.replace(/es$/, ''));
};

const shopFailures = new Map<string, number>();
const transientShopFailure = (message: string) => /timed? ?out|timeout|not found|could not find|too far|not.*near|not.*open|dialog|busy|can't reach|stuck/i.test(message);

/** Two attempts at most; reset the interface and recheck position before the second. */
export async function openShopAt(c: Ctx, shop: Shop): Promise<string | void> {
    if ((shopFailures.get(shop.name) ?? 0) > Date.now()) return `${shop.name} is temporarily unavailable after repeated failures; retry after its five-minute cooldown`;
    let last = '';
    for (let attempt = 0; attempt < 2 && going(c); attempt++) {
        if (attempt) {
            c.notes?.push(`retrying ${shop.name} after a temporary open failure`);
            await c.sdk.sendCloseModal();
            await c.sdk.waitForTicks(2);
            if (!going(c)) return 'shop recovery interrupted or out of time';
        }
        try {
            const walk = await goNear(c, shop.x, shop.z, attempt ? 2 : 4);
            if (walk) last = walk;
            else {
                const opened = await c.bot.openShop(shop.keeper);
                if (opened.success) { shopFailures.delete(shop.name); return; }
                last = opened.message;
            }
        } catch (error) {
            if (c.signal.aborted) throw error;
            last = error instanceof Error ? error.message : String(error);
        }
        if (!going(c) || !transientShopFailure(last)) return `could not open ${shop.name}: ${last}`;
    }
    if (going(c)) shopFailures.set(shop.name, Date.now() + 5 * 60_000);
    return `could not open ${shop.name} after bounded recovery: ${last || 'interrupted or out of time'}`;
}

/** Try at most one other known seller, without buying anything during recovery. */
export async function openSeller(c: Ctx, name: string): Promise<{ shop: Shop; item: Shop['items'][number] } | string> {
    const sellers = SHOPS.flatMap(shop => shop.items.filter(item => item.name.toLowerCase() === name.toLowerCase()).map(item => ({ shop, item })))
        // Cheapest first; among equal prices the nearest, since several shops sell the same goods.
        .sort((a, b) => a.item.price - b.item.price || dist(c, a.shop.x, a.shop.z) - dist(c, b.shop.x, b.shop.z));
    let last = `no shop sells ${name}`;
    const active = sellers.filter(x => (shopFailures.get(x.shop.name) ?? 0) <= Date.now());
    for (const seller of active.slice(0, 2)) {
        if (!going(c)) break;
        const blocked = await openShopAt(c, seller.shop);
        if (!blocked) return seller;
        last = blocked;
        c.notes?.push(blocked);
        if (!transientShopFailure(blocked) && !/bounded recovery|temporarily unavailable/.test(blocked)) break;
    }
    return active.length ? last : `${name}: all known sellers are cooling down after repeated open failures`;
}

/** Wielding or wearing needs Attack (weapons) or Defence (armour) at these levels. */
const GEAR_LEVELS = 'iron 1, steel 5, black 10, mithril 20, adamant 30, rune 40';

/** bank_resources' target is either a bank's name or an item to deposit. */
function bankTarget(target: string | null): { bank?: (typeof BANKS)[number]; near?: { x: number; z: number }; item?: string } {
    const t = (target ?? '').trim().toLowerCase();
    if (!t) return {};
    const bank = BANKS.find(b => b.name.toLowerCase().includes(t.replace(/ bank$/, '')));
    if (bank) return { bank };
    // A town without a bank of its own ("Lumbridge") means the bank nearest to it.
    const place = findPlace(t);
    if (place) return { bank: [...BANKS].sort((a, b) => Math.hypot(a.x - place.x, a.z - place.z) - Math.hypot(b.x - place.x, b.z - place.z))[0], near: place };
    return { item: t.replace(/s$/, '') };
}

/** What a pack holds, by item: "14 Copper ore, 9 Bronze sword, 1 Hammer". */
const packText = (s: BotWorldState) =>
    [...new Set(s.inventory.map(i => i.name))].map(n => `${s.inventory.filter(i => i.name === n).reduce((k, i) => k + i.count, 0)} ${n}`).join(', ') || 'nothing';

/** Whether an item is the one named; cooked food has no "cooked" in its name ("Shrimps"). */
function namedItem(name: string, wanted: string): boolean {
    const n = cleanLookupText(name).toLowerCase();
    wanted = cleanLookupText(wanted).toLowerCase().replace(/\(?\bnoted?\b\)?/gi, '').trim();
    const cooked = wanted.match(/^cooked (.+)$/);
    return cooked ? !n.startsWith('raw ') && !n.startsWith('burnt ') && n.includes(cooked[1]) : n.includes(wanted);
}

async function fightPhase<T>(c:Ctx, phase:FightPhase, work:()=>Promise<T>):Promise<T> {
    return c.fightReport ? c.fightReport.during(phase,work) : work();
}
async function eatObserved(c:Ctx):Promise<void> {
    const before=c.sdk.getState();
    const result=await c.bot.eatFood(before?bestHealingFood(before):undefined).catch(()=>undefined);
    c.fightReport?.food(before,c.sdk.getState(),!!result?.success);
}

/** Eats when hurt; returns a blocker if HP is still dangerously low. */
export async function danger(c: Ctx): Promise<string | void> {
    const t = checkTactics(c.tactics);
    const p0 = c.sdk.getState()?.player;
    if (p0 && p0.hp < (p0.maxHp * t.eat_below) / 100) await eatObserved(c);
    const p = c.sdk.getState()?.player;
    if (p && p.hp < (p.maxHp * Math.min(35, t.retreat_below)) / 100) {
        if (p.combat.inCombat) return `HP ${p.hp}/${p.maxHp}, out of food and under attack: ${(await flee(c)) ?? 'fled'}`;
        return `HP ${p.hp}/${p.maxHp} and out of food`;
    }
}

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "Doric: Talk-to" -> name and option. */
function parseNameOption(target: string | null | undefined): { name: string; option: string } | null {
    const m = (target ?? '').match(/^\s*(.+?)\s*:\s*(.+?)\s*$/);
    return m ? { name: m[1], option: m[2] } : null;
}

/** What is around a character, for look and for misses: people, objects, ground items, dialogue. */
function surroundings(c: Ctx): string {
    const st = c.sdk.getState();
    if (!st) return 'nothing seen';
    const opts = (o: { text: string }[]) => o.map(x => x.text).filter(t => t && !/^examine$/i.test(t)).join('/');
    const npcs = nearbyNpcSummary(st, c.sdk.getStateAge());
    const locs = [...new Map(st.nearbyLocs.filter(l => l.distance <= 12 && opts(l.optionsWithIndex)).sort((a, b) => a.distance - b.distance).map(l => [l.name, l])).values()]
        .slice(0, 12)
        .map(l => `${l.name} (${opts(l.optionsWithIndex)})`);
    const ground = [...new Set(st.groundItems.filter(g => g.distance <= 10).map(g => g.name))].slice(0, 8);
    const p = st.player;
    return [
        p ? `you are at ${p.worldX}, ${p.worldZ}${p.level ? `, floor ${p.level}` : ''}` : '',
        `people and creatures: ${npcs.join(', ') || 'none'}`,
        `objects: ${locs.join(', ') || 'none'}`,
        `on the ground: ${ground.join(', ') || 'nothing'}`,
        st.dialog?.isOpen ? `dialogue open: ${dialogText(st)}` : ''
    ]
        .filter(Boolean)
        .join('; ');
}

function dialogText(st: BotWorldState): string {
    const d = st.dialog;
    if (!d?.isOpen) return '';
    const said = (d.text ?? d.allComponents?.map(x => (x as any).text).filter(Boolean).join(' ') ?? '').replace(/\s+/g, ' ').trim();
    const choices = d.options.map(o => o.text.trim()).filter(Boolean);
    return `"${said.slice(0, 300)}"${choices.length ? ` options: ${choices.join(' | ')}` : ' (continue)'}`;
}

/**
 * Reads the dialogue that opened, clicking through pages that only wait to continue (up to a
 * few), so the report carries what was said and the choices that need an answer.
 */
async function readDialog(c: Ctx): Promise<string> {
    await c.sdk.waitForCondition(s => !!s.dialog?.isOpen, 3000).catch(() => {});
    const lines: string[] = [];
    for (let i = 0; i < 8 && c.sdk.getState()?.dialog?.isOpen; i++) {
        const st = c.sdk.getState()!;
        const text = dialogText(st);
        if (text && lines.at(-1) !== text) lines.push(text);
        if (st.dialog!.options.filter(o => o.text.trim()).length > 1) break;
        await c.sdk.sendClickDialog(0);
        await c.sdk.waitForTicks(2);
    }
    if (!lines.length) return '';
    return `dialogue: ${lines.join(' / ')}${c.sdk.getState()?.dialog?.isOpen ? '' : ' (closed)'}`;
}

/** Sets the combat style the card asks for, where the weapon offers one of that type. */
async function setStyle(c: Ctx, style: Tactics['style']): Promise<void> {
    if (style === 'keep') return;
    const cs = c.sdk.getState()?.combatStyle;
    const opt = cs?.styles.find(o => o.type.toLowerCase() === style);
    if (opt && cs && cs.currentStyle !== opt.index) await c.sdk.sendSetCombatStyle(opt.index).catch(() => {});
}

/** The monster to attack, by the card's target rule; undefined lets attack() pick the nearest. */
function chooseTarget(c: Ctx, pattern: RegExp, t: Tactics) {
    if (t.target === 'nearest') return undefined;
    const npcs = (c.sdk.getState()?.nearbyNpcs ?? []).filter(n => pattern.test(n.name) && n.reachable !== false && n.optionsWithIndex.some(o => /^attack$/i.test(o.text)) && n.distance <= 15);
    const pool = t.target === 'not_fighting' ? npcs.filter(n => !n.inCombat) : npcs;
    return [...pool].sort((a, b) => (t.target === 'lowest_hp' ? (a.healthPercent ?? 100) - (b.healthPercent ?? 100) : 0) || a.distance - b.distance)[0];
}

/** Something is attacking: walk to Lumbridge or the nearest bank, whichever is free to reach. */
async function flee(c: Ctx): Promise<string | void> {
    const safe = avoidToll(c, [{ x: 3222, z: 3218 }, ...BANKS].sort((a, b) => dist(c, a.x, a.z) - dist(c, b.x, b.z)));
    const w = await goNear(c, safe.x, safe.z, 6);
    return w ? `could not get away (${w})` : 'ran to safety';
}

// Shops pay less the more of an item they already hold, and nothing once saturated, so the
// sell skill reads the live price and skips anything the shop would take for 0 coins.
// Bones are the only drop worth taking: the general store pays 0 for bones, feathers and
// hides (tested, with none in its stock), but burying bones gives Prayer XP.
const LOOT = /^bones$/i;

/** Bury every bone in the pack ("Bury" is the item's own option). */
async function buryAll(c: Ctx): Promise<void> {
    for (let i = 0; i < 28 && !c.signal.aborted; i++) {
        const bone = c.sdk.getInventory().find(item => LOOT.test(item.name));
        const bury = bone?.optionsWithIndex.find(o => /^bury$/i.test(o.text));
        if (!bone || !bury) return;
        const before = c.sdk.countInventoryItems(bone.name);
        await c.sdk.sendUseItem(bone.slot, bury.opIndex);
        await c.sdk.waitForCondition(s => s.inventory.filter(x => LOOT.test(x.name)).length < before, 4000).catch(() => {});
    }
}

/** Pick up bones next to the character and bury them straight away. */
async function loot(c: Ctx): Promise<void> {
    for (let i = 0; i < 3 && going(c) && (c.sdk.getState()?.inventory.length ?? 28) < 28; i++) {
        const drop = c.sdk.getState()?.groundItems.find(g => LOOT.test(g.name) && g.distance <= 4);
        if (!drop) break;
        await c.bot.pickupItem(drop).catch(() => {});
    }
    await buryAll(c);
}

const count = (c: Ctx, pattern: RegExp) =>
    c.sdk.getInventory().filter(i => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);

/**
 * Some actions open a "how many?" choice the first time; pick the largest option offered.
 * Level-up messages are dismissed by the bot helpers on their own.
 */
async function answerQuantity(c: Ctx): Promise<void> {
    const options = c.sdk.getDialog()?.options ?? [];
    const all = options.find(o => /\ball\b/i.test(o.text)) ?? options.find(o => /\b(28|27|10|5)\b/.test(o.text));
    if (all) await c.sdk.clickDialogByText(new RegExp(all.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).catch(() => {});
}

/**
 * Repeats `step` while `has` holds, until the deadline. A step that changes nothing three
 * times in a row means the character cannot do it here, and ends the pass with a blocker.
 */
async function repeat(c: Ctx, has: () => boolean, step: () => Promise<unknown>, why: string): Promise<string | void> {
    let idle = 0;
    while (going(c) && has()) {
        const d = await danger(c);
        if (d) return d;
        const snapshot = () => JSON.stringify(c.sdk.getInventory().map(i => [i.name, i.count]));
        const before = snapshot();
        await step();
        await answerQuantity(c);
        // Smelting, cooking and fletching take a few ticks to land in the pack.
        await c.sdk.waitForCondition(() => snapshot() !== before, 8000).catch(() => {});
        if (snapshot() === before) {
            if (++idle >= 3) return why;
        } else idle = 0;
    }
}

const RAW_FOOD = /^raw /i;
/** Cooking level each raw fish needs, from the game's cooking rules. */
const COOK_LEVELS: Record<string, number> = { shrimps: 1, anchovies: 1, sardine: 1, herring: 5, trout: 15, pike: 20, salmon: 25, tuna: 30, lobster: 40, swordfish: 45 };
const FISH_NAMES = /^(shrimps|anchovies|sardine|herring|trout|pike|salmon|tuna|lobster|swordfish)$/i;
/** A named cooking order selects that raw fish; no target retains the general cooking action. */
const rawFoodTarget = (target: string | null | undefined): RegExp | null | undefined => {
    if (!target?.trim()) return null;
    const fish = cleanLookupText(target).toLowerCase().replace(/^raw /, '').trim();
    return FISH_NAMES.test(fish) ? new RegExp(`^raw ${esc(fish)}$`, 'i') : undefined;
};
/** Combat spells: Magic level and the runes one cast uses. */
const SPELLS: { name: string; level: number; runes: [string, number][] }[] = [
    { name: 'wind strike', level: 1, runes: [['air', 1], ['mind', 1]] },
    { name: 'water strike', level: 5, runes: [['water', 1], ['air', 1], ['mind', 1]] },
    { name: 'earth strike', level: 9, runes: [['earth', 2], ['air', 1], ['mind', 1]] },
    { name: 'fire strike', level: 13, runes: [['fire', 3], ['air', 2], ['mind', 1]] },
    { name: 'wind bolt', level: 17, runes: [['air', 2], ['chaos', 1]] },
    { name: 'water bolt', level: 23, runes: [['water', 2], ['air', 2], ['chaos', 1]] },
    { name: 'earth bolt', level: 29, runes: [['earth', 3], ['air', 2], ['chaos', 1]] },
    { name: 'fire bolt', level: 35, runes: [['fire', 4], ['air', 3], ['chaos', 1]] },
    { name: 'wind blast', level: 41, runes: [['air', 3], ['death', 1]] },
    { name: 'water blast', level: 47, runes: [['water', 3], ['air', 3], ['death', 1]] },
    { name: 'earth blast', level: 53, runes: [['earth', 4], ['air', 3], ['death', 1]] },
    { name: 'fire blast', level: 59, runes: [['fire', 5], ['air', 4], ['death', 1]] }
];
const runeText = (sp: { runes: [string, number][] }) => sp.runes.map(([r, n]) => `${n} ${r} rune${n > 1 ? 's' : ''}`).join(' + ');
/** Whether the pack (plus a wielded elemental staff) covers one cast. */
function affordable(s: BotWorldState, sp: { runes: [string, number][] }): boolean {
    return sp.runes.every(([rune, n]) => {
        const staff = ['air', 'water', 'earth', 'fire'].includes(rune) && s.equipment.some(i => new RegExp(`staff of ${rune}|${rune} battlestaff`, 'i').test(i.name));
        return staff || s.inventory.filter(i => new RegExp(`^${rune} rune$`, 'i').test(i.name)).reduce((t, i) => t + i.count, 0) >= n;
    });
}
/** "wind strike on chicken" -> the spell (undefined: unknown name, null: best available) and the monster. */
function castOf(target: string | null | undefined): { spell: (typeof SPELLS)[number] | null | undefined; monster: string } {
    const t = (target ?? '').toLowerCase().trim();
    const [first, rest] = t.split(/\s+on\s+/);
    const named = SPELLS.find(x => first === x.name || first.startsWith(x.name));
    if (named) return { spell: named, monster: (rest ?? first.slice(named.name.length)).trim() };
    if (rest) return { spell: undefined, monster: rest.trim() };
    return { spell: null, monster: t };
}

function jewelleryOf(t: string): { product: string; gem: string } {
    const product = /necklace/.test(t) ? 'necklace' : /amulet/.test(t) ? 'amulet' : 'ring';
    const gem = ['sapphire', 'emerald', 'ruby', 'diamond'].find(g => t.includes(g)) ?? 'gold';
    return { product, gem };
}
const METAL_WORDS: Record<string, string> = { adamant: 'adamant(?:ite)?', rune: 'run(?:e|ite)' };
const metalOf = (target: string | null | undefined) => Object.keys(ORE_PAIRS).find(m => new RegExp(`\\b${METAL_WORDS[m] ?? m}\\b`, 'i').test(target ?? '')) ?? 'bronze';

// Raw materials and bars sell by default. Crafted goods (daggers, bows) only when named as the
// target, since starter weapons share their names. Tools are never sold.
const SELLABLE = /logs$|ore$|^raw |bar$|bones$|hide$|feather/i;
const NEVER_SELL = /(^|\s)(axe|pickaxe|hammer|knife|tinderbox|small fishing net|chisel)$/i;
function sellable(name: string, target: string | null): boolean {
    if (NEVER_SELL.test(name)) return false;
    if (!target?.trim()) return SELLABLE.test(name);
    return name.toLowerCase().includes(target.trim().toLowerCase().replace(/s$/, ''));
}
// Coal and clay carry no "ore" in their names; uncut gems come from mining too.
const BANKABLE = /logs$|ore$|^coal$|^clay$|^uncut |^raw |bones$|hide$|feather|bar$|arrow shaft|^(shrimps|anchovies|sardine|herring|trout|pike|salmon|tuna|lobster|swordfish)$/i;

const PORT_SARIM_DOCK = { x: 3028, z: 3216 };
const KARAMJA_CUSTOMS = { x: 2953, z: 3147 };
const KARAMJA_FISHING_SPOT = { x: 2925, z: 3180 };
const onKaramja = (c: Ctx) => {
    const p = pos(c);
    if (tiles(p, KARAMJA_FISHING_SPOT) <= 8) return true;
    const end = findLongPath(0, p.x, p.z, KARAMJA_FISHING_SPOT.x, KARAMJA_FISHING_SPOT.z, 2000).at(-1);
    return !!end && tiles(end, KARAMJA_FISHING_SPOT) <= 8;
};

/** Ferry crew wander and the server drops a talk sent just after arrival, so retry a few times. */
async function talkToFerryman(c: Ctx, npc: string, near: { x: number; z: number }) {
    // A dialogue left open (or stale) from earlier would be answered instead of this conversation.
    if (c.sdk.getState()?.dialog?.isOpen) {
        await c.sdk.sendCloseModal();
        await c.sdk.waitForTicks(2);
    }
    // The client can keep reporting the old page for a few ticks; remember it so it is never answered.
    const stale = c.sdk.getState()?.dialog?.pageId;
    let talk = await c.bot.interactNpc(npc, /^talk-to$/i);
    for (let attempt = 1; attempt < 4 && !talk.success; attempt++) {
        await c.sdk.waitForTicks(5);
        if (talk.reason === 'cant_reach') await goNear(c, near.x, near.z, 2);
        talk = await c.bot.interactNpc(npc, /^talk-to$/i);
    }
    return { ...talk, stale };
}

/** Drive a ferry conversation: click "continue" pages and pick each wanted choice in order, until it closes. */
async function converse(c: Ctx, choices: RegExp[], stale?: string): Promise<string | void> {
    let next = 0;
    let closed = 0;
    for (let i = 0; i < 80 && closed < 5; i++) {
        const dialog = c.sdk.getState()?.dialog;
        if (dialog?.isOpen && stale && dialog.pageId === stale) {
            // Leftover page from before this conversation: wait for the real one.
        } else if (dialog?.isOpen) {
            closed = 0;
            const want = choices[next];
            if (want && dialog.options.some(o => want.test(o.text))) {
                const result = await c.sdk.clickDialogByText(want);
                if (!result.success) return `ferry dialogue did not offer ${want}: ${result.message}`;
                next++;
            } else if (dialog.options.some(o => /click here to continue/i.test(o.text))) await c.sdk.clickDialogByText(/click here to continue/i);
        } else closed++;
        await c.sdk.waitForTicks(1);
    }
    return next < choices.length ? `ferry dialogue never offered ${choices[next]}` : undefined;
}

export async function crossGangplank(c: Ctx): Promise<string | void> {
    return leaveDockedFerry({
        state: () => c.sdk.getState()!,
        cancelled: () => c.signal.aborted || Date.now() >= c.deadline,
        climb: async () => {
            const ladder = c.sdk.getState()?.nearbyLocs.find(l => l.name === "Ship's ladder" && l.reachable === true
                && l.optionsWithIndex.some(o => /^climb-up$/i.test(o.text)));
            return !!ladder && (await c.bot.interactLoc(ladder, /^climb-up$/i)).success;
        },
        cross: async () => {
            const plank = c.sdk.getState()?.nearbyLocs.find(l => l.level === 1 && /^gangplank$/i.test(l.name) && l.reachable === true);
            return !!plank && (await c.bot.interactLoc(plank, /^cross$/i)).success;
        },
        wait: async test => { await c.sdk.waitForCondition(test, 8000).catch(() => {}); },
    });
}

async function ferryFare(c: Ctx): Promise<string | void> {
    const rum = c.sdk.getInventory().find(i => /^karamjan rum/i.test(i.name));
    if (rum) return `the Karamja Customs officer confiscates ${rum.name}; bank it before taking the ferry`;
    const needed = onKaramja(c) ? 30 : 60;
    let coins = c.sdk.countInventoryItems(/^coins$/i);
    if (coins >= needed) return;
    const bank = nearestBank(c);
    const walk = await goNear(c, bank.x, bank.z, 4);
    if (walk) return walk;
    const opened = await c.bot.openBank();
    if (!opened.success) return `the Karamja ferry needs ${needed} coins (${needed === 60 ? '30 each way' : '30 to return'}); could not open your bank`;
    noteBank(c.name, c.sdk);
    const available = bankOf(c.name)?.items.Coins ?? 0;
    if (coins + available < needed) {
        await c.bot.closeBank();
        return `the Karamja ferry needs ${needed} coins (${needed === 60 ? '30 each way' : '30 to return'}); you have ${coins} carried and ${available} banked`;
    }
    const result = await c.bot.withdrawItem(/^coins$/i, needed - coins);
    await c.sdk.waitForTicks(1);
    noteBank(c.name, c.sdk);
    await c.bot.closeBank();
    coins = c.sdk.countInventoryItems(/^coins$/i);
    return result.success && coins >= needed ? undefined : `could not withdraw the ${needed} coins needed for the Karamja ferry`;
}

async function sailToKaramja(c: Ctx): Promise<string | void> {
    if (onKaramja(c)) return;
    const walk = await goNear(c, PORT_SARIM_DOCK.x, PORT_SARIM_DOCK.z, 5);
    if (walk) return walk;
    // The client can report a menu before the NPC has spoken, so verify the ship actually left and retry.
    for (let attempt = 0; attempt < 3 && pos(c).x >= 3000; attempt++) {
        if (attempt) await goNear(c, PORT_SARIM_DOCK.x, PORT_SARIM_DOCK.z, 5);
        const talk = await talkToFerryman(c, 'Captain Tobias', PORT_SARIM_DOCK);
        if (!talk.success) return `could not reach Captain Tobias for the Karamja ferry: ${talk.message}`;
        const choice = await converse(c, [/yes please/i], talk.stale);
        if (choice && attempt === 2) return choice;
        await c.sdk.waitForCondition(s => !!s.player && s.player.worldX < 3000, 15000).catch(() => {});
    }
    const shore = await crossGangplank(c);
    if (shore) return shore;
    if (!onKaramja(c)) return `the ferry did not reach Karamja; you are at ${pos(c).x}, ${pos(c).z}`;
}

async function sailToPortSarim(c: Ctx): Promise<string | void> {
    const exit = await crossGangplank(c);
    if (exit) return exit;
    if (!onKaramja(c)) {
        // Resume a return that reached the mainland ship but not its shore.
        const p = c.sdk.getState()?.player;
        if (p?.level === 1 && tiles(pos(c), PORT_SARIM_DOCK) <= 12) return crossGangplank(c);
        return;
    }
    if (c.signal.aborted || Date.now() >= c.deadline) return 'return ferry cancelled or pass time expired';
    // Mainland banking preparation can run before fish.run, including with a full pack.
    // Do not try to walk to an inaccessible bank to fund this return, or lose rum to Customs.
    if (c.sdk.getInventory().some(i => /^karamjan rum/i.test(i.name))) return 'cannot return by ferry while carrying Karamjan rum; Customs would confiscate it';
    if (c.sdk.countInventoryItems(/^coins$/i) < 30) return 'the return ferry needs 30 carried coins; mainland bank stock cannot fund an island departure';
    const walk = await goNear(c, KARAMJA_CUSTOMS.x, KARAMJA_CUSTOMS.z, 5);
    if (walk) return walk;
    for (let attempt = 0; attempt < 3 && pos(c).x < 3000; attempt++) {
        if (attempt) await goNear(c, KARAMJA_CUSTOMS.x, KARAMJA_CUSTOMS.z, 5);
        const talk = await talkToFerryman(c, 'Customs officer', KARAMJA_CUSTOMS);
        if (!talk.success) return `could not reach the Customs officer for the return ferry: ${talk.message}`;
        const error = await converse(c, [/Can I journey on this ship/i, /Search away, I have nothing to hide/i, /^Ok\.$/i], talk.stale);
        if (error && attempt === 2) return error;
        await c.sdk.waitForCondition(s => !!s.player && s.player.worldX > 3000, 15000).catch(() => {});
    }
    const dock = await crossGangplank(c);
    if (dock) return dock;
    if (onKaramja(c)) return `the return ferry did not reach Port Sarim; you are at ${pos(c).x}, ${pos(c).z}`;
}

function assistOps(c: Ctx): AssistOps {
    return {
        peers: name => agents.get(name)?.assistPeer(), registry: assistPairs, tactics: checkTactics(c.tactics),
        eat: () => eatObserved(c), flee: () => flee(c), style: () => setStyle(c, checkTactics(c.tactics).style),
        announce: summary => emit(c.name, 'info', { summary }),
        engagement:sharedEngagement=>emit(c.name,'info',{sharedEngagement}),
        invite: (to, text) => !!post(c.name, to, text, { urgent: true }),
    };
}
function assistPartner(s: BotWorldState, a: Args): string | null {
    const name = a.target?.trim().toLowerCase();
    if (!name || !agents.has(name) || name === s.player?.name.toLowerCase()) return 'choose a different online party member by name';
    return null;
}

export const SKILLS: Record<string, SkillDef> = {
    invite_assist: {
        description: 'Invite one nearby teammate to assist your next fight. First step only, immediately followed by fight for 1-15 minutes, no repeat. Use minutes 1 for invite; waits up to 60 seconds for voluntary acceptance and rendezvous. Invitation prompts a decision; the partner may decline.',
        target: 'party member name', activity: 'errands', oneShot: true,
        requires: (s,a) => assistPartner(s,a),
        run: (c,a) => runInvite(c,a.target!.trim().toLowerCase(),assistOps(c)),
    },
    assist: {
        description: 'Accept a current invitation from the named leader, follow locally and join only their exact NPC in mapped multicombat. One step, minutes 1-15, no repeat. Keeps your own safety/style; reports confirmed shared engagements, never inferred kills. Stops if consent, partner, activity or safety is lost.',
        target: 'inviting party member name', activity: 'combat',
        requires: (s,a) => assistPartner(s,a) ?? (assistPairs.get(s.player?.name.toLowerCase() ?? '')?.leader === a.target?.trim().toLowerCase() ? null : 'no current assist invitation from that leader'),
        run: (c,a) => runAssist(c,a.target!.trim().toLowerCase(),assistOps(c)),
    },
    chop_trees: {
        description: `Chop trees for logs at the nearest trees of that kind. Kinds and Woodcutting levels: ${typesOf('tree').map(t => `${t} ${NEEDS[t]?.level ?? 1}`).join(', ')}.`,
        target: typesOf('tree').join(' | '),
        activity: 'woodcutting',
        gathers: true,
        requires: (s, a) => needs('axe', /(?<!pick)axe$/i)(s) ?? levelFor(s, treeType(a.target)),
        async run(c, a) {
            const type = treeType(a.target);
            const name = type === 'tree' ? /^tree$/i : new RegExp(`^${type}( tree)?$`, 'i');
            const tried: Spot[] = [];
            while (going(c) && !packFull(c.sdk.getState())) {
                const d = await danger(c);
                if (d) return d;
                const tree = c.sdk.findNearbyLoc(name, { reachable: true });
                if (!tree) {
                    // Felled trees grow back; until then, the next grove of the kind.
                    const spot = nextSpot(c, 'tree', type, tried);
                    if (!spot) return tried.length ? `no ${type} trees standing at ${tried.map(t => t.near).join(', ')}` : `no ${type} trees known`;
                    tried.push(spot);
                    const w = await goNear(c, spot.x, spot.z, 4);
                    if (w) return w;
                    continue;
                }
                const r = await c.bot.chopTree(tree);
                if (!r.success) await c.sdk.waitForTicks(2);
            }
        }
    },
    fish: {
        description: `Fish at the nearest spot that offers the method. Methods: ${Object.entries(FISHING)
            .map(([k, f]) => `${k} (Fishing ${f.level}, ${f.tools.map(t => t[0]).join(' + ')}: ${f.catches})`)
            .join('; ')}. Rods, bait, feathers, harpoons and lobster pots are sold at Gerrant's in Port Sarim.`,
        target: Object.keys(FISHING).join(' | '),
        activity: 'fishing',
        gathers: true,
        requires: (s, a) => {
            const m = FISHING[fishMethod(a.target)];
            const missing = m.tools.filter(([, re]) => !carried(s, re)).map(([n]) => n);
            if (missing.length) {
                // Where the missing gear is sold, from the shop catalogue (buy takes you there).
                const sellers = missing.map(m => SHOPS.find(sh => sh.items.some(i => i.name.toLowerCase() === m.toLowerCase()))).filter(Boolean);
                const where = [...new Set(sellers.map(sh => sh!.name))];
                return `${fishMethod(a.target)} fishing needs ${missing.join(' and ')}${where.length ? ` (sold at ${where.join(', ')})` : ''}`;
            }
            if (level(s, 'Fishing') < m.level) return `${fishMethod(a.target)} fishing needs Fishing ${m.level} (you are ${level(s, 'Fishing')})`;
            const p = s.player;
            const spots = p ? nearest('fishing', { x: p.worldX, z: p.worldZ }, m.spot, { allowToll: true }) : [];
            if (!spots.length) return `no ${m.spot} fishing spot known`;
            // Blocked only if every spot of the kind has monsters that would hunt this character.
            return spots.some(x => !huntedAt(s, x)) ? null : huntedAt(s, spots[0]);
        },
        async run(c, a) {
            const m = FISHING[fishMethod(a.target)];
            const st = c.sdk.getState();
            const safe = nearest('fishing', pos(c), m.spot, { allowToll: true }).filter(x => !(st && huntedAt(st, x)));
            const place = safe.length ? avoidToll(c, safe) : spotNear(c, 'fishing', m.spot);
            if (!place) return `no ${m.spot} fishing spot known`;
            if (m.via) {
                const fare = await ferryFare(c);
                if (fare) return fare;
                const voyage = await sailToKaramja(c);
                if (voyage) return voyage;
            }
            const w = await goNear(c, place.x, place.z, 6);
            if (w) {
                if (m.via && onKaramja(c)) return (await sailToPortSarim(c)) ?? w;
                return w;
            }
            let blocker: string | undefined;
            while (going(c) && !packFull(c.sdk.getState())) {
                const d = await danger(c);
                if (d) { blocker = d; break; }
                const spot = c.sdk.getState()?.nearbyNpcs.find(n => /fishing\s*spot/i.test(n.name) && n.optionsWithIndex.some(o => m.option.test(o.text)));
                if (!spot) {
                    await goNear(c, place.x, place.z, 2);
                    await c.sdk.waitForTicks(4);
                    continue;
                }
                const opt = spot.optionsWithIndex.find(o => m.option.test(o.text))!;
                await c.bot.interactNpc(spot, opt.text);
                await c.sdk.waitForTicks(8);
            }
            const home = m.via && onKaramja(c) ? await sailToPortSarim(c) : undefined;
            return blocker ?? home;
        }
    },
    mine: {
        description: `Mine at the nearest rocks of that kind. Kinds and Mining levels: ${typesOf('rock')
            .sort((a, b) => (NEEDS[a]?.level ?? 0) - (NEEDS[b]?.level ?? 0))
            .map(t => `${t} ${NEEDS[t]?.level ?? 1}`)
            .join(', ')}. Coal and iron make steel at a furnace.`,
        target: typesOf('rock').join(' | '),
        activity: 'mining',
        gathers: true,
        requires: (s, a) => {
            const missing = needs('pickaxe', /pickaxe$/i)(s);
            if (missing) return missing;
            const type = rockType(a.target);
            if (a.target?.trim() && !type) return `no ${a.target} rocks known; kinds: ${typesOf('rock').join(', ')}`;
            return levelFor(s, type ?? 'copper');
        },
        async run(c, a) {
            const ore = rockType(a.target) ?? 'copper';
            const tried: Spot[] = [];
            let place = nextSpot(c, 'rock', ore, tried);
            if (!place) return `no ${ore} rocks known where nothing would attack you`;
            tried.push(place);
            const w = await goNear(c, place.x, place.z, 8);
            if (w) return w;
            let missed = 0;
            // Rocks that just refused (mined out, until they respawn), so the next try picks another.
            const refused = new Map<string, number>();
            const pattern = new RegExp(`\\b${ore}`, 'i');
            while (going(c) && !packFull(c.sdk.getState())) {
                const d = await danger(c);
                if (d) return d;
                const me = pos(c);
                const rock = c.sdk
                    .getState()
                    ?.nearbyLocs.filter(l => pattern.test(l.name) && l.optionsWithIndex.some(o => /^mine$/i.test(o.text)) && (refused.get(`${l.x},${l.z}`) ?? 0) < Date.now())
                    .sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];
                const before = count(c, pattern);
                const r = await c.bot.mineRock(rock ?? pattern);
                // A click while the pickaxe is still swinging is discarded ("rejected"), but the
                // mining goes on: wait for that swing to land rather than count it as a miss.
                if (!r.success) {
                    await c.sdk.waitForCondition(() => count(c, pattern) > before, 8_000).catch(() => {});
                    if (count(c, pattern) > before) {
                        missed = 0;
                        continue;
                    }
                }
                if (!r.success && rock) refused.set(`${rock.x},${rock.z}`, Date.now() + 20_000);
                // A level-up message blocks every click until it is closed.
                if (!r.success) await c.bot.dismissBlockingUI().catch(() => {});
                if (c.stall) c.stall.why = r.success ? undefined : `no ${ore} ore yielded: ${r.message}${rock ? '' : ' (no rock in view)'}`;
                if (r.success) missed = 0;
                else if (++missed < 10) await c.sdk.waitForTicks(12); // mined-out rocks respawn (coal ~50 ticks)
                else {
                    // Still empty (others mining it, or a small spot): try the next one.
                    place = nextSpot(c, 'rock', ore, tried);
                    if (!place) return `no ${ore} ore to be had at ${tried.map(t => t.near).join(', ')}: ${r.message}`;
                    tried.push(place);
                    missed = 0;
                    const moved = await goNear(c, place.x, place.z, 8);
                    if (moved) return moved;
                }
            }
        }
    },
    fight: {
        description: 'Fight any monster in the free-to-play world by name (your nearby options list some for your level; lookup finds others), at the nearest group of them. Buries their bones for Prayer. Follows your fight tactics (when to eat, when to retreat, whether to stay to finish a nearly beaten enemy, which monster to pick, combat style); the whole-order report separates observed target defeats, unresolved encounters, observed HP loss and food eaten, with operation timings and measured XP/hour. Target disappearance is not a confirmed kill; stronger monsters can hit harder and are not automatically better XP/hour.',
        target: 'monster name, e.g. cow, barbarian, unicorn, guard',
        activity: 'combat',
        requires: (_s, a) => (!a.target?.trim() || fightSpot(a.target) ? null : `no ${a.target} known in the free-to-play world; lookup can find monsters by name`),
        async run(c, a) {
            const type = fightSpot(a.target) ?? 'cow';
            const tried: Spot[] = [];
            const pattern = new RegExp(`^${type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
            const windDown=()=>awaitCombatWindDown({state:()=>c.sdk.getState(),going:()=>going(c),next:()=>c.sdk.waitForTicks(1)});
            await windDown();
            let initial=c.sdk.getState();
            while(going(c)&&initial?.player?.combat.inCombat&&initial.player.combat.targetType==='npc') {
                const target=initial.nearbyNpcs.find(n=>n.index===initial!.player!.combat.targetIndex);
                if(target&&target.hp!==0&&target.healthPercent!==0)break;
                await c.sdk.waitForTicks(1);initial=c.sdk.getState();
            }
            if(!going(c))return;
            const tracked=c.fightReport?.trackedTarget(initial);
            const initialNpc=initial?.player?.combat.targetType==='npc'?initial.nearbyNpcs.find(n=>n.index===initial.player!.combat.targetIndex):undefined;
            if(initial?.player?.combat.inCombat) {
                if(!initialNpc||!pattern.test(initialNpc.name)||(tracked&&(initialNpc.index!==tracked.index||initialNpc.id!==tracked.id)))
                    return `another fight interrupted this target: ${(await flee(c))??'retreated'}`;
            }
            const retained=tracked??(initial?.player?.combat.inCombat?initialNpc:undefined);
            let place = nextSpot(c, 'monster', type, tried, { hunted: true });
            if (!place&&!retained) return `no ${type} known where you could fight them`;
            if(place)tried.push(place);
            if(!retained&&place) {
                const w = await fightPhase(c,'moving',()=>goNear(c, place!.x, place!.z, 12));
                if(w)return w;
            }
            const t = checkTactics(c.tactics);
            await setStyle(c, t.style);
            let misses = 0;
            while (going(c)) {
                const d = await danger(c);
                if (d) {
                    return d;
                }
                const xpBefore = combatXp(c);
                await windDown();
                // A pass may expire while the previous fight's combat flag clears.
                // Let the executor resume; expiry is not evidence of another attacker.
                if(!going(c))return;
                const current=c.sdk.getState();
                const tracked=c.fightReport?.trackedTarget(current);
                const active=current?.player?.combat.inCombat&&current.player.combat.targetType==='npc'?current.nearbyNpcs.find(n=>n.index===current.player!.combat.targetIndex):undefined;
                if(current?.player?.combat.inCombat) {
                    if(current.player.combat.targetType==='npc'&&(!active||active.hp===0||active.healthPercent===0)) {await c.sdk.waitForTicks(1);continue;}
                    if(!active||!pattern.test(active.name)||(tracked&&(active.index!==tracked.index||active.id!==tracked.id)))
                        return `another fight interrupted this target: ${(await flee(c))??'retreated'}`;
                }
                const selected=tracked ?? active ?? chooseTarget(c,pattern,t) ?? [...(current?.nearbyNpcs??[])].filter(n=>pattern.test(n.name)&&n.hp!==0&&n.healthPercent!==0&&n.reachable!==false&&n.optionsWithIndex.some(o=>/^attack$/i.test(o.text))).sort((a,b)=>a.distance-b.distance)[0];
                if(selected)c.fightReport?.select(selected);
                const r = selected&&exactCombat(c.sdk.getState(),selected)?{success:true,message:'already engaged with exact target'}:await fightPhase(c,'combat',()=>c.bot.attack(selected ?? pattern));
                c.fightReport?.observe(c.sdk.getState()!);
                // An attack on a monster behind a fence "succeeds" but no fight ever starts.
                if (r.success) await fightPhase(c,'combat',()=>c.sdk.waitForCondition(() => combatXp(c) > xpBefore || !!selected&&exactCombat(c.sdk.getState(),selected), 12_000).catch(() => {}));
                const stillEngaged=selected&&(exactCombat(c.sdk.getState(),selected)||c.fightReport?.trackedTarget(c.sdk.getState())?.index===selected.index);
                if ((!r.success || combatXp(c) === xpBefore) && !stillEngaged) {
                    // Monsters behind a fence (the Champions' Guild chicken pen) look reachable in
                    // the index: after repeated misses, remember the spot and try the next group.
                    if (++misses >= 6) {
                        if(place)strike(place, `${type}s near ${place.near} could not be reached to attack`);
                        place = nextSpot(c, 'monster', type, tried, { hunted: true });
                        if (!place) return `could not reach any ${type} to attack (${r.message})`;
                        tried.push(place);
                        misses = 0;
                    }
                    if(!place)return `no reachable ${type} site after the engagement ended`;
                    await fightPhase(c,'moving',()=>goNear(c, place!.x, place!.z, 6));
                    await c.sdk.waitForTicks(3);
                    continue;
                }
                misses = 0;
                if(!selected)continue;
                const outcome=await fightPhase(c,'combat',()=>waitForEngagement({
                    target:selected,state:()=>c.sdk.getState(),going:()=>going(c),tactics:t,
                    eat:()=>eatObserved(c),next:()=>c.sdk.waitForTicks(1),
                }));
                if(outcome==='retreat') {
                    const hp=c.sdk.getState()?.player;
                    await fightPhase(c,'moving',()=>flee(c));
                    return `retreated from the fight at HP ${hp?.hp}/${hp?.maxHp}; independent safety threshold or target mismatch`;
                }
                // Never loot or select a different target while the tracked engagement is unresolved.
                if(outcome!=='ended')continue;
                c.fightReport?.observe(c.sdk.getState()!);
                if (t.loot === 'bones') await fightPhase(c,'looting',()=>loot(c));
            }
        }
    },
    cast: {
        description: "Magic: cast a combat spell at the nearest monster of a kind (\"wind strike on chicken\"), or name only the monster and the best spell you can cast and afford is used. Each cast uses runes you carry (a staff of air, water, earth or fire wielded stands in for that rune): strikes use a mind rune, bolts a chaos rune, blasts a death rune; Aubury's Rune Shop in Varrock sells air, water, earth, fire, mind, chaos and death runes (buy them). Magic levels: wind strike 1, water strike 5, earth strike 9, fire strike 13, wind bolt 17, water bolt 23, earth bolt 29, fire bolt 35, wind blast 41, water blast 47, earth blast 53, fire blast 59. Monsters hit back, so it follows your fight tactics for eating and retreating.",
        target: 'spell on monster, e.g. wind strike on chicken | fire bolt on guard | chicken (best spell)',
        activity: 'combat',
        requires: (s, a) => {
            const { spell, monster } = castOf(a.target);
            if (spell === undefined) return `no spell called that; combat spells: ${SPELLS.map(x => x.name).join(', ')}`;
            if (monster && !fightSpot(monster)) return `no ${monster} known in the free-to-play world; lookup can find monsters by name`;
            const magic = level(s, 'Magic');
            const options = spell ? [spell] : SPELLS;
            if (!options.some(x => x.level <= magic)) return `${options[0].name} needs Magic ${options[0].level} (you are ${magic})`;
            if (!options.some(x => x.level <= magic && affordable(s, x))) {
                const first = (spell ?? SPELLS[0]);
                return `no runes for ${spell ? spell.name : 'any spell you can cast'}: ${first.name} needs ${runeText(first)} (Aubury's Rune Shop in Varrock sells them: buy ${first.runes[0][0]} rune)`;
            }
            return null;
        },
        async run(c, a) {
            const { spell: asked, monster } = castOf(a.target);
            const type = fightSpot(monster) ?? 'chicken';
            const tried: Spot[] = [];
            let place = nextSpot(c, 'monster', type, tried, { hunted: true });
            if (!place) return `no ${type} known where you could fight them`;
            tried.push(place);
            const pattern = new RegExp(`^${type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
            const w = await goNear(c, place.x, place.z, 8);
            if (w) return w;
            const t = checkTactics(c.tactics);
            const report = { casts: 0, splashes: 0 };
            const magicXp0 = c.sdk.getState()?.skills.find(k => k.name === 'Magic')?.experience ?? 0;
            const say = (end?: string) => {
                const gained = (c.sdk.getState()?.skills.find(k => k.name === 'Magic')?.experience ?? 0) - magicXp0;
                c.notes?.push(`cast report: ${report.casts} casts at ${type}s (${report.splashes} splashed), +${gained} Magic xp${end ? `, ${end}` : ''}`);
            };
            let misses = 0;
            while (going(c)) {
                const d = await danger(c);
                if (d) {
                    say('retreated');
                    return d;
                }
                const st = c.sdk.getState()!;
                const magic = level(st, 'Magic');
                const spell = asked ?? [...SPELLS].reverse().find(x => x.level <= magic && affordable(st, x));
                if (!spell || !affordable(st, spell)) {
                    say('out of runes');
                    return report.casts ? undefined : `out of runes for ${asked ? asked.name : 'any spell'} (${asked ? runeText(asked) : 'wind strike needs ' + runeText(SPELLS[0])})`;
                }
                const r = await c.bot.castSpell(pattern, spell.name);
                if (r.success) {
                    report.casts++;
                    if (!(r as any).hit) report.splashes++;
                    misses = 0;
                    // The monster hits back and a kill ends the fight: wait for the next one to line up.
                    await c.sdk.waitForTicks(2);
                    continue;
                }
                if ((r as any).reason === 'no_runes') continue; // the next loop picks a cheaper spell or stops
                if (++misses >= 6) {
                    strike(place, `${type}s near ${place.near} could not be reached to cast at`);
                    place = nextSpot(c, 'monster', type, tried, { hunted: true });
                    if (!place) {
                        say('could not reach any');
                        return `could not reach any ${type} to cast at (${r.message})`;
                    }
                    tried.push(place);
                    misses = 0;
                }
                await goNear(c, place.x, place.z, 6);
                await c.sdk.waitForTicks(3);
            }
            say();
        }
    },
    pickpocket: {
        description: 'Pickpocket the men at Lumbridge castle for coins (about 3 a time) and Thieving XP. A failed attempt stuns you and costs a little HP.',
        activity: 'thieving',
        async run(c) {
            const w = await goNear(c, PLACES.lumbridge_men.x, PLACES.lumbridge_men.z, 10);
            if (w) return w;
            let idle = 0;
            while (going(c)) {
                const d = await danger(c);
                if (d) return d;
                const man = c.sdk.getState()?.nearbyNpcs.find(n => /^man$|^woman$/i.test(n.name) && n.optionsWithIndex.some(o => /pickpocket/i.test(o.text)));
                if (!man) {
                    if (c.stall) c.stall.why = 'no man or woman with a pickpocket option in view';
                    await goNear(c, PLACES.lumbridge_men.x, PLACES.lumbridge_men.z, 3);
                    await c.sdk.waitForTicks(4);
                    if (++idle >= 5) return 'no one to pickpocket nearby';
                    continue;
                }
                idle = 0;
                const r = await c.bot.pickpocketNpc(man);
                if (c.stall) c.stall.why = r.success ? undefined : `${r.message}${r.reason ? ` [${r.reason}]` : ''}`;
                if (!r.success) await c.sdk.waitForTicks(4); // stunned, or the man walked off
            }
        }
    },
    cook: {
        description: "Cook raw fish on the free range just south of Bob's in Lumbridge. Cooked fish is food for fights (some will burn at low Cooking, and burnt fish is dropped).",
        target: 'optional raw fish, e.g. raw trout; otherwise cook usable fish you carry',
        activity: 'crafting',
        oneShot: true,
        requires: (s, a) => {
            const requested = rawFoodTarget(a.target);
            if (requested === undefined) return `unknown raw fish ${a.target}`;
            const match = requested ?? RAW_FOOD;
            if (s.inventory.some(i => match.test(i.name) && i.count === 1 && cookingLevel(i.name) <= level(s, 'Cooking'))) return null;
            // Cooked fish has no "cooked" in its name: "Shrimps" is cooked, "Raw shrimps" is not.
            const cooked = [...new Set(s.inventory.filter(i => FISH_NAMES.test(i.name)).map(i => i.name))];
            return `no raw food to cook${cooked.length ? `: ${cooked.join(', ')} ${cooked.length > 1 ? 'are' : 'is'} already cooked (raw fish is named "Raw ...", e.g. Raw shrimps)` : ''}`;
        },
        async run(c, a) {
            const match = rawFoodTarget(a.target) ?? RAW_FOOD;
            const usable = (i: {name:string;count:number}) => match.test(i.name) && i.count === 1 && cookingLevel(i.name) <= (c.sdk.getSkill('Cooking')?.baseLevel ?? 1);
            return atStation(c, 'range', match, () =>
                repeat(
                    c,
                    () => c.sdk.getInventory().some(usable),
                    async () => {
                        const raw = c.sdk.getInventory().find(usable);
                        if (raw) await c.bot.useItemOnLoc(raw, /^range$/i, { timeout: 15_000 });
                    },
                    'the range would not cook it (if the fish is bank notes, it cannot be cooked: bank it, then withdraw it without "noted")'
                ),
                // Only the range's fault with unnoted raw fish the character can cook; too low a
                // Cooking level or notes fail at every range.
                () => {
                    const cooking = c.sdk.getSkill('Cooking')?.baseLevel ?? 1;
                    return c.sdk.getInventory().some(i => match.test(i.name) && i.count === 1 && cooking >= (COOK_LEVELS[i.name.toLowerCase().replace(/^raw /, '')] ?? 1));
                }
            ).finally(() => dropAll(c, /^burnt /i));
        }
    },
    look: {
        description: 'Look around: lists the people, monsters, objects and items on the ground near you, with the options each offers (e.g. "Doric: Talk-to", "Door: Open", "Ladder: Climb-up"), and any dialogue open. Use it before interact, use or pick_up.',
        activity: 'errands',
        oneShot: true,
        async run(c) {
            c.notes?.push(`looked around: ${surroundings(c)}`);
            const st=c.sdk.getState();
            c.observeWorld?.(st?dialogText(st):undefined);
        }
    },
    interact: {
        description: 'Do one thing to someone or something near you, by name and option, as look lists it: talk to a person ("Doric: Talk-to"), open a door or gate ("Door: Open"), climb stairs or a ladder ("Ladder: Climb-up"), and so on. Dialogue that follows is read out in the report, with its options for choose. People around the world have tasks for travellers (quests) that pay in XP, coins or items; talking to them is how you find out.',
        target: 'name and option, e.g. "Doric: Talk-to" or "Staircase: Climb-up"',
        activity: 'errands',
        oneShot: true,
        requires: (s, a) => (parseNameOption(a.target) ? null : 'say who or what and the option, e.g. "Doric: Talk-to"'),
        async run(c, a) {
            const { name, option } = parseNameOption(a.target)!;
            const re = new RegExp(`^${esc(name)}$`, 'i');
            const opt = new RegExp(`^${esc(option)}$`, 'i');
            const st = c.sdk.getState();
            const npc = st?.nearbyNpcs.find(n => re.test(n.name) && n.optionsWithIndex.some(o => opt.test(o.text)));
            const loc = npc ? undefined : st?.nearbyLocs.filter(l => re.test(l.name) && l.optionsWithIndex.some(o => opt.test(o.text))).sort((x, y) => x.distance - y.distance)[0];
            if (!npc && !loc) {
                // Teammates are players, not people of the world: they hear you through messages.
                if (/^(bram|wren|mike|trish)$/i.test(name)) return `${name} is a teammate, not someone of the world to talk to: reach teammates with messages on the board, and hand items over with give or ask with a want`;
                return `nothing called ${name} with "${option}" near you. Near you: ${surroundings(c)}`;
            }
            const before = pos(c);
            const r = npc ? await c.bot.interactNpc(npc, opt) : await c.bot.interactLoc(loc!, opt);
            await c.sdk.waitForTicks(3);
            const after = c.sdk.getState()?.player;
            const moved = after && (after.level !== c.sdk.getState()?.player?.level || Math.hypot(after.worldX - before.x, after.worldZ - before.z) > 3);
            const talk = await readDialog(c);
            c.notes?.push(`${name}: ${option}${r.success ? '' : ` (${r.message})`}${talk ? `; ${talk}` : ''}${moved ? `; you are now at ${after!.worldX}, ${after!.worldZ}${after!.level ? `, floor ${after!.level}` : ''}` : ''}`);
            if (!r.success && !talk) return `${name}: ${option} did not work: ${r.message}`;
            c.observeWorld?.(talk,r);
        }
    },
    choose: {
        description: 'Answer the dialogue that is open: pick one of the options the report listed, by its words (or "continue" when it only waits). The next lines and options are read out.',
        target: 'the option\'s words, or "continue"',
        activity: 'errands',
        oneShot: true,
        requires: s => (s.dialog?.isOpen ? null : 'no dialogue is open; interact with someone first (e.g. "Doric: Talk-to")'),
        async run(c, a) {
            const d = c.sdk.getState()?.dialog;
            if (!d?.isOpen) return 'no dialogue is open';
            const want = (a.target ?? '').trim().toLowerCase();
            const pickable = d.options.filter(o => o.text.trim());
            const hit = !want || want === 'continue' ? undefined : pickable.find(o => o.text.toLowerCase().includes(want)) ?? pickable.find(o => want.includes(o.text.toLowerCase()));
            if (want && want !== 'continue' && !hit) return `no option like "${a.target}"; the options are: ${pickable.map(o => o.text).join(' | ') || '(continue only)'}`;
            await c.sdk.sendClickDialog(hit ? hit.index : 0);
            await c.sdk.waitForTicks(2);
            const talk=await readDialog(c);
            c.notes?.push(`chose "${hit?.text ?? 'continue'}"; ${talk || 'the dialogue closed'}`);
            c.observeWorld?.(talk);
        }
    },
    use: {
        description: 'Use an item you carry on someone or something near you, e.g. "Clay on Doric" or "Bucket on Dairy cow". Follow-up dialogue is read out.',
        target: '"<item> on <name>"',
        activity: 'errands',
        oneShot: true,
        requires: (s, a) => {
            const m = (a.target ?? '').match(/^(.+?)\s+on\s+(.+)$/i);
            if (!m) return 'say "<item> on <name>", e.g. "Clay on Doric"';
            return s.inventory.some(i => i.name.toLowerCase() === m[1].trim().toLowerCase()) ? null : `you carry no ${m[1].trim()}`;
        },
        async run(c, a) {
            const [, item, name] = (a.target ?? '').match(/^(.+?)\s+on\s+(.+)$/i)!;
            const inv = c.sdk.getInventory().find(i => i.name.toLowerCase() === item.trim().toLowerCase());
            const re = new RegExp(`^${esc(name.trim())}$`, 'i');
            const st = c.sdk.getState();
            const npc = st?.nearbyNpcs.find(n => re.test(n.name));
            const loc = npc ? undefined : st?.nearbyLocs.filter(l => re.test(l.name)).sort((x, y) => x.distance - y.distance)[0];
            if (!inv || (!npc && !loc)) return `no ${name.trim()} near you to use it on. Near you: ${surroundings(c)}`;
            const r = npc ? await c.bot.useItemOnNpc(inv, npc) : await c.bot.useItemOnLoc(inv, loc!);
            await c.sdk.waitForTicks(3);
            const talk = await readDialog(c);
            c.notes?.push(`used ${item.trim()} on ${name.trim()}${r.success ? '' : ` (${r.message})`}${talk ? `; ${talk}` : ''}`);
            c.observeWorld?.(talk,r);
            if(!r.success)return `could not use ${item.trim()} on ${name.trim()}: ${r.message}`;
        }
    },
    pick_up: {
        description: 'Pick up an item lying on the ground near you (look lists them), e.g. an egg, a bucket or a dropped item.',
        target: 'item name, e.g. egg',
        activity: 'errands',
        oneShot: true,
        requires: (s, a) => (packFull(s) ? 'your pack is full' : null),
        async run(c, a) {
            const re = new RegExp(`^${esc((a.target ?? '').trim())}$`, 'i');
            const item = c.sdk.getState()?.groundItems.filter(g => re.test(g.name)).sort((x, y) => x.distance - y.distance)[0];
            if (!item) return `no ${a.target} on the ground near you. Near you: ${surroundings(c)}`;
            const r = await c.bot.pickupItem(item);
            if (!r.success) return `could not pick up ${item.name}: ${r.message}`;
        }
    },
    firemake: {
        description: 'Burn logs with a tinderbox for Firemaking XP. Uses up the logs.',
        activity: 'crafting',
        requires: s => (!carried(s, /tinderbox/i) ? 'needs a tinderbox' : s.inventory.some(i => /^logs$/i.test(i.name)) ? null : 'no logs to burn'),
        async run(c) {
            let failed = 0;
            while (going(c) && count(c, /^logs$/i) > 0) {
                const d = await danger(c);
                if (d) return d;
                const r = await c.bot.burnLogs(/^logs$/i);
                if (r.success) {
                    failed = 0;
                    continue;
                }
                // Fires cannot be lit on every tile (or on another fire): step aside and retry.
                const p = pos(c);
                await c.bot.walkTo(p.x + (failed % 2 ? -2 : 2), p.z + 1, 0, { timeout: 10_000 }).catch(() => {});
                if (++failed >= 4) return `could not light a fire: ${r.message}`;
            }
        }
    },
    fletch: {
        description: 'Fletch normal logs with a knife (picked up from its spawn by Lumbridge castle if you have none): arrow shafts at Fletching 1, shortbows at 5.',
        target: 'arrow shaft | shortbow',
        activity: 'crafting',
        requires: (s, a) => workRequirements(s, 'fletch', a).blocker ?? (s.inventory.some(i => /^logs$/i.test(i.name)) ? null : 'no logs to fletch'),
        async run(c, a) {
            if (!c.sdk.getInventory().some(i => /^knife$/i.test(i.name))) {
                const w = await goNear(c, PLACES.knife_spawn.x, PLACES.knife_spawn.z, 3);
                if (w) return w;
                for (let i = 0; i < 10 && !c.sdk.getInventory().some(x => /^knife$/i.test(x.name)); i++) {
                    const knife = c.sdk.getState()?.groundItems.find(g => /^knife$/i.test(g.name));
                    if (knife) await c.bot.pickupItem(knife).catch(() => {});
                    else await c.sdk.waitForTicks(5); // waiting for the respawn
                }
                if (!c.sdk.getInventory().some(i => /^knife$/i.test(i.name))) return 'could not get a knife';
            }
            const product = /bow/i.test(a.target ?? '') ? 'shortbow' : 'arrow shaft';
            return repeat(c, () => count(c, /^logs$/i) > 0, () => c.bot.fletchLogs(product), `could not fletch a ${product}`);
        }
    },
    craft: {
        description: "Crafting: cut uncut gems with a chisel (\"cut gems\", or \"cut sapphire\"), or make gold jewellery at a furnace from a gold bar and a mould, set with a cut gem if you carry one (\"gold ring\", \"sapphire ring\", \"ruby amulet\", \"emerald necklace\"). A chisel is sold at the Lumbridge general store and Dommik's Crafting Store in Al Kharid; the ring, necklace and amulet moulds only at Dommik's (buy them). Some gems crush instead of cutting, for less xp. Levels: cutting opal 1, jade 13, red topaz 16, sapphire 20, emerald 27, ruby 34, diamond 43; gold ring 5, necklace 6, amulet 8; sapphire 20/22/24; emerald 27/29/31; ruby 34/40/50; diamond 43/54/70 (ring/necklace/amulet).",
        target: 'cut gems | cut sapphire | gold ring | sapphire amulet | ruby necklace ...',
        activity: 'crafting',
        requires: (s, a) => {
            const crafting = level(s, 'Crafting');
            const have = (re: RegExp) => s.inventory.some(i => re.test(i.name));
            const t = (a.target ?? '').toLowerCase();
            if (/\bcut\b|\bgems?\b/.test(t) || !t.trim()) {
                if (!have(/^chisel$/i)) return "needs a chisel (the Lumbridge general store sells one for 1 coin: buy chisel)";
                const gems = s.inventory.map(i => /^uncut (.+)$/i.exec(i.name)?.[1]?.toLowerCase()).filter((g): g is string => !!g && (!/\bcut\b/.test(t) || t.includes(g) || /gems?$/.test(t)));
                if (!gems.length) return 'no uncut gems in your pack (the banks hold some: withdraw them first)';
                const best = Math.max(...gems.map(g => CUT_LEVELS[g] ?? 99));
                const low = Math.min(...gems.map(g => CUT_LEVELS[g] ?? 99));
                return low <= crafting ? null : `cutting ${gems[0]} needs Crafting ${low} (you are ${crafting}${best > low ? '' : ''})`;
            }
            const { product, gem } = jewelleryOf(t);
            const need = JEWELLERY_LEVELS[product][gem];
            if (crafting < need) return `a ${gem === 'gold' ? 'gold' : gem} ${product} needs Crafting ${need} (you are ${crafting})`;
            if (!have(new RegExp(`^${product} mould$`, 'i'))) return `needs a ${product} mould (Dommik's Crafting Store in Al Kharid sells them: buy ${product} mould)`;
            if (!have(/^gold bar$/i)) return 'needs a gold bar (smelt gold ore at a furnace, or withdraw one from the bank)';
            if (gem !== 'gold' && !have(new RegExp(`^${gem}$`, 'i'))) return `needs a cut ${gem} (cut an uncut one with a chisel first)`;
            return null;
        },
        async run(c, a) {
            const t = (a.target ?? '').toLowerCase();
            if (/\bcut\b|\bgems?\b/.test(t) || !t.trim()) {
                const cuttable = () => {
                    const crafting = level(c.sdk.getState()!, 'Crafting');
                    return c.sdk.getInventory().find(i => {
                        const g = /^uncut (.+)$/i.exec(i.name)?.[1]?.toLowerCase();
                        return !!g && (CUT_LEVELS[g] ?? 99) <= crafting && (!/\bcut\b/.test(t) || t.includes(g) || /gems?$/.test(t));
                    });
                };
                return repeat(
                    c,
                    () => !!cuttable() && c.sdk.getInventory().some(i => /^chisel$/i.test(i.name)),
                    async () => {
                        const chisel = c.sdk.getInventory().find(i => /^chisel$/i.test(i.name));
                        const gem = cuttable();
                        if (chisel && gem) await c.sdk.sendUseItemOnItem(chisel.slot, gem.slot);
                    },
                    'the chisel would not cut it'
                );
            }
            const { product, gem } = jewelleryOf(t);
            return atStation(
                c,
                'furnace',
                /^gold bar$/i,
                () =>
                    repeat(
                        c,
                        () => count(c, /^gold bar$/i) > 0 && count(c, new RegExp(`^${product} mould$`, 'i')) > 0 && (gem === 'gold' || count(c, new RegExp(`^${gem}$`, 'i')) > 0),
                        async () => {
                            await c.bot.craftJewelry({ product, gem });
                        },
                        `could not craft a ${gem} ${product}`
                    ),
                // A level, mould or gem problem would fail at any furnace: never mark one unusable for it.
                () => false
            );
        }
    },
    smelt: {
        description: 'Smelt ore into bars at the nearest furnace: copper + tin make bronze (Smithing 1); iron ore alone makes iron (15; ordinary 50% impurity losses consume ore without a bar or XP); silver (20); 1 iron ore + 2 coal make steel (30, no iron-bar impurity roll); gold (40); 1 mithril ore + 4 coal make mithril (50); 1 adamantite ore + 6 coal make adamant (70); 1 runite ore + 8 coal make rune (85). Bars are not smelted again: steel is made directly from iron ore, not iron bars.',
        target: 'bronze | iron | silver | steel | gold | mithril | adamant | rune',
        activity: 'crafting',
        requires: (s, a) => {
            const [main, partner, level] = ORE_PAIRS[metalOf(a.target)];
            const smithing = s.skills.find(k => k.name === 'Smithing')?.baseLevel ?? 1;
            if (smithing < level) return `needs Smithing ${level}`;
            if (!a.target) return s.inventory.some(i => /ore$/i.test(i.name)) ? null : 'no ore to smelt';
            const name = (r: RegExp) => r.source.replace(/[\^$\\]/g, '');
            // Who has a missing ore banked, so it can be withdrawn, or asked for and given.
            const banked = (re: RegExp) => {
                const held = ['bram', 'wren', 'mike', 'trish']
                    .map(n => [n, Object.entries(bankOf(n)?.items ?? {}).filter(([k]) => re.test(k)).reduce((t, [, v]) => t + v, 0)] as const)
                    .filter(([, v]) => v > 0)
                    .map(([n, v]) => `${n}'s bank ${v.toLocaleString('en-US')}`);
                return held.length ? ` (${name(re)} banked: ${held.join(', ')}; only the owner can withdraw it, then give it)` : '';
            };
            if (!s.inventory.some(i => main.test(i.name))) return `no ${name(main)} in your pack${banked(main)}`;
            // A bar takes 2 coal for steel, 4 for mithril, 6 for adamant, 8 for rune: fewer smelts nothing.
            const metal = metalOf(a.target);
            const held = (re: RegExp) => s.inventory.filter(i => re.test(i.name)).reduce((t, i) => t + i.count, 0);
            if (metal === 'steel' && held(main) < 2) return `steel takes 2 coal per bar and your pack holds ${held(main)}${banked(main)}`;
            if (!partner || held(partner) >= partnerNeed(metal)) return null;
            // The step fetches the other ore from your own bank when it holds some.
            const own = Object.entries(bankOf(s.player?.name?.toLowerCase() ?? '')?.items ?? {}).some(([k, v]) => partner.test(k) && v > 0);
            if (own) return null;
            if (partnerNeed(metal) > 1 && held(partner)) return `${metal} takes ${partnerNeed(metal)} coal per bar and your pack holds ${held(partner)}${banked(partner)}`;
            return `${metal} needs ${name(partner)} as well as ${name(main)}${banked(partner)}`;
        },
        async run(c, a) {
            const metal = metalOf(a.target);
            const [main, partner] = ORE_PAIRS[metal];
            // Carrying the main ore but not its partner: fetch the partner from your own bank, in
            // the recipe's ratio (mithril 4 coal per ore, adamant 6, rune 8, steel 1 iron ore per 2 coal, bronze 1:1).
            if (partner && count(c, partner) < partnerNeed(metal) && (bankOf(c.name)?.items && Object.entries(bankOf(c.name)!.items).some(([k, v]) => partner.test(k) && v > 0))) {
                const mains = count(c, main);
                const need = partnerNeed(metal) > 1 ? mains * partnerNeed(metal) - count(c, partner) : metal === 'steel' ? Math.floor(mains / 2) : mains;
                const free = 28 - c.sdk.getInventory().length;
                const bank = nearestBank(c);
                const w = await goNear(c, bank.x, bank.z, 4);
                if (w) return w;
                if ((await c.bot.openBank()).success) {
                    await c.bot.withdrawItem(partner, Math.max(1, Math.min(need, free)));
                    await c.sdk.waitForTicks(1);
                    noteBank(c.name, c.sdk);
                    await c.bot.closeBank();
                }
                if (count(c, partner) === 0) return `${metal} needs ${partner.source.replace(/[\^$\\]/g, '')} as well, and none could be withdrawn`;
                c.notes?.push(`fetched ${count(c, partner)} ${partner.source.replace(/[\^$\\]/g, '')} from your bank for the smelt`);
            }
            return atStation(c, 'furnace', main, () => repeat(
                c,
                // Steel takes 2 coal per iron ore, mithril 4, adamant 6, rune 8: a last odd coal is not a failure.
                () => count(c, main) >= (metalOf(a.target) === 'steel' ? 2 : 1) && (!partner || count(c, partner) >= partnerNeed(metalOf(a.target))),
                async () => {
                    // A decoy furnace with no options sits next to the real one: insist on Smelt.
                    const furnace = c.sdk.findNearbyLoc(/furnace/i, { withOption: /smelt/i });
                    const ore = c.sdk.getInventory().find(i => main.test(i.name));
                    if (furnace && ore) await c.bot.useItemOnLoc(ore, furnace, { timeout: 15_000 });
                },
                'the furnace would not smelt it (if the ore is bank notes, it cannot be smelted: bank it, then withdraw it without "noted")'
            ), () => {
                // Only the furnace's fault when a full set of usable (unnoted) ore was there:
                // short of coal, or with notes, every furnace would refuse the same.
                const one = (re: RegExp) => c.sdk.getInventory().filter(i => re.test(i.name) && i.count === 1).length;
                const metal = metalOf(a.target);
                return one(main) >= (metal === 'steel' ? 2 : 1) && (!partner || one(partner) >= partnerNeed(metal));
            });
        }
    },
    smith: {
        description: 'Smith bars into items at the Varrock west anvils (needs a hammer). Daggers sell for more than the ore did.',
        target:
            'metal and item, e.g. bronze dagger. Bronze levels (bars): dagger 1 (1), axe 1 (1), mace 2 (1), med helm 3 (1), sword 4 (1), scimitar 5 (2), longsword 6 (2), full helm 7 (2), sq shield 8 (2), warhammer 9 (3), battleaxe 10 (3), chainbody 11 (3), kiteshield 12 (3), 2h sword 14 (3), platelegs 16 (3), platebody 18 (5). Iron is the same +15 levels, steel +30, mithril +50, adamant +70, rune +85.',
        activity: 'crafting',
        requires: (s, a) => {
            const req = workRequirements(s, 'smith', a);
            return req.blocker ?? req.items.map(n => heldNeed(s, n) < n.count ? `needs ${n.count} ${n.name}` : null).find(Boolean) ?? null;
        },
        async run(c, a) {
            // The whole name ("bronze dagger"), so the metal picks which bars are used.
            const product = (a.target ?? 'dagger').toLowerCase().split('|')[0].trim() || 'dagger';
            let why = '';
            let reason = '';
            // Only an anvil that cannot be reached or used is the anvil's fault; a recipe, level
            // or bar problem would fail the same at every anvil.
            return atStation(
                c,
                'anvil',
                /bar$/i,
                () =>
                    repeat(
                        c,
                        () => count(c, /bar$/i) > 0,
                        async () => {
                            const r = await c.bot.smithAtAnvil(product, { timeout: 15_000 });
                            if (!r.success) [why, reason] = [r.message, String(r.reason ?? '')];
                        },
                        `could not smith a ${product}`
                    ).then(r => (r && why ? `${r}: ${why}` : r)),
                () => !reason || /no_anvil|cant_reach/.test(reason)
            );
        }
    },
    bank_resources: {
        description: 'Walk to the nearest bank (or a named one) and deposit logs, ore, coal, clay, uncut gems, raw and cooked fish, bars, bones and hides into your own bank. When used in a smithing routine, also deposits that routine’s named smithing outputs. It keeps the first 5 cooked fish in your pack as food, and takes that many out of your bank when you carry none. Name an item instead to deposit just that, e.g. spare tools or gems.',
        target: 'optional: a bank name from the atlas, or an item name to deposit',
        activity: 'errands',
        oneShot: true,
        requires: (s, a) => {
            const only = bankTarget(a.target).item;
            if (depositPlan(s.inventory, bankedName(only, a.bankOutputs), !only).length) return null;
            const buried = only && /bone/i.test(only) ? ' (fight buries the bones it gets as it goes, so none are kept)' : '';
            return `${only ? `no ${only} to bank${buried}` : 'nothing to bank: with no item named it only deposits logs, ore, coal, clay, uncut gems, raw and cooked fish, bars, bones and hides'}. Your pack holds: ${packText(s)}`;
        },
        async run(c, a) {
            const { bank: named, near, item: only } = bankTarget(a.target);
            const home = await sailToPortSarim(c);
            if (home) return home;
            // A town without a bank of its own means its nearest bank you can reach without the
            // toll (Lumbridge's nearest is Al Kharid's, behind the gate).
            const bank = near
                ? avoidToll(c, [...BANKS].sort((x, y) => Math.hypot(x.x - near.x, x.z - near.z) - Math.hypot(y.x - near.x, y.z - near.z)))
                : (named ?? nearestBank(c));
            const w = await goNear(c, bank.x, bank.z, 4);
            if (w) return w;
            const open = await c.bot.openBank();
            if (!open.success) return `could not open the bank: ${open.message}`;
            for (const item of depositPlan(c.sdk.getInventory(), bankedName(only, a.bankOutputs), !only)) {
                if (c.signal.aborted) break;
                await c.bot.depositItem(new RegExp(`^${esc(item.name)}$`, 'i'), item.amount);
            }
            // Travel and production should not start with nothing to eat: carry a few cooked fish.
            const food = only || c.signal.aborted ? null : reserveWithdrawal(c.sdk.getInventory(), c.sdk.getBankItems(), 28 - c.sdk.getInventory().length);
            if (food) {
                const r = await c.bot.withdrawItem(new RegExp(`^${esc(food.name)}$`, 'i'), food.amount);
                if (!r.success && !(r as any).amountWithdrawn) c.notes?.push(`could not take ${food.amount} ${food.name} as a food reserve: ${r.message}`);
            }
            await c.sdk.waitForTicks(1);
            noteBank(c.name, c.sdk);
            await c.bot.closeBank();
        }
    },
    sell_to_shop: {
        description: 'Sell for coins. Without a target it sells logs, ore, raw fish and bars at the Lumbridge general store, which pays little, less for things it already holds, and skips anything it would pay 0 for. Name a target to sell crafted goods (e.g. bronze dagger, shortbow): they go to the specialty shop that stocks them if one does, which pays far better. Never sells tools.',
        target: 'optional item name, e.g. bronze dagger, shortbow',
        activity: 'errands',
        oneShot: true,
        requires: (s, a) => (s.inventory.some(i => sellable(i.name, a.target)) ? null : a.target ? `no ${a.target} to sell` : 'nothing worth selling'),
        async run(c, a) {
            const buyer = a.target?.trim() ? bestBuyer(a.target) : null;
            const shopAt = buyer?.shop ?? SHOPS[0];
            const blocked = await openShopAt(c, shopAt);
            if (blocked) return blocked;
            const coins0 = c.sdk.countInventoryItems(/^coins$/i);
            const soldItems: string[] = [];
            const refused: string[] = [];
            const sold: string[] = [];
            for (const item of c.sdk.getInventory().filter(i => sellable(i.name, a.target))) {
                if (c.signal.aborted) break;
                if (refused.some(r => r.startsWith(item.name)) || sold.some(r => r.startsWith(item.name))) continue;
                const shop = c.sdk.getState()?.shop;
                const offer = shop?.playerItems.find(p => p.name === item.name);
                const stock = shop?.shopItems.find(p => p.name === item.name)?.count ?? 0;
                if (offer && offer.sellPrice <= 0) {
                    refused.push(`${item.name} (pays 0 right now; the shop already holds ${stock})`);
                    continue;
                }
                const before = c.sdk.countInventoryItems(item.name);
                await c.bot.sellToShop(item, 'all');
                const left = c.sdk.countInventoryItems(item.name);
                // A dispatched sell is not a completed one: check the items actually left.
                if (left >= before) refused.push(`${item.name} (not accepted; the shop holds ${stock})`);
                else {
                    sold.push(`${item.name} x${before - left} at ~${offer?.sellPrice ?? '?'}gp`);
                    soldItems.push(`${before - left} ${item.name}`);
                }
            }
            const earned = c.sdk.countInventoryItems(/^coins$/i) - coins0;
            if (earned > 0) recordSale({ by: c.name, shop: shopAt.name, items: soldItems.join(', '), coins: earned });
            await c.bot.closeShop();
            if (refused.length) return `${sold.length ? `sold ${sold.join(', ')}; ` : ''}the shop would not buy: ${refused.join(', ')}`;
        }
    },
    buy_tools: {
        description: "Buy one tool, for yourself or to give a teammate: bronze axe or pickaxe at Bob's Brilliant Axes, tinderbox or hammer (for smithing) at the general store. Costs coins. No shop nearby sells fishing nets.",
        target: 'axe | pickaxe | tinderbox | hammer',
        activity: 'errands',
        oneShot: true,
        requires: s => {
            const coins = s.inventory.filter(i => /^coins$/i.test(i.name)).reduce((n, i) => n + i.count, 0);
            return coins ? null : 'no coins (sell loot or resources first)';
        },
        async run(c, a) {
            const st = c.sdk.getState()!;
            const asked = (a.target ?? '').toLowerCase();
            // An explicit target is bought even if you already own one (it may be for a teammate).
            const pick = ['axe', 'pickaxe', 'tinderbox', 'hammer'].find(n => n === asked) ?? TOOLS.filter(([n, re]) => n !== 'small fishing net' && !carried(st, re)).map(([n]) => n)[0];
            if (!pick) return 'name which tool to buy (axe, pickaxe, tinderbox or hammer)';
            const name = pick === 'axe' || pick === 'pickaxe' ? `bronze ${pick}` : pick;
            const opened = await openSeller(c, name);
            if (typeof opened === 'string') return opened;
            const item = new RegExp(`^${name}$`, 'i');
            const r = await c.bot.buyFromShop(item, 1);
            await c.bot.closeShop();
            if (!r.success) return `could not buy a ${pick}: ${r.message}`;
        }
    },
    buy: {
        description: 'Buy gear or supplies at the shop that sells them (see the shops in the atlas), e.g. iron sword, bronze chainbody, shortbow, bronze arrow. Costs coins. To buy several, stop the step at "gathered" with a count.',
        target: 'item name, e.g. iron sword',
        activity: 'errands',
        oneShot: true,
        requires: (s, a) => {
            if (!a.target?.trim()) return null; // checked again when run; listing needs no target
            const found = shopSelling(a.target);
            if (!found) return `no shop in reach sells ${a.target}`;
            const coins = s.inventory.filter(i => /^coins$/i.test(i.name)).reduce((n, i) => n + i.count, 0);
            const cost = found.item.price * Math.max(1, a.amount ?? 1);
            return coins >= cost ? null : `${found.item.name} costs about ${cost} coins and you carry ${coins}`;
        },
        async run(c, a) {
            const found = shopSelling(a.target ?? '');
            if (!found) return 'say what to buy';
            const opened = await openSeller(c, found.item.name);
            if (typeof opened === 'string') return opened;
            const coins = c.sdk.getInventory().filter(i => /^coins$/i.test(i.name)).reduce((v, i) => v + i.count, 0);
            if (coins < opened.item.price * Math.max(1, a.amount ?? 1)) {
                await c.bot.closeShop();
                return `${opened.item.name} costs more at the alternate shop than your carried coins allow`;
            }
            const r = await c.bot.buyFromShop(new RegExp(`^${found.item.name}$`, 'i'), Math.max(1, a.amount ?? 1));
            await c.bot.closeShop();
            if (!r.success && !(r as any).amountBought) return `could not buy ${found.item.name}: ${r.message}`;
        }
    },
    equip: {
        description: `Wield a weapon or wear armour you carry, which makes you hit harder or get hit less. Needs Attack (weapons) or Defence (armour) at the item's metal level: ${GEAR_LEVELS}. What you take off goes into your pack.`,
        target: 'item name you carry, e.g. iron sword',
        activity: 'errands',
        oneShot: true,
        requires: (s, a) => {
            if (!a.target?.trim()) return null;
            const t = a.target.trim().toLowerCase();
            if (s.equipment.some(i => i.name.toLowerCase() === t)) return null;
            const item = s.inventory.find(i => i.name.toLowerCase() === t) ?? s.inventory.find(i => i.name.toLowerCase().includes(t));
            return item ? equipmentBlocker(s, item.name) : `you carry no ${a.target}`;
        },
        async run(c, a) {
            const t = (a.target ?? '').trim().toLowerCase();
            if (c.sdk.getEquipment().some(i => i.name.toLowerCase() === t)) {
                c.notes?.push(`already wearing ${a.target}; step satisfied`);
                return;
            }
            const item = c.sdk.getInventory().find(i => i.name.toLowerCase() === t) ?? c.sdk.getInventory().find(i => i.name.toLowerCase().includes(t));
            if (!item) return `you carry no ${a.target}`;
            // Swapping for an identical item changes nothing, and the SDK reports it as a failure.
            if (c.sdk.getEquipment().some(e => e.id === item.id)) return;
            const requirement = equipmentBlocker(c.sdk.getState()!, item.name);
            if (requirement) return requirement;
            const r = await c.bot.equipItem(item);
            if (!r.success) return `could not equip ${item.name}: ${r.message} (it may need a higher Attack or Defence level: ${GEAR_LEVELS})`;
        }
    },
    bury_bones: {
        description: 'Bury the bones you are carrying, for Prayer XP.',
        activity: 'combat',
        oneShot: true,
        requires: s => (s.inventory.some(i => LOOT.test(i.name)) ? null : 'no bones to bury'),
        async run(c) {
            await buryAll(c);
        }
    },
    withdraw_from_bank: {
        description: 'Take banked items back out, as many as your free slots hold, to use them (e.g. ore to smelt, raw fish to cook). Add "noted" to the target to take the whole stack as bank notes in one slot instead: notes can be sold or given, but not used; depositing notes turns them back into ordinary items in the bank of whoever deposits them, so a whole stack can move to a teammate in one hand-over. To take only some, stop the step at "gathered" with a count, e.g. 14 tin ore and then 14 copper ore to smelt 14 bronze bars.',
        target: 'item name, e.g. copper ore, or "logs noted" to sell them',
        activity: 'errands',
        oneShot: true,
        requires: (s, a) => {
            if (!a.target?.trim()) return null; // checked again when run; listing needs no target
            return s.inventory.length >= 28 ? `no free inventory slot (bank spare tools or other items to make room). Your pack holds: ${packText(s)}` : null;
        },
        async run(c, a) {
            const noted = /\bnoted?\b/i.test(a.target ?? '');
            // Cooked fish is banked under its plain name ("Shrimps"), with no "cooked" in it.
            const item = (a.target ?? '').replace(/\bnoted?\b/i, '').replace(/^\s*cooked\s+/i, '').trim();
            if (!item) return 'say which item to withdraw';
            const home = await sailToPortSarim(c);
            if (home) return home;
            const bank = nearestBank(c);
            const w = await goNear(c, bank.x, bank.z, 4);
            if (w) return w;
            const open = await c.bot.openBank();
            if (!open.success) return `could not open the bank: ${open.message}`;
            const free = 28 - c.sdk.getInventory().length;
            const want = a.amount && a.amount > 0 ? a.amount : -1;
            const cooked = /^\s*cooked\s+/i.test((a.target ?? '').replace(/\bnoted?\b/i, ''));
            const esc = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/s$/i, '');
            // "cooked shrimps" must not match "Raw shrimps": cooked fish is the whole name.
            const pattern = new RegExp(cooked ? `^${esc}s?$` : esc, 'i');
            const inBankItem = c.sdk.getBankItems().find(i => pattern.test(i.name));
            const amount = withdrawAmount({ want, free, stackable: !!inBankItem && isStackable(inBankItem.name), inBank: inBankItem?.count ?? 0, noted });
            const r = await c.bot.withdrawItem(pattern, amount, { asNote: noted });
            if (want > 0 && (r.amountWithdrawn ?? 0) < want)
                c.notes?.push(`partial withdrawal: requested ${want} ${item}, received ${r.amountWithdrawn ?? 0}; ${want - (r.amountWithdrawn ?? 0)} not withdrawn (bank stock or inventory capacity)`);
            await c.sdk.waitForTicks(1);
            noteBank(c.name, c.sdk);
            // Say what the bank does hold, or the agent guesses at names.
            const held = c.sdk.getBankItems().map(i => `${i.name} ${i.count}`).join(', ');
            await c.bot.closeBank();
            if (!r.success && !(r as any).amountWithdrawn) {
                // Banks are separate: say whose bank does hold it, so a give can be asked for.
                const re = new RegExp(cooked ? `^${esc}s?$` : esc, 'i');
                const others = ['bram', 'wren', 'mike', 'trish']
                    .filter(n => n !== c.name)
                    .map(n => [n, Object.entries(bankOf(n)?.items ?? {}).filter(([k]) => re.test(k)).reduce((t, [, v]) => t + v, 0)] as const)
                    .filter(([, v]) => v > 0)
                    .map(([n, v]) => `${n}'s bank ${v.toLocaleString('en-US')}`);
                return `nothing withdrawn: no ${item} in your own bank. It holds: ${held || 'nothing'}${others.length ? `. Teammates' banks with ${item}: ${others.join(', ')} (only they can withdraw it, then give it to you)` : ''}`;
            }
        }
    },
    travel: {
        description: 'Travel to a place no other action takes you to, e.g. to explore. Mainland destinations automatically take the return ferry from Karamja (30 carried coins). Every other action already walks to where it works, banks, buys or sells. The walk is added to the travel log.',
        target: 'a place name from the atlas, or "x, z"',
        activity: 'errands',
        oneShot: true,
        requires: (s, a) => {
            if (!a.target?.trim()) return null;
            const place = findPlace(a.target);
            if (!place) return `no place called ${a.target} in the atlas${similarPlaces(a.target).length ? ` (closest names: ${similarPlaces(a.target).join(', ')})` : ''}`;
            return null;
        },
        async run(c, a) {
            const place = findPlace(a.target);
            if (!place) return 'say where to go';
            // A mainland destination needs the real ferry, not a path through the sea.
            const destinationPath = findLongPath(0, KARAMJA_FISHING_SPOT.x, KARAMJA_FISHING_SPOT.z, place.x, place.z, 2000).at(-1);
            if (!destinationPath || tiles(destinationPath, place) > 8) {
                const home = await sailToPortSarim(c);
                if (home) return home;
            }
            // Already there counts as arrived, so the routine's next steps still run.
            if (dist(c, place.x, place.z) <= 15) return;
            // Setting off hurt and under attack is how walks end in death: eat or flee first.
            const d = await danger(c);
            if (d) return d;
            return goNear(c, place.x, place.z, 4);
        }
    },
    rest: {
        description: 'Stand still for a few minutes (HP regenerates). Only when hurt, or when a teammate is on the way to you. Resting does not help the party otherwise. At full health with no teammate\'s routine bringing you anything, a rest lasts 10 minutes.',
        activity: 'rest',
        async run(c) {
            while (going(c)) {
                // Resting next to something that hunts players is how characters die standing still.
                if (c.sdk.getState()?.player?.combat.inCombat) await flee(c);
                await c.sdk.waitForTicks(5);
            }
        }
    }
};

/** Which actions the character can take right now, and why the others are out. */
export function availability(s: BotWorldState): { available: string[]; blocked: Record<string, string> } {
    const available: string[] = [];
    const blocked: Record<string, string> = {};
    for (const [name, def] of Object.entries(SKILLS)) {
        const why = def.requires?.(s, { target: null }) ?? null;
        if (why) blocked[name] = why;
        else available.push(name);
    }
    return { available, blocked };
}

/** Minimum usable inputs for one unit of work, shared by preflight and preparation. */
export interface ItemNeed {
    name: string;
    match: RegExp;
    count: number;
    tool?: string;
    stackable?: boolean;
}
export function heldNeed(s: BotWorldState, n: ItemNeed): number {
    return [...s.inventory, ...(n.tool ? s.equipment : [])]
        .filter(i => n.match.test(i.name) && (i.count === 1 || n.stackable) && (!n.tool || usableTool(s, i.name, n.tool)))
        .reduce((v, i) => v + i.count, 0);
}
export function workRequirements(s: BotWorldState, action: string, a: Args): { items: ItemNeed[]; blocker: string | null } {
    const items: ItemNeed[] = [];
    let blocker: string | null = null;
    const add = (name: string, match: RegExp, count = 1, tool?: string, stackable?: boolean) => items.push({ name, match, count, tool, stackable });
    const check = (skill: string, need: number) => {
        if (level(s, skill) < need) blocker = `needs ${skill} ${need} (you are ${level(s, skill)})`;
    };
    if (action === 'mine') {
        const type = rockType(a.target);
        blocker = a.target && !type ? `no ${a.target} rocks known` : levelFor(s, type ?? 'copper');
        add('bronze pickaxe', /pickaxe$/i, 1, 'Mining');
    } else if (action === 'chop_trees') {
        blocker = levelFor(s, treeType(a.target));
        add('bronze axe', /(?<!pick)axe$/i, 1, 'Woodcutting');
    } else if (action === 'fish') {
        const m = FISHING[fishMethod(a.target)];
        check('Fishing', m.level);
        for (const [name, match] of m.tools) add(name, match, /bait|feather/.test(name) ? 30 : 1, /bait|feather/.test(name) ? undefined : 'Fishing', /bait|feather/.test(name));
    } else if (action === 'firemake') {
        add('tinderbox', /^tinderbox$/i, 1, 'Firemaking'); add('logs', /^logs$/i);
    } else if (action === 'fletch') {
        // Server cut_logs.dbrow: normal shortbows unlock at 5; shafts at 1.
        check('Fletching', /bow/i.test(a.target ?? '') ? 5 : 1);
        add('logs', /^logs$/i);
    } else if (action === 'cook') {
        const names = ['shrimps', 'anchovies', 'sardine', 'herring', 'trout', 'pike', 'salmon', 'tuna', 'lobster', 'swordfish'].map(n => `raw ${n}`).filter(n => cookingLevel(n) <= level(s, 'Cooking'));
        const requested = rawFoodTarget(a.target);
        if (requested === undefined) blocker = `unknown raw fish ${a.target}`;
        else if (requested) {
            const name = `raw ${cleanLookupText(a.target!).toLowerCase().replace(/^raw /, '').trim()}`;
            check('Cooking', cookingLevel(name));
            add(name, requested);
        } else add('raw fish you can cook', new RegExp(`^(${names.join('|')})$`, 'i'));
    } else if (action === 'smelt') {
        const metal = metalOf(a.target);
        const [main, partner, need] = ORE_PAIRS[metal];
        check('Smithing', need);
        const label = (re: RegExp) => re.source.replace(/[\^$\\]/g, '');
        add(label(main), main, metal === 'steel' ? 2 : 1);
        if (partner) add(label(partner), partner, partnerNeed(metal));
    } else if (action === 'smith') {
        const t = cleanLookupText(a.target ?? 'bronze dagger').toLowerCase();
        const recipe = smithRecipe(t);
        if (!recipe) blocker = `unknown smithing recipe ${t}; name the metal and item`;
        else { check('Smithing', recipe.level); add(recipe.bar, new RegExp(`^${recipe.bar}$`, 'i'), recipe.count); }
        add('hammer', /^hammer$/i, 1, 'Smithing');
    } else if (action === 'firemake') {
        add('tinderbox', /^tinderbox$/i);
        add('logs', /^logs$/i);
    } else if (action === 'fletch') {
        add('logs', /^logs$/i);
    } else if (action === 'craft') {
        const t = (a.target ?? '').toLowerCase();
        if (/\bcut\b|\bgems?\b/.test(t) || !t.trim()) {
            add('chisel', /^chisel$/i, 1, 'Crafting');
            const gem = Object.keys(CUT_LEVELS).find(g => t.includes(g));
            if (gem) { check('Crafting', CUT_LEVELS[gem]); add(`uncut ${gem}`, new RegExp(`^uncut ${gem}$`, 'i')); }
            else add('uncut gems you can cut', new RegExp(`^uncut (${Object.keys(CUT_LEVELS).filter(g => CUT_LEVELS[g] <= level(s, 'Crafting')).join('|')})$`, 'i'));
        } else {
            const { product, gem } = jewelleryOf(t);
            check('Crafting', JEWELLERY_LEVELS[product][gem]);
            add(`${product} mould`, new RegExp(`^${product} mould$`, 'i'), 1, 'Crafting'); add('gold bar', /^gold bar$/i);
            if (gem !== 'gold') add(gem, new RegExp(`^${gem}$`, 'i'));
        }
    } else if (action === 'cast') {
        const { spell } = castOf(a.target);
        if (spell) {
            check('Magic', spell.level);
            for (const [rune, count] of spell.runes) {
                if (['air', 'water', 'earth', 'fire'].includes(rune) && s.equipment.some(i => new RegExp(`staff of ${rune}|${rune} battlestaff`, 'i').test(i.name))) continue;
                add(`${rune} rune`, new RegExp(`^${rune} rune$`, 'i'), count, undefined, true);
            }
        }
    }
    return { items, blocker };
}

export function bankDepositNeeded(s: BotWorldState, a: Args): boolean {
    const only = bankTarget(a.target).item;
    return depositPlan(s.inventory, bankedName(only, a.bankOutputs), !only).length > 0;
}
/** Which items a bank deposit covers: the one named, else everything bankable. */
const bankedName = (only?: string, outputs: string[] = []) => (name: string) => (only ? namedItem(name, only) : BANKABLE.test(name) || outputs.some(output => cleanLookupText(name).toLowerCase() === cleanLookupText(output).toLowerCase()));
