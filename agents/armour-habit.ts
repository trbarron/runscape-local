import type { BotWorldState } from '../rs-sdk/sdk/types';

/** Core worn slots shared by progress checks and the planner's quiet outfit reminder. */
export const ARMOUR_SLOTS: [number, string][] = [[0, 'a helmet'], [4, 'body armour'], [7, 'leg armour']];

/** A preference at normal decision points, never an automatic equipment action or interrupt. */
export function armourHabitHint(state: BotWorldState | null, ageMs: number): string | null {
    if (!state?.inGame || !state.player?.maxHp || ageMs > 30_000) return null;
    const worn = new Set(state.equipment.map(item => item.slot));
    const missing = ARMOUR_SLOTS.filter(([slot]) => !worn.has(slot)).map(([, label]) => label);
    if (!missing.length) return null;
    return `Outfit check: you are not wearing ${missing.join(', ')}. At a convenient safe break, consider filling the empty slots from gear you actually own; keep your look and useful bonuses in mind. This is an everyday preference, not a new errand or a reason to repeat an impossible withdrawal.`;
}
