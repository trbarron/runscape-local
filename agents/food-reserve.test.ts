import { expect, test } from 'bun:test';
import { COOKED_FISH, depositPlan, foodHeld, FOOD_RESERVE, reserveWithdrawal } from './food-reserve';

const all = () => true;

test('cooked fish counts as food, raw fish does not', () => {
    expect(COOKED_FISH.test('Shrimps')).toBe(true);
    expect(COOKED_FISH.test('Raw shrimps')).toBe(false);
    expect(foodHeld([{ name: 'Trout', count: 2 }, { name: 'Raw trout', count: 9 }, { name: 'Coal', count: 4 }])).toBe(2);
});

test('banking keeps the reserve and deposits only the surplus food', () => {
    const plan = depositPlan([{ name: 'Shrimps', count: 8 }, { name: 'Iron ore', count: 6 }], all, true);
    expect(plan).toEqual([{ name: 'Shrimps', amount: 8 - FOOD_RESERVE }, { name: 'Iron ore', amount: -1 }]);
});

test('a pack holding only the reserve has nothing food-related to deposit', () => {
    expect(depositPlan([{ name: 'Shrimps', count: FOOD_RESERVE }], all, true)).toEqual([]);
});

test('the reserve is shared across kinds rather than kept per kind', () => {
    const plan = depositPlan([{ name: 'Shrimps', count: 3 }, { name: 'Trout', count: 4 }], all, true);
    expect(plan).toEqual([{ name: 'Trout', amount: 2 }]);
});

test('naming an item deposits all of it, as asked', () => {
    expect(depositPlan([{ name: 'Shrimps', count: 8 }], n => n === 'Shrimps', false)).toEqual([{ name: 'Shrimps', amount: -1 }]);
});

test('an empty pack withdraws the most plentiful cooked fish, only what the bank has', () => {
    const bank = [{ name: 'Shrimps', count: 12000 }, { name: 'Raw shrimps', count: 22000 }, { name: 'Trout', count: 100 }];
    expect(reserveWithdrawal([], bank, 20)).toEqual({ name: 'Shrimps', amount: FOOD_RESERVE });
    expect(reserveWithdrawal([], [{ name: 'Trout', count: 2 }], 20)).toEqual({ name: 'Trout', amount: 2 });
});

test('no withdrawal when the reserve is held, the bank has no cooked fish or the pack is full', () => {
    expect(reserveWithdrawal([{ name: 'Shrimps', count: FOOD_RESERVE }], [{ name: 'Shrimps', count: 50 }], 20)).toBeNull();
    expect(reserveWithdrawal([], [{ name: 'Raw shrimps', count: 50 }], 20)).toBeNull();
    expect(reserveWithdrawal([], [{ name: 'Shrimps', count: 50 }], 0)).toBeNull();
});

test('a partly stocked pack is topped up to the reserve', () => {
    expect(reserveWithdrawal([{ name: 'Shrimps', count: 2 }], [{ name: 'Shrimps', count: 50 }], 20)).toEqual({ name: 'Shrimps', amount: FOOD_RESERVE - 2 });
});
