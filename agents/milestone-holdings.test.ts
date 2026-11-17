import { expect, test } from 'bun:test';
import { milestoneHoldings } from './milestone-holdings';
import type { Member } from './missions';

const m = (name: string, over: Partial<Member>): Member => ({ name, skills: {}, combat: 3, worn: [], carried: {}, bank: {}, ...over });
const ms = (id: number, what: string, needs = '', over = {}) => ({ id, what, needs, done: false, ...over });

test('shows who holds the items an open milestone names, so a handoff gap is visible', () => {
    const members = [m('mike', { bank: { 'steel med helm': 54, coins: 7279 } }), m('trish', { bank: { 'steel med helm': 3, 'mithril dagger': 8 }, worn: ['iron platelegs'] })];
    const text = milestoneHoldings(members, [ms(3, 'Wren banks 3,000 coins; Trish wears one mithril dagger and banks 30 steel med helms.')]);
    expect(text).toContain('M3 names');
    expect(text).toContain('steel med helm: mike 54 banked, trish 3 banked');
    expect(text).toContain('mithril dagger: trish 8 banked');
    expect(text).toContain('coins: mike 7279 banked');
});

test('leaves out finished and game-checked milestones, and parts of a longer name', () => {
    const members = [m('mike', { bank: { 'steel med helm': 54, steel: 2 } })];
    expect(milestoneHoldings(members, [ms(1, 'steel med helm', '', { done: true })])).toBe('');
    expect(milestoneHoldings(members, [ms(2, 'steel med helm', '', { auto: { armour: true } })])).toBe('');
    expect(milestoneHoldings(members, [ms(3, 'banks steel med helms')])).not.toContain('steel:');
});
