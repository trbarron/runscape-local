// The party's achievements: firsts and marks read straight from the game (what is carried,
// worn or banked, skill levels, fights won), never from anyone's say-so. A progress measure
// for us, and facts for the party: nothing here is a goal they are set.
import type { BotWorldState } from '../rs-sdk/sdk/types';
import { load, save } from './store';
import { emit } from './events';
import { SPOTS } from './world-index/index';

export interface Achievement {
    id: string;
    name: string;
    by: string;
    t: number;
}

const PARTY = new Set(['bram', 'wren', 'mike', 'trish']);
const ledger = load<Record<string, Achievement>>('achievements', {});

const METALS = ['bronze', 'iron', 'steel', 'mithril', 'adamant', 'rune'];
const ORES = ['copper ore', 'tin ore', 'iron ore', 'silver ore', 'coal', 'gold ore', 'mithril ore', 'adamantite ore', 'runite ore'];
const BARS = ['bronze bar', 'iron bar', 'silver bar', 'steel bar', 'gold bar', 'mithril bar', 'adamantite bar', 'runite bar'];
const FISH = ['shrimps', 'anchovies', 'sardine', 'herring', 'trout', 'pike', 'salmon', 'tuna', 'lobster', 'swordfish'];
const one = (f: string) => ({ shrimps: 'shrimp', anchovies: 'anchovy' })[f] ?? f;
const LOGS = ['logs', 'oak logs', 'willow logs', 'maple logs', 'yew logs'];
const SKILL_MARKS = [20, 30, 40, 50, 60, 70, 80, 90, 99];
const COMBAT_MARKS = [10, 20, 30, 40, 50, 60];
const TOTAL_MARKS = [250, 500, 750, 1000, 1250, 1500];
const WORN_SLOTS = ['head', 'body', 'legs', 'shield', 'weapon'];

function unlock(id: string, name: string, by: string): void {
    if (ledger[id] || !PARTY.has(by)) return;
    ledger[id] = { id, name, by, t: Date.now() };
    save('achievements', ledger);
    emit(by, 'achievement', { id, summary: `achievement: ${name}` });
}

/** Checks one character's live state and last-seen bank. Cheap; call it every few seconds. */
export function checkState(name: string, s: BotWorldState | null | undefined, bank: Record<string, number> = {}): void {
    if (!s?.inGame || !PARTY.has(name)) return;
    const held = new Set([...s.inventory, ...s.equipment].map(i => i.name.toLowerCase()));
    for (const k of Object.keys(bank)) held.add(k.toLowerCase());
    const has = (n: string) => held.has(n) || held.has(`raw ${n}`);
    for (const o of ORES) if (has(o)) unlock(`item:${o}`, `first ${o}`, name);
    for (const b of BARS) if (has(b)) unlock(`item:${b}`, `first ${b}`, name);
    for (const f of FISH) if (held.has(`raw ${f}`) || held.has(f)) unlock(`fish:${f}`, `first ${one(f)} caught`, name);
    for (const f of FISH) if (held.has(f)) unlock(`cooked:${f}`, `first cooked ${one(f)}`, name);
    for (const l of LOGS) if (held.has(l)) unlock(`item:${l}`, `first ${l}`, name);
    for (const m of METALS) {
        const gear = [...held].find(n => n.startsWith(`${m} `) && !/ bar$| ore$/.test(n));
        if (gear) unlock(`gear:${m}`, `first ${m} item (${gear})`, name);
    }
    for (const e of s.equipment) {
        const m = METALS.find(x => e.name.toLowerCase().startsWith(`${x} `));
        if (m) unlock(`worn:${m}`, `first ${m} item worn (${e.name})`, name);
    }
    // A full set: something metal or leather in each armour slot plus a weapon.
    const worn = s.equipment.map(e => e.name.toLowerCase());
    const slot = (re: RegExp) => worn.some(n => re.test(n));
    const full = [/helm|hat|coif/, /body|chainbody|platebody|top/, /legs|skirt|chaps/, /shield/, /sword|dagger|axe|mace|scimitar|longsword|bow|staff/].every(slot);
    if (full) unlock(`set:${name}`, `${name} wears a full set (${WORN_SLOTS.join(', ')})`, name);

    for (const k of s.skills) {
        if (/^stat\d+$/i.test(k.name)) continue;
        for (const lvl of SKILL_MARKS) if (k.baseLevel >= lvl) unlock(`skill:${name}:${k.name}:${lvl}`, `${name} reached ${k.name} ${lvl}`, name);
    }
    const combat = s.player?.combatLevel ?? 0;
    for (const lvl of COMBAT_MARKS) if (combat >= lvl) unlock(`combat:${name}:${lvl}`, `${name} reached combat ${lvl}`, name);
    const total = s.skills.filter(k => !/^stat\d+$/i.test(k.name)).reduce((n, k) => n + k.baseLevel, 0);
    for (const lvl of TOTAL_MARKS) if (total >= lvl) unlock(`total:${name}:${lvl}`, `${name} reached total level ${lvl}`, name);
    // Quests: the game congratulates on completion; each distinct message is one quest done.
    for (const m of s.gameMessages ?? []) {
        if (/quest/i.test(m.text) && /complete|congratulations/i.test(m.text)) unlock(`quest:${m.text.toLowerCase().replace(/[^a-z' ]/g, '').trim()}`, `quest completed: ${m.text.trim()}`, name);
    }
    const coins = (bank.Coins ?? 0) + s.inventory.filter(i => /^coins$/i.test(i.name)).reduce((n, i) => n + i.count, 0);
    for (const c of [1_000, 10_000, 100_000]) if (coins >= c) unlock(`coins:${name}:${c}`, `${name} held ${c.toLocaleString()} coins`, name);
}

/** A fight step that earned combat XP counts as a fight won against that kind of monster. */
export function checkFight(name: string, monster: string | null, xp: Record<string, number>): void {
    if (!monster || !(xp.Hitpoints > 0)) return;
    const type = monster.toLowerCase();
    unlock(`kill:${type}`, `first ${type} defeated`, name);
    // Strength marks: the weakest level a monster of this name comes in (no claim beyond that).
    const level = Math.min(...SPOTS.filter(s => s.kind === 'monster' && s.type === type && s.level != null).map(s => s.level!));
    if (Number.isFinite(level)) {
        for (const mark of KILL_MARKS) if (level >= mark) unlock(`kill-level:${mark}`, `first monster of combat ${mark}+ defeated (${type}, ${level})`, name);
        if (!strongest || level > strongest.level) {
            strongest = { type, level, by: name };
            save('strongest', strongest);
        }
    }
}

const KILL_MARKS = [25, 50, 80];
let strongest = load<{ type: string; level: number; by: string } | null>('strongest', null as any);
if (strongest && !strongest.type) strongest = null;

/** Whether the party has unlocked this achievement id (e.g. "kill:goblin"). */
export const hasAchievement = (id: string) => !!ledger[id];
export const allAchievements = () => Object.values(ledger).sort((a, b) => a.t - b.t);

/** A few lines for the prompt: how many, and the latest. */
export function renderAchievements(n = 6): string {
    const all = allAchievements();
    if (!all.length) return '(none yet)';
    const latest = all.slice(-n).reverse().map(a => `- ${a.name} (${a.by}, ${Math.round((Date.now() - a.t) / 60_000)} min ago)`);
    return [`${all.length} unlocked so far. Latest:`, ...latest].join('\n');
}

/**
 * The full picture for council: what is unlocked, and what is still there to unlock (items by
 * tier, monsters by level, each member's next marks), so missions can aim at real firsts.
 */
export function renderAchievementsForCouncil(members: { name: string; state: BotWorldState | null | undefined }[], monsters: { type: string; level: number; count: number; hp?: number }[]): string {
    const got = (id: string) => !!ledger[id];
    const open = (pairs: [string, string][]) => pairs.filter(([id]) => !got(id)).map(([, n]) => n);
    const items = open([
        ...ORES.map(o => [`item:${o}`, o] as [string, string]),
        ...BARS.map(b => [`item:${b}`, b] as [string, string]),
        ...LOGS.map(l => [`item:${l}`, l] as [string, string])
    ]);
    const fish = open(FISH.map(f => [`fish:${f}`, one(f)]));
    const cooked = open(FISH.map(f => [`cooked:${f}`, `cooked ${one(f)}`]));
    const a = (m: string) => (/^[aeiou]/.test(m) ? `an ${m}` : `a ${m}`);
    const gear = open(METALS.flatMap(m => [[`gear:${m}`, `${a(m)} item`], [`worn:${m}`, `${a(m)} item worn`]] as [string, string][]));
    // Monster kinds that come in groups somewhere; one-off named characters are left out.
    const groups = new Map<string, { level: number; count: number; hp?: number }>();
    for (const m of monsters) {
        const g = groups.get(m.type) ?? { level: m.level, count: 0, hp: m.hp };
        groups.set(m.type, { level: Math.min(g.level, m.level), count: g.count + m.count, hp: m.level < g.level ? m.hp : (g.hp ?? m.hp) });
    }
    const foes = [...groups]
        .filter(([, g]) => g.count >= 2)
        .map(([type, g]) => ({ type, level: g.level, hp: g.hp }))
        .filter(m => !got(`kill:${m.type}`))
        .sort((a, b) => a.level - b.level)
        .map(m => `${m.type} ${m.level}${m.hp ? ` (${m.hp} HP)` : ''}`);
    const marks = members.map(({ name, state }) => {
        if (!state) return `${name}: (not seen)`;
        const next = state.skills
            .filter(k => !/^stat\d+$/i.test(k.name))
            .map(k => ({ k: k.name, next: SKILL_MARKS.find(l => l > k.baseLevel) }))
            .filter(x => x.next)
            .map(x => `${x.k} ${x.next}`);
        const combat = state.player?.combatLevel ?? 0;
        const total = state.skills.filter(k => !/^stat\d+$/i.test(k.name)).reduce((n, k) => n + k.baseLevel, 0);
        return `${name}: combat ${COMBAT_MARKS.find(l => l > combat) ?? '-'}, total ${TOTAL_MARKS.find(l => l > total) ?? '-'}, ${next.join(', ')}${got(`set:${name}`) ? '' : ', a full worn set'}`;
    });
    const all = allAchievements();
    const per = members.map(({ name }) => `${name} ${all.filter(x => x.by === name).length}`).join(', ');
    return [
        `Unlocked: ${all.length} (${per}). Latest: ${all.slice(-8).reverse().map(x => x.name).join('; ') || 'none'}`,
        'Still to unlock:',
        `- Firsts: ${items.join(', ') || 'all done'}`,
        `- Fish caught: ${fish.join(', ') || 'all done'}; cooked: ${cooked.join(', ') || 'all done'}`,
        `- Gear: ${gear.join(', ') || 'all done'}`,
        `- Strongest monster the party has defeated: ${strongest ? `${strongest.type} (combat ${strongest.level}, by ${strongest.by})` : 'none recorded yet'}; next combat marks: ${KILL_MARKS.filter(m => !got(`kill-level:${m}`)).map(m => `a monster of combat ${m}+`).join(', ') || 'all done'}`,
        `- Monsters never defeated (combat level, hitpoints): ${foes.join(', ') || 'none left'}`,
        '- Next level marks:',
        ...marks.map(m => `  ${m}`)
    ].join('\n');
}

/**
 * What is still open and within reach of one character: their closest skill and combat marks,
 * the weakest monster kinds nobody has beaten, and the first items, fish and gear not yet seen.
 */
export function renderAchievementsNear(name: string, state: BotWorldState | null | undefined, monsters: { type: string; level: number; count: number }[]): string {
    const got = (id: string) => !!ledger[id];
    const parts: string[] = [];
    if (state) {
        const skills = state.skills
            .filter(k => !/^stat\d+$/i.test(k.name))
            .map(k => ({ k: k.name, level: k.baseLevel, next: SKILL_MARKS.find(l => l > k.baseLevel) }))
            .filter((x): x is { k: string; level: number; next: number } => x.next != null && !got(`skill:${name}:${x.k}:${x.next}`))
            .sort((x, y) => (x.next - x.level) - (y.next - y.level))
            .slice(0, 3)
            .map(x => `${x.k} ${x.level} -> ${x.next}`);
        if (skills.length) parts.push(`skill marks ${skills.join(', ')}`);
        const combat = state.player?.combatLevel ?? 0;
        const nextCombat = COMBAT_MARKS.find(l => l > combat);
        if (nextCombat) parts.push(`combat ${combat} -> ${nextCombat}`);
    }
    const kinds = new Map<string, { level: number; count: number }>();
    for (const m of monsters) {
        const g = kinds.get(m.type) ?? { level: m.level, count: 0 };
        kinds.set(m.type, { level: Math.min(g.level, m.level), count: g.count + m.count });
    }
    const foes = [...kinds].filter(([t, g]) => g.count >= 2 && !got(`kill:${t}`)).sort((x, y) => x[1].level - y[1].level).slice(0, 3).map(([t, g]) => `${t} (combat ${g.level})`);
    if (foes.length) parts.push(`never defeated: ${foes.join(', ')}`);
    const firsts = [...ORES, ...BARS, ...LOGS].filter(i => !got(`item:${i}`)).slice(0, 4);
    if (firsts.length) parts.push(`first to hold: ${firsts.join(', ')}`);
    return parts.join('; ') || 'nothing close';
}
