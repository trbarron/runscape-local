import { expect, test } from 'bun:test';
import type { BotWorldState } from '../rs-sdk/sdk/types';
import { armourHabitHint } from './armour-habit';
const state = (slots: number[]) => ({ inGame: true, player: { maxHp: 20 }, equipment: slots.map(slot => ({ slot })) } as BotWorldState);

test('a complete outfit needs no recurring reminder, regardless of metal or optional slots', () => {
    expect(armourHabitHint(state([0, 4, 7]), 0)).toBeNull();
});
test('partial recovery mentions only the empty core slot and leaves outfit choice to the character', () => {
    const hint = armourHabitHint(state([4, 7]), 0);
    expect(hint).toContain('not wearing a helmet');
    expect(hint).not.toContain('not wearing body armour');
    expect(hint).toContain('convenient safe break');
    expect(hint).toContain('gear you actually own');
});
test('capes and shields do not conceal empty core slots', () => {
    expect(armourHabitHint(state([1, 5]), 0)).toContain('a helmet, body armour, leg armour');
});
test('unknown, stale and loading state never prompts an unnecessary equipment recovery', () => {
    expect(armourHabitHint(null, 0)).toBeNull();
    expect(armourHabitHint(state([]), 30_001)).toBeNull();
    expect(armourHabitHint({ ...state([]), inGame: false }, 0)).toBeNull();
    expect(armourHabitHint({ ...state([]), player: null }, 0)).toBeNull();
});
