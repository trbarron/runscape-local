import { expect, test } from 'bun:test';
import { OpportunityPool, MENU_REFRESH_MS, missionSelectionReason } from './opportunities';
import type { Ctx } from './missions';
const ctx = (): Ctx => ({
    size: 1,
    members: [
        { name: 'a', skills: { Mining: 20, Smithing: 20 }, combat: 20, worn: [], carried: { coins: 1000, 'bronze pickaxe': 1 }, bank: {} },
    ],
    has: () => false,
});
test('offers refresh on changed facts or five-minute expiry, without changing a mission', () => {
    let builds = 0;
    const pool = new OpportunityPool(() => {
        builds++;
        return { menu: [], why: [], eligibleCount: 0 };
    });
    const c = ctx();
    const first = pool.get(c, [], 1000);
    expect(pool.get(c, [], 1100)).toBe(first);
    expect(builds).toBe(1);
    c.members[0].carried.coins++;
    expect(pool.get(c, [], 1200)).not.toBe(first);
    expect(builds).toBe(2);
    pool.get(c, [], 1200 + MENU_REFRESH_MS);
    expect(builds).toBe(3);
    pool.get(c, [], 1201 + MENU_REFRESH_MS, true);
    expect(builds).toBe(4);
});
test('active feasible missions survive arbitrary council counters; completion and invalid chains trigger selection', () => {
    const c = ctx();
    const active = {
        mission: 'collect copper',
        milestones: [{ done: false, auto: { check: { kind: 'stock' as const, item: 'copper ore', count: 84 } } }],
    };
    expect(missionSelectionReason(active, c)).toBeNull();
    expect(missionSelectionReason({ ...active, milestones: [{ done: true }] }, c)).toContain('complete');
    expect(
        missionSelectionReason(
            { mission: 'cook', milestones: [{ done: false, auto: { check: { kind: 'stock', item: 'swordfish', count: 60 } } }] },
            c,
        ),
    ).toContain('not executable');
    expect(missionSelectionReason(active, c, 'user-directed rescope')).toBe('user-directed rescope');
});
test('partial state never retires a mission due to missing worker observations', () => {
    const c = ctx();
    c.size = 4;
    expect(
        missionSelectionReason(
            { mission: 'cook', milestones: [{ done: false, auto: { check: { kind: 'stock', item: 'swordfish', count: 60 } } }] },
            c,
        ),
    ).toBeNull();
});

test('a temporary loss of supply funding does not automatically retire an active mission', () => {
    const c = ctx();
    c.members[0].skills.Fishing = 30;
    c.members[0].skills.Cooking = 30;
    c.members[0].carried = {};
    const goal = {
        mission: 'stock trout',
        milestones: [{ done: false, auto: { check: { kind: 'stock' as const, item: 'trout', count: 60 } } }],
    };
    expect(missionSelectionReason(goal, c)).toBeNull();
});
