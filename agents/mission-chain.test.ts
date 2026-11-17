import { expect, test } from 'bun:test';
import { productionChain } from './mission-chain';
import type { Ctx, Member } from './missions';
const member = (name: string, skills: Record<string, number> = {}, coins = 1000): Member => ({
    name,
    skills,
    combat: 10,
    worn: [],
    carried: { coins, 'bronze pickaxe': 1, 'bronze axe': 1, hammer: 1 },
    bank: {},
});
const ctx = (members: Member[]): Ctx => ({ members, size: members.length, has: () => false });

test('smelting level alone does not make platelegs smithing feasible', () => {
    const c = ctx([member('smith', { Smithing: 30, Mining: 40 })]);
    expect(productionChain(c, 'steel platelegs', 1).blocker).toContain('qualified smith');
    c.members[0].skills.Smithing = 46;
    expect(productionChain(c, 'steel platelegs', 1).blocker).toBeUndefined();
});
test('other characters banked money is not assumed available to the buyer', () => {
    const c = ctx([member('angler', { Fishing: 50, Cooking: 50 }, 0), member('rich', { Fishing: 1 }, 5000)]);
    const result = productionChain(c, 'trout', 60);
    expect(result.blocker).toContain('cannot fund');
});
test('existing supplies are used with explicit owner withdrawal and delivery', () => {
    const c = ctx([member('smith', { Smithing: 50 }), member('supplier')]);
    c.members[1].bank['steel bar'] = 5;
    const chain = productionChain(c, 'steel med helm', 1, 'smith');
    expect(chain.blocker).toBeUndefined();
    expect(chain.work).toContainEqual(expect.objectContaining({ owner: 'supplier', action: 'withdraw_from_bank', target: 'steel bar' }));
    expect(chain.work).toContainEqual(expect.objectContaining({ owner: 'supplier', action: 'give', target: 'steel bar', to: 'smith' }));
});
test('missing range invalidates cooking, while already cooked stock remains valid', () => {
    const c = ctx([member('chef', { Fishing: 50, Cooking: 50 })]);
    c.spots = [{ kind: 'bank', type: 'bank', x: 3200, z: 3200, count: 1, near: 'test' }];
    expect(productionChain(c, 'trout', 60).blocker).toContain('range');
    c.members[0].bank.trout = 60;
    expect(productionChain(c, 'trout', 60).blocker).toBeUndefined();
});
test('each assigned worker can actually perform their recipe; low-skill cooks do not inherit high-level catches', () => {
    const c = ctx([member('angler', { Fishing: 99, Cooking: 1 }), member('novice', { Cooking: 1 })]);
    expect(productionChain(c, 'salmon', 60).blocker).toContain('qualified cook');
});

test('party reserves produce only the shortfall without consolidating existing banks', () => {
    const c = ctx([member('chef', { Fishing: 30, Cooking: 30 }), member('other')]);
    c.members[1].bank.trout = 58;
    c.members[0].bank['raw trout'] = 2;
    const result = productionChain(c, 'trout', 60);
    expect(result.blocker).toBeUndefined();
    expect(result.work.some((w) => w.action === 'give' && w.owner === 'other')).toBe(false);
    expect(result.work.find((w) => w.action === 'cook')?.amount).toBe(2);
    expect(result.work.some((w) => w.action === 'bank_resources' && w.target === 'cooked trout')).toBe(true);
});
test('smelting chains share exact executor ore ratios', () => {
    const c = ctx([member('smith', { Mining: 60, Smithing: 60 })]);
    const result = productionChain(c, 'mithril bar', 3);
    expect(result.blocker).toBeUndefined();
    expect(result.work.find((w) => w.action === 'mine' && w.target === 'coal')?.amount).toBe(12);
    expect(result.work.find((w) => w.action === 'mine' && w.target === 'mithril')?.amount).toBe(3);
});

test('a usable higher-tier tool satisfies the chain without a needless bronze purchase', () => {
    const c = ctx([member('miner', { Mining: 99 }, 0)]);
    delete c.members[0].carried['bronze pickaxe'];
    c.members[0].carried['rune pickaxe'] = 1;
    const chain = productionChain(c, 'copper ore', 84);
    expect(chain.blocker).toBeUndefined();
    expect(chain.work.some((w) => w.action === 'buy')).toBe(false);
});

test('existing cooked-food deliveries name cooked food explicitly rather than matching raw fish',()=>{
    const c=ctx([member('receiver'),member('supplier')]);c.members[1].bank.trout=20;
    const chain=productionChain(c,'trout',20,'receiver');
    expect(chain.blocker).toBeUndefined();
    expect(chain.work.find(w=>w.action==='give')?.target).toBe('cooked trout');
});

test('own ore and coal avoid making a teammates one steel bar a dependency', () => {
    const c=ctx([member('smith',{Smithing:64}),member('supplier')]);
    c.members[0].bank={'coal':24,'iron ore':12};
    c.members[1].bank={'steel bar':1};
    const chain=productionChain(c,'steel med helm',12,'smith');
    expect(chain.blocker).toBeUndefined();
    expect(chain.work.some(w=>w.action==='give')).toBe(false);
    expect(chain.work).toContainEqual(expect.objectContaining({owner:'smith',action:'smelt',target:'steel',amount:12}));
});
test('failed personal production leaves no reservations or purchases in the shared fallback', () => {
    const c=ctx([member('smith',{Smithing:64},1),member('supplier')]);
    delete c.members[0].carried.hammer;
    c.members[1].bank={'steel bar':12};
    const chain=productionChain(c,'steel med helm',12,'smith');
    expect(chain.blocker).toBeUndefined();
    expect(chain.work.filter(w=>w.action==='buy' && /hammer/i.test(w.target))).toHaveLength(1);
    expect(chain.work.some(w=>w.action==='smelt')).toBe(false);
    expect(chain.work).toContainEqual(expect.objectContaining({owner:'supplier',action:'give',amount:12,to:'smith'}));
});

const fishCtx = (coins: number, extra: Record<string, number> = {}) => {
    const m = member('angler', { Fishing: 50, Cooking: 50 }, coins);
    Object.assign(m.carried, extra);
    return ctx([m]);
};
test('ferry fishing needs the angler to hold 60 own coins for the round trip', () => {
    const short = productionChain(fishCtx(59, { harpoon: 1 }), 'raw swordfish', 10);
    expect(short.blocker).toContain('60 own coins');
    expect(short.blocker).toContain('has 59');
    const enough = productionChain(fishCtx(60, { harpoon: 1 }), 'raw swordfish', 10);
    expect(enough.blocker).toBeUndefined();
    expect(enough.work).toContainEqual(expect.objectContaining({ owner: 'angler', action: 'fish', target: 'swordfish' }));
});
test('banked coins count toward the ferry reserve, and other characters money does not', () => {
    const banked = fishCtx(0, { harpoon: 1 });
    banked.members[0].bank.coins = 100;
    expect(productionChain(banked, 'raw swordfish', 10).blocker).toBeUndefined();
    const c = ctx([member('angler', { Fishing: 50 }, 0), member('rich', { Fishing: 1 }, 5000)]);
    c.members[0].carried.harpoon = 1;
    expect(productionChain(c, 'raw swordfish', 10).blocker).toContain('60 own coins');
});
test('a purchased tool is charged before the ferry reserve is checked', () => {
    // 60 coins cover only the fare, so the harpoon the angler lacks cannot be funded as well.
    expect(productionChain(fishCtx(60), 'raw swordfish', 10).blocker).toContain('cannot fund 1 harpoon');
    const rich = productionChain(fishCtx(5000), 'raw swordfish', 10);
    expect(rich.blocker).toBeUndefined();
    expect(rich.work).toContainEqual(expect.objectContaining({ owner: 'angler', action: 'buy', target: 'Harpoon' }));
});
test('species on the mainland need no ferry reserve', () => {
    const c = ctx([member('angler', { Fishing: 30 }, 0)]);
    c.members[0].carried['fly fishing rod'] = 1;
    c.members[0].carried.feathers = 100;
    expect(productionChain(c, 'raw salmon', 10).blocker).toBeUndefined();
});
test('swordfish and lobster fishing require their own Fishing levels', () => {
    const low = (level: number) => ctx([{ ...member('angler', { Fishing: level }, 500), carried: { coins: 500, harpoon: 1, 'lobster pot': 1 } }]);
    expect(productionChain(low(49), 'raw swordfish', 5).blocker).toContain('no qualified angler');
    expect(productionChain(low(39), 'raw lobster', 5).blocker).toContain('no qualified angler');
    expect(productionChain(low(40), 'raw lobster', 5).blocker).toBeUndefined();
    expect(productionChain(low(35), 'raw tuna', 5).blocker).toBeUndefined();
    expect(productionChain(low(34), 'raw tuna', 5).blocker).toContain('no qualified angler');
});
test('no cage/harpoon spot rejects ferry fishing', () => {
    const c = fishCtx(500, { harpoon: 1 });
    c.spots = [{ kind: 'bank', type: 'bank', x: 3200, z: 3200, count: 1, near: 'test' }];
    expect(productionChain(c, 'raw swordfish', 5).blocker).toContain('cage/harpoon');
});
test('the cook is not forced to use the angler when someone else is qualified', () => {
    const c = ctx([member('angler', { Fishing: 50 }, 500), member('chef', { Cooking: 50 })]);
    c.members[0].carried.harpoon = 1;
    c.spots = [
        { kind: 'bank', type: 'bank', x: 3200, z: 3200, count: 1, near: 'test' },
        { kind: 'range', type: 'range', x: 3210, z: 3210, count: 1, near: 'test' },
        { kind: 'fishing', type: 'cage/harpoon', x: 2925, z: 3180, count: 3, near: 'Musa Point', via: 'Karamja' } as never,
    ];
    const chain = productionChain(c, 'swordfish', 5);
    expect(chain.blocker).toBeUndefined();
    expect(chain.work.find((w) => w.action === 'cook')?.owner).toBe('chef');
    expect(chain.work.find((w) => w.action === 'fish')?.owner).toBe('angler');
});

test('gold jewellery needs the mould, a qualified crafter and gold bars', () => {
    const c = ctx([member('crafter', { Crafting: 5, Mining: 40, Smithing: 40 }, 0)]);
    expect(productionChain(c, 'gold ring', 5).blocker).toContain('cannot fund 1 ring mould');
    c.members[0].carried['ring mould'] = 1;
    const ok = productionChain(c, 'gold ring', 5);
    expect(ok.blocker).toBeUndefined();
    expect(ok.work).toContainEqual(expect.objectContaining({ owner: 'crafter', action: 'craft', target: 'gold ring', amount: 5 }));
    expect(ok.work.some((w) => w.action === 'smelt' && w.target === 'gold')).toBe(true);
    c.members[0].skills.Crafting = 4;
    expect(productionChain(c, 'gold ring', 5).blocker).toContain('no qualified crafter');
});
test('existing gold bars replace the furnace chain', () => {
    const c = ctx([member('crafter', { Crafting: 8 })]);
    c.members[0].carried['necklace mould'] = 1;
    c.members[0].bank['gold bar'] = 6;
    const chain = productionChain(c, 'gold necklace', 6);
    expect(chain.blocker).toBeUndefined();
    expect(chain.work.some((w) => w.action === 'smelt' || w.action === 'mine')).toBe(false);
});
test('gem jewellery uses owned gems and refuses to invent an unlimited gem source', () => {
    const c = ctx([member('crafter', { Crafting: 30, Mining: 40, Smithing: 40 })]);
    c.members[0].carried['ring mould'] = 1;
    c.members[0].bank['gold bar'] = 3;
    expect(productionChain(c, 'sapphire ring', 3).blocker).toContain('no complete gem supply');
    c.members[0].bank.sapphire = 3;
    expect(productionChain(c, 'sapphire ring', 3).blocker).toBeUndefined();
    c.members[0].bank.sapphire = 2;
    expect(productionChain(c, 'sapphire ring', 3).blocker).toContain('no complete gem supply');
});
test('uncut gems are cut with a chisel before they can be set', () => {
    const c = ctx([member('crafter', { Crafting: 30 }, 0)]);
    c.members[0].bank['uncut sapphire'] = 3;
    expect(productionChain(c, 'sapphire', 3).blocker).toContain('cannot fund 1 chisel');
    c.members[0].carried.chisel = 1;
    const chain = productionChain(c, 'sapphire', 3);
    expect(chain.blocker).toBeUndefined();
    expect(chain.work).toContainEqual(expect.objectContaining({ action: 'craft', target: 'cut sapphire', amount: 3 }));
    c.members[0].bank['uncut sapphire'] = 0;
    expect(productionChain(c, 'sapphire', 3).blocker).toContain('no complete uncut sapphire supply');
});
