// Equipment, tool and recipe requirements from this server's own configs.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { BotWorldState } from '../rs-sdk/sdk/types';
import { cleanLookupText } from './lookup-text';

const root = join(import.meta.dir, '..', 'rs-sdk/server/content/scripts');
const blocks = (text: string): [string, string][] => {
    const parts = text.split(/^\[([^\]]+)\][ \t]*$/m);
    const result: [string, string][] = [];
    for (let i = 1; i < parts.length; i += 2) result.push([parts[i], parts[i + 1]]);
    return result;
};
const displayNames = new Map<string, string>();
const rules = new Map<string, [string, number][]>();
for (const file of readdirSync(join(root, 'levelrequire/scripts'))) {
    if (!file.endsWith('.rs2')) continue;
    const text = readFileSync(join(root, 'levelrequire/scripts', file), 'utf8');
    for (const m of text.matchAll(/\[opheld2,([^\]]+)\]\s*@levelrequire_([a-z_]+)\(([^)]*)\)/g)) {
        const skills = m[2].replace(/_lower$/, '').split('_and_');
        const numbers = m[3].split(',').map(v => Number(v.trim()));
        if (!skills.every(s => /^(attack|strength|defence|ranged|magic|prayer|agility|slayer)$/.test(s))) continue;
        if (skills.some((_, i) => !Number.isFinite(numbers[i]))) continue;
        rules.set(m[1], skills.map((s, i) => [s[0].toUpperCase() + s.slice(1), numbers[i]]));
    }
}
const items = new Map<string, { requirements: [string, number][]; toolLevel: number; stackable: boolean }>();
for (const file of readdirSync(root, { recursive: true }) as string[]) {
    if (!file.endsWith('.obj')) continue;
    const text = readFileSync(join(root, file), 'utf8');
    for (const [key, body] of blocks(text)) {
        const name = body.match(/^name=(.+)$/m)?.[1];
        if (!name) continue;
        displayNames.set(key, name);
        items.set(cleanLookupText(name).toLowerCase(), {
            requirements: rules.get(key) ?? [],
            toolLevel: Number(body.match(/^param=levelrequire,(\d+)$/m)?.[1] ?? 1),
            // Several blocks can share a display name (coins, coins_2 ...): any stackable one counts.
            stackable: /^stackable=yes$/m.test(body) || (items.get(cleanLookupText(name).toLowerCase())?.stackable ?? false)
        });
    }
}
export const skillLevel = (s: BotWorldState, name: string) => s.skills.find(k => k.name === name)?.baseLevel ?? 1;
/** Combat is a derived player statistic, not an entry in the ordinary skill list. */
export function progressLevel(s: BotWorldState | null | undefined, name: string): number {
    const key = name.trim().toLowerCase();
    return key === 'combat' ? s?.player?.combatLevel ?? 0
        : s?.skills.find(k => k.name.toLowerCase() === key)?.baseLevel ?? 0;
}
export function equipmentBlocker(s: BotWorldState, name: string): string | null {
    const requirements = items.get(cleanLookupText(name).toLowerCase())?.requirements ?? [];
    const lacks = requirements.filter(([skill, need]) => skillLevel(s, skill) < need);
    return lacks.length ? `${name} needs ${lacks.map(([skill, need]) => `${skill} ${need} (you are ${skillLevel(s, skill)})`).join(' and ')}` : null;
}
/** Whether the game stacks this item in one slot (coins, bait, feathers, runes, arrows). */
export const isStackable = (name: string) => items.get(cleanLookupText(name).toLowerCase())?.stackable ?? false;

/**
 * How many to ask the bank for. Free slots only limit items that take a slot each: a stack of coins
 * or bait fits whatever the pack holds, as long as there is one slot (or the stack is already there).
 */
export function withdrawAmount(o: { want: number; free: number; stackable: boolean; inBank: number; noted: boolean }): number {
    if (o.noted) return o.want;
    if (o.stackable) return o.want > 0 ? Math.min(o.want, o.inBank || o.want) : o.inBank || o.free;
    return o.want > 0 ? Math.min(o.want, o.free) : o.free;
}
export const toolUseLevel = (name: string): number => items.get(cleanLookupText(name).toLowerCase())?.toolLevel ?? 1;
export function usableTool(s: BotWorldState, name: string, skill: string): boolean {
    return skillLevel(s, skill) >= toolUseLevel(name);
}

const smithing = new Map<string, { level: number; bar: string; count: number }>();
const smithText = readFileSync(join(root, 'skill_smithing/configs/smithing/smithing.dbrow'), 'utf8');
for (const [key, body] of blocks(smithText)) {
    const required = Number(body.match(/^data=levelrequired,(\d+)$/m)?.[1]);
    const bar = body.match(/^data=bar,(.+)$/m)?.[1].replace(/_/g, ' ');
    const count = Number(body.match(/^data=bar_amount,(\d+)$/m)?.[1]);
    if (bar && required && count) smithing.set(key.replace(/_/g, ' '), { level: required, bar, count });
}
export const smithRecipe = (name: string) => smithing.get(cleanLookupText(name).toLowerCase());

/** Base displayed Smithing XP; the server stores XP in tenths. */
export const SMITHING_METALS = blocks(readFileSync(join(root, 'skill_smithing/configs/smithing/smithing.struct'), 'utf8'))
    .map(([, body]) => ({
        metal: body.match(/^param=name,(.+)$/m)?.[1] ?? '',
        bar: body.match(/^param=namedobj,(.+)$/m)?.[1].replace(/_/g, ' ') ?? '',
        level: Number(body.match(/^param=levelrequired,(\d+)$/m)?.[1]),
        xpPerBar: Number(body.match(/^param=xpperbar,(\d+)$/m)?.[1]) / 10,
    }))
    .filter(m => m.bar && m.level > 0 && m.xpPerBar > 0)
    .sort((a, b) => a.level - b.level);

const cooking = new Map<string, number>();
const cookText = readFileSync(join(root, 'skill_cooking/configs/cooking_source/cooking_generic.dbrow'), 'utf8');
for (const [, body] of blocks(cookText)) {
    const raw = body.match(/^data=uncooked,(.+)$/m)?.[1];
    const required = Number(body.match(/^data=levelrequired,(\d+)$/m)?.[1]);
    if (raw && Number.isFinite(required)) cooking.set((displayNames.get(raw) ?? raw.replace(/_/g, ' ')).toLowerCase(), required);
}
export const cookingLevel = (rawName: string) => cooking.get(rawName.toLowerCase()) ?? Infinity;

/** Crafting levels for supported gem cutting and gold jewellery. */
export const CUT_LEVELS: Record<string, number> = { opal: 1, jade: 13, 'red topaz': 16, sapphire: 20, emerald: 27, ruby: 34, diamond: 43 };
export const JEWELLERY_LEVELS: Record<string, Record<string, number>> = {
    ring: { gold: 5, sapphire: 20, emerald: 27, ruby: 34, diamond: 43 },
    necklace: { gold: 6, sapphire: 22, emerald: 29, ruby: 40, diamond: 54 },
    amulet: { gold: 8, sapphire: 24, emerald: 31, ruby: 50, diamond: 70 }
};
