import { combatFoodPreparation } from './combat-food';
import type { BotWorldState } from '../rs-sdk/sdk/types';
import { cleanLookupText } from './lookup-text';
import { equipmentBlocker, progressLevel, usableTool } from './game-requirements';
import { shopSelling } from './shops';
import { bankDepositNeeded, heldNeed, SKILLS, workRequirements, type Args, type ItemNeed } from './skills';

export interface PlannedStep {
    action: string;
    args: Args;
    give?: { item: string; to: string; amount: number | null };
    until: { type: string; skill: string | null; value: number };
}
export interface Preparation { action: string; args: Args; reason: string }
export type Readiness = { preparation: Preparation; blocker?: never } | { blocker: string; preparation?: never } | { preparation?: undefined; blocker?: undefined };
const count = (s: BotWorldState, pattern: RegExp) => s.inventory.filter(i => pattern.test(i.name)).reduce((v, i) => v + i.count, 0);
const exact = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');


/** Same cooked/noted naming rules as the withdrawal action. Empty views may be undiscovered. */
function withdrawalBlocker(bank: Record<string, number>, target: string | null): string | null {
    if (!target || !Object.keys(bank).length) return null;
    const named = cleanLookupText(target).replace(/^(.*?)\s*\(cooked\)\s*$/i, 'cooked $1').replace(/\bnoted?\b/gi, '').trim();
    const cooked = /^cooked\s+/i.test(named);
    const plain = named.replace(/^cooked\s+/i, '').replace(/s$/i, '');
    const escaped = plain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(cooked ? `^${escaped}s?$` : escaped, 'i');
    return Object.entries(bank).some(([name, amount]) => amount > 0 && match.test(name)) ? null : `your known bank has no ${target}; choose available stock, buy it or arrange a handoff`;
}

/** A fulfilled intent succeeds even if its inputs are no longer in the pack. */
export function satisfiedStep(s: BotWorldState, step: PlannedStep): string | null {
    if (step.until.type === 'skill_level' && step.until.skill) {
        const have = progressLevel(s, step.until.skill);
        if (have >= step.until.value) return `already ${step.until.skill} ${have}; target ${step.until.value} satisfied`;
    }
    if (step.action === 'bank_resources' && !bankDepositNeeded(s, step.args)) return 'nothing matching remains to bank; cleanup satisfied';
    if (step.action === 'equip' && step.args.target && s.equipment.some(i => cleanLookupText(i.name).toLowerCase() === cleanLookupText(step.args.target!).toLowerCase())) return `already wearing ${step.args.target}; step satisfied`;
    return null;
}

/** Checks the whole plan's known levels and spending, allowing earlier training/income steps. */
export function preflightRoutine(s: BotWorldState, bank: Record<string, number>, steps: PlannedStep[]): string | null {
    let projected = { ...s, skills: s.skills.map(k => ({ ...k })) };
    let coins = count(s, /^coins$/i) + Object.entries(bank).filter(([n]) => /^coins$/i.test(n)).reduce((v, [, n]) => v + n, 0);
    let incomeUnknown = false;
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (satisfiedStep(projected, step)) continue;
        if (!step.give) {
            if (/^(buy|equip|withdraw_from_bank)$/.test(step.action) && !step.args.target?.trim()) return `step ${i + 1}: name the item for ${step.action}`;
            if (step.action === 'withdraw_from_bank' && !steps.slice(0, i).some(x => x.action === 'bank_resources')) {
                const absent = withdrawalBlocker(bank, step.args.target);
                if (absent) return `step ${i + 1}: ${absent}`;
            }
            const req = workRequirements(projected, step.action, step.args);
            const blocker = step.action === 'equip' ? equipmentBlocker(projected, step.args.target ?? '') : req.blocker;
            if (blocker) return `step ${i + 1}: ${blocker}`;
            if (step.action === 'buy') {
                const found = shopSelling(step.args.target ?? '');
                if (!found) return `step ${i + 1}: no shop sells ${step.args.target}`;
                // Only judge wearability when this routine intends to equip the purchase.
                const wornNext = steps.slice(i + 1).some(x => x.action === 'equip' && cleanLookupText(x.args.target ?? '').toLowerCase() === found.item.name.toLowerCase());
                if (wornNext) {
                    const afterTraining = steps.slice(i + 1).some(x => x.until.type === 'skill_level');
                    const wear = equipmentBlocker(projected, found.item.name);
                    if (wear && !afterTraining) return `step ${i + 1}: buying to equip would fail: ${wear}`;
                }
                coins -= found.item.price * Math.max(1, step.args.amount ?? 1);
                if (coins < 0 && !incomeUnknown) return `step ${i + 1}: purchases exceed carried and banked coins by ${-coins}`;
            }
        }
        if (/^(sell_to_shop|pickpocket)$/.test(step.action)) incomeUnknown = true;
        if (step.until.type === 'skill_level' && step.until.skill) {
            projected = { ...projected, skills: projected.skills.map(k => k.name === step.until.skill ? { ...k, baseLevel: Math.max(k.baseLevel, step.until.value) } : k) };
        }
    }
    const first = steps[0];
    if (!first || satisfiedStep(s, first)) return null;
    const readiness = nextPreparation(s, bank, first);
    return readiness.blocker ?? (!readiness.preparation && !first.give ? SKILLS[first.action]?.requires?.(s, first.args) ?? null : null);
}

/** One bounded preparation at a time; its effects must be verified against fresh game state. */
export function nextPreparation(s: BotWorldState, bank: Record<string, number>, step: PlannedStep): Readiness {
    if (satisfiedStep(s, step) || step.give) return {};
    const food=combatFoodPreparation(s,bank,step);
    if(food.blocker||food.preparation)return food;
    if (step.action === 'withdraw_from_bank') {
        const absent = withdrawalBlocker(bank, step.args.target);
        if (absent) return { blocker: absent };
    }
    const req = workRequirements(s, step.action, step.args);
    if (req.blocker) return { blocker: req.blocker };
    if (step.action === 'equip') {
        const blocker = equipmentBlocker(s, step.args.target ?? '');
        if (blocker) return { blocker };
        const name = cleanLookupText(step.args.target ?? '');
        req.items.push({ name, match: exact(name), count: 1, stackable: true });
    }
    const sources = (n: ItemNeed) => Object.entries(bank).filter(([name, amount]) => amount > 0 && n.match.test(name) && (!n.tool || usableTool(s, name, n.tool)));
    const missing = req.items.filter(n => heldNeed(s, n) < n.count);
    // Check all inputs before acquiring any, so preparation cannot partially buy an impossible recipe.
    let cost = 0;
    for (const n of missing) {
        const shortage = n.count - heldNeed(s, n) - sources(n).reduce((v, [, amount]) => v + amount, 0);
        if (shortage <= 0) continue;
        const sale = n.tool || n.stackable ? shopSelling(n.name) : null;
        if (!sale) return { blocker: `needs ${n.count} ${n.name}; not enough usable stock in your own bank and no automatic purchase available` };
        cost += sale.item.price * shortage;
    }
    const bankCoins = Object.entries(bank).filter(([name]) => /^coins$/i.test(name)).reduce((v, [, amount]) => v + amount, 0);
    if (cost > count(s, /^coins$/i) + bankCoins) return { blocker: `preparation costs ${cost} coins; carried and banked coins are insufficient` };
    const prepare = (action: string, target: string, amount: number, reason: string): Readiness => ({ preparation: { action, args: { target, amount }, reason } });
    const makeRoom = (): Readiness => {
        const spare = s.inventory.find(i => !/^coins$/i.test(i.name) && !req.items.some(n => n.match.test(i.name)));
        const duplicate = s.inventory.find(i => !/^coins$/i.test(i.name) && req.items.some(n => n.match.test(i.name) && count(s, exact(i.name)) > n.count));
        const item = spare ?? duplicate;
        return item ? prepare('bank_resources', item.name, -1, 'free inventory space before preparation') : { blocker: 'no safe surplus item to bank; make inventory space before this step' };
    };
    const slotsNeeded = missing.reduce((v, n) => v + (n.stackable ? 1 : n.count - heldNeed(s, n)), 0);
    if (missing.length && 28 - s.inventory.length < slotsNeeded) return makeRoom();
    if (missing.length) {
        const n = missing[0];
        const own = sources(n)[0];
        if (own) {
            const reserve = missing.slice(1).reduce((v, x) => v + (x.stackable ? 1 : x.count - heldNeed(s, x)), 0);
            const amount = n.tool ? 1 : Math.min(own[1], n.count * 5, n.stackable ? n.count * 5 : 28 - s.inventory.length - reserve);
            return prepare('withdraw_from_bank', own[0], amount, `get ${n.name} from your own bank`);
        }
        const sale = shopSelling(n.name)!;
        const amount = n.count - heldNeed(s, n);
        const needCoins = sale.item.price * amount - count(s, /^coins$/i);
        if (needCoins > 0) return prepare('withdraw_from_bank', 'Coins', needCoins, 'fund the missing prerequisite from your own bank');
        return prepare('buy', sale.item.name, amount, `buy missing ${n.name}`);
    }
    if (step.action === 'buy') {
        const sale = shopSelling(step.args.target ?? '');
        if (!sale) return { blocker: `no shop sells ${step.args.target}` };
        const cost = sale.item.price * Math.max(1, step.args.amount ?? 1);
        const short = cost - count(s, /^coins$/i);
        if (short > 0) {
            if (bankCoins < short) return { blocker: `${sale.item.name} costs ${cost} coins; insufficient carried and banked coins` };
            if (s.inventory.length >= 28 && !count(s, /^coins$/i)) return makeRoom();
            return prepare('withdraw_from_bank', 'Coins', short, 'fund the planned purchase from your own bank');
        }
    }
    if ((/^(buy|buy_tools|withdraw_from_bank|pick_up)$/.test(step.action) || SKILLS[step.action]?.gathers) && s.inventory.length >= 28) return makeRoom();
    return {};
}
