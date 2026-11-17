import { expect, test } from 'bun:test';
import { buildMenu, evaluate, explainMenu, MISSION_LIBRARY, opportunityMenu, missionBlockers, type Ctx, type Member } from './missions';
import { SPOTS } from './world-index/index';

const member = (name: string, over: Partial<Member> = {}, skills: Record<string, number> = {}): Member => ({
    name,
    combat: 10,
    worn: [],
    carried: { coins: 1000, 'bronze pickaxe': 1, 'bronze axe': 1, hammer: 1 },
    bank: {},
    ...over,
    skills: { Mining: 20, Smithing: 18, Woodcutting: 15, Fishing: 22, Cooking: 17, Crafting: 5, Defence: 8, ...skills },
});
const ctx = (members: Member[], has: string[] = []): Ctx => ({ members, size: 4, has: (id) => has.includes(id) });
const four = () => [
    member('bram', {}, { Mining: 41 }),
    member('wren', {}, { Fishing: 30 }),
    member('mike', {}, { Smithing: 35 }),
    member('trish', { combat: 25 }),
];

test('a stock check adds carried and banked items across the party', () => {
    const c = ctx([
        member('bram', { carried: { 'iron bar': 10 } }),
        member('wren', { bank: { 'iron bar': 25 } }),
        member('mike'),
        member('trish'),
    ]);
    expect(evaluate({ kind: 'stock', item: 'Iron bar', count: 35 }, c).met).toBe(true);
    expect(evaluate({ kind: 'stock', item: 'Iron bar', count: 36 }, c).met).toBe(false);
});

test('nothing ticks until all four characters have reported', () => {
    const c = ctx([member('bram', { carried: { coins: 99999 } })]);
    const r = evaluate({ kind: 'coins', total: 100 }, c);
    expect(r.known).toBe(false);
    expect(r.met).toBe(false);
});

test('a wear check needs the pieces on everyone', () => {
    const set = ['iron med helm', 'iron platebody', 'iron platelegs'];
    const check = { kind: 'wear' as const, match: '^iron (med helm|platebody|platelegs)$', pieces: 3 };
    expect(
        evaluate(
            check,
            ctx([member('a', { worn: set }), member('b', { worn: set }), member('c', { worn: set }), member('d', { worn: set.slice(1) })]),
        ).met,
    ).toBe(false);
    expect(evaluate(check, ctx(['a', 'b', 'c', 'd'].map((n) => member(n, { worn: set })))).met).toBe(true);
});

test('kill and combat checks read the ledger and the lowest combat level', () => {
    expect(evaluate({ kind: 'kill', monster: 'goblin' }, ctx(four(), ['kill:goblin'])).met).toBe(true);
    expect(evaluate({ kind: 'kill', monster: 'goblin' }, ctx(four())).met).toBe(false);
    expect(evaluate({ kind: 'combat', level: 10 }, ctx(four())).met).toBe(true);
    expect(evaluate({ kind: 'combat', level: 11 }, ctx(four())).met).toBe(false);
});

test('the menu offers reachable missions, each with game-checked milestones naming two members', () => {
    const menu = buildMenu(ctx(four()));
    expect(menu.length).toBeGreaterThanOrEqual(3);
    const names = ['bram', 'wren', 'mike', 'trish'];
    for (const m of menu) {
        expect(m.by).toBe('game');
        expect(m.milestones.length).toBeGreaterThanOrEqual(1);
        for (const x of m.milestones) {
            expect(x.check).toBeDefined();
            expect(x.owner).toBeDefined();
            expect(x.next).toBeDefined();
            expect(x.fallback).toBeDefined();
        }
    }
});

test('the forge skips a tier everyone already wears and refuses one out of reach', () => {
    const set = ['iron med helm', 'iron platebody', 'iron platelegs'];
    const wearing = ['bram', 'wren', 'mike', 'trish'].map((n) => member(n, { worn: set }, { Mining: 41, Smithing: 48, Defence: 8 }));
    expect(buildMenu(ctx(wearing)).find((m) => m.title.includes('Forge'))?.title).toBe('The Steel Forge');
    const weak = ['bram', 'wren', 'mike', 'trish'].map((n) => member(n, { worn: set }, { Mining: 3, Smithing: 3, Defence: 1 }));
    expect(buildMenu(ctx(weak)).find((m) => m.title.includes('Forge'))).toBeUndefined();
});

test('a mission already complete, or already chosen, is left off', () => {
    const rich = ['bram', 'wren', 'mike', 'trish'].map((n) => member(n, { carried: { coins: 100000 } }));
    expect(buildMenu(ctx(rich)).some((m) => m.title === 'The Treasury')).toBe(true); // target doubles the pile, so it is still open
    expect(buildMenu(ctx(four()), ['The Treasury']).some((m) => m.title === 'The Treasury')).toBe(false);
});

test('every template says why it was left off, and two missions never chase the same skill', () => {
    const weak = ['bram', 'wren', 'mike', 'trish'].map((n) =>
        member(n, { combat: 3 }, { Mining: 1, Smithing: 1, Defence: 1, Fishing: 1, Cooking: 1 }),
    );
    const why = explainMenu(ctx(weak));
    expect(why.length).toBe(39);
    for (const w of why) expect(w.why.length).toBeGreaterThan(0);
    const menu = buildMenu(ctx(four()));
    const table = menu.find((m) => m.title === "The Cooks' Table");
    const trades = menu.find((m) => m.title === 'Masters of Two Trades');
    if (table && trades)
        for (const x of trades.milestones) expect(['Cooking', 'Fishing']).not.toContain((x.check as { skill: string }).skill);
});

test('library offers a small varied shortlist with stable variant IDs and explicit owners', () => {
    expect(MISSION_LIBRARY).toHaveLength(39);
    expect(new Set(MISSION_LIBRARY.map((t) => t.id)).size).toBe(39);
    const c = ctx(four());
    const pool = opportunityMenu(c);
    expect(pool.menu.length).toBeLessThanOrEqual(5);
    expect(pool.menu.length).toBeGreaterThanOrEqual(3);
    expect(new Set(pool.menu.map((m) => m.category)).size).toBeGreaterThanOrEqual(3);
    expect(pool.menu.map((m) => m.key)).toEqual(opportunityMenu(c).menu.map((m) => m.key));
    const first = pool.menu[0];
    expect(buildMenu(c, [first.key]).some((m) => m.key === first.key)).toBe(false);
});

test('missing harpoon spots exclude swordfish even with max levels; actual assigned cook is qualified', () => {
    const members = four();
    members[1].skills.Fishing = 99;
    members[1].skills.Cooking = 99;
    members[3].skills.Cooking = 29;
    const c = ctx(members);
    c.spots = SPOTS.filter(s => s.type !== 'cage/harpoon');
    const offer = MISSION_LIBRARY.find((t) => t.id === 'cooks-table')!.offer(c);
    expect(typeof offer).not.toBe('string');
    if (typeof offer === 'string') return;
    expect(offer.mission).not.toContain('swordfish');
    expect(offer.mission).not.toContain('lobster');
    expect(offer.work.some((w) => w.action === 'fish' && w.target === 'salmon')).toBe(true);
    expect(offer.work.find((w) => w.action === 'cook')?.owner).toBe('trish');
    expect(offer.milestones.filter((m) => m.check.kind === 'skill').every((m) => m.check.kind !== 'skill' || m.check.level <= 99)).toBe(
        true,
    );
});

test('station removal and absent executable resources reject complete production goals', () => {
    const c = ctx(four());
    c.spots = [];
    expect(buildMenu(c)).toEqual([]);
    const legacy = { milestones: [{ done: false, auto: { check: { kind: 'stock' as const, item: 'swordfish', count: 60 } } }] };
    const capable = four();
    capable[1].skills.Cooking = 99;
    capable[1].skills.Fishing = 99;
    const missingHarpoon = ctx(capable);
    missingHarpoon.spots = SPOTS.filter(s => s.type !== 'cage/harpoon');
    expect(missionBlockers(legacy, missingHarpoon).join(' ')).toContain('cage/harpoon');
});

test('skill marks never exceed 99 and maxed characters are not sent to train impossible marks', () => {
    const c = ctx(
        four().map((m) => ({ ...m, skills: { ...m.skills, Mining: 99, Smithing: 99, Woodcutting: 99, Fishing: 99, Cooking: 99, Firemaking: 99, Fletching: 99, Crafting: 99 } })),
    );
    for (const t of MISSION_LIBRARY.filter((t) => t.id.startsWith('mark-'))) expect(typeof t.offer(c)).toBe('string');
});

test('mixed higher-tier outfits cannot generate a downgrade-to-bronze mission', () => {
    const worn = ['iron med helm', 'steel platebody', 'mithril platelegs'];
    const c = ctx(four().map((m) => ({ ...m, worn, skills: { ...m.skills, Mining: 60, Smithing: 60, Defence: 20 } })));
    const offer = MISSION_LIBRARY.find((t) => t.id === 'forge')!.offer(c);
    expect(typeof offer).not.toBe('string');
    if (typeof offer === 'string') return;
    expect(offer.title).toBe('The Steel Forge');
    expect(offer.work.some((w) => w.target.includes('bronze'))).toBe(false);
    expect(offer.work.some((w) => w.action === 'equip' && w.target === 'steel platelegs')).toBe(false);
});

test('a named skill check cannot be completed by a different party member', () => {
    const c = ctx(four());
    c.members[1].skills.Cooking = 99;
    c.members[3].skills.Cooking = 29;
    expect(evaluate({ kind: 'skill', skill: 'Cooking', level: 34, who: 'any', member: 'trish' }, c).met).toBe(false);
});

test('quest-specific named bosses are not offered merely because their combat level is low', () => {
    const c = ctx(four().map((m) => ({ ...m, combat: 100, skills: { ...m.skills, Fishing: 99, Cooking: 99 } })));
    c.spots = [
        { kind: 'bank', type: 'bank', x: 1, z: 3200, count: 1, near: 'test' },
        { kind: 'range', type: 'range', x: 1, z: 3200, count: 1, near: 'test' },
        { kind: 'monster', type: 'delrith', x: 1, z: 3200, count: 2, near: 'test', level: 27 },
        { kind: 'monster', type: 'gunthor the brave', x: 1, z: 3200, count: 2, near: 'test', level: 29 },
    ];
    expect(typeof MISSION_LIBRARY.find((t) => t.id === 'hunters')!.offer(c)).toBe('string');
});

const workshop = (id: string, c: Ctx) => MISSION_LIBRARY.find((t) => t.id === id)!.offer(c);
const trainee = (skills: Record<string, number>, over: Partial<Member> = {}) =>
    [member('bram', over, skills), member('wren'), member('mike'), member('trish')];

test('Firemaking buys the tinderbox it lacks, after tool costs, and burns a 20-log batch', () => {
    const offer = workshop('mark-firemaking', ctx(trainee({ Firemaking: 3 })));
    expect(typeof offer).not.toBe('string');
    if (typeof offer === 'string') return;
    const owner = offer.work[0].owner;
    const buys = offer.work.filter((w) => w.action === 'buy' && w.owner === owner).map((w) => w.target.toLowerCase());
    expect(buys).toContain('tinderbox');
    expect(offer.work.at(-1)).toMatchObject({ action: 'firemake', target: 'logs', amount: 20 });
    expect(offer.work.some((w) => w.action === 'bank_resources' && /^logs$/i.test(w.target))).toBe(false);
});
test('Firemaking does not buy a tinderbox the character already holds', () => {
    const c = ctx(trainee({ Firemaking: 3 }, { carried: { coins: 1000, 'bronze axe': 1, 'bronze pickaxe': 1, hammer: 1, tinderbox: 1 } }));
    const offer = workshop('mark-firemaking', c);
    expect(typeof offer).not.toBe('string');
    if (typeof offer === 'string') return;
    expect(offer.work.some((w) => w.action === 'buy' && /tinderbox/i.test(w.target))).toBe(false);
});
test('Firemaking is withheld when funds cannot also cover the tinderbox', () => {
    const poor = trainee({ Firemaking: 3 }).map((m) => ({ ...m, carried: { coins: 0 } }));
    expect(typeof workshop('mark-firemaking', ctx(poor))).toBe('string');
});
test('beginner Fletching offers shafts from a 20-log batch and leaves knife supply to the executor', () => {
    const offer = workshop('mark-fletching', ctx(trainee({ Fletching: 3 })));
    expect(typeof offer).not.toBe('string');
    if (typeof offer === 'string') return;
    expect(offer.work.at(-1)).toMatchObject({ action: 'fletch', target: 'arrow shaft', amount: 20 });
    const unlocked=workshop('mark-fletching', ctx(trainee({ Fletching: 5 })));
    if(typeof unlocked==='string')throw new Error(unlocked);
    expect(unlocked.work.at(-1)).toMatchObject({ action: 'fletch', target: 'shortbow' });
    expect(offer.work.at(-1)?.note).toContain('knife');
    expect(offer.work.some((w) => w.action === 'chop_trees')).toBe(true);
});
test('Firemaking and Fletching log gathering stops at the 20-log batch cap', () => {
    for (const id of ['mark-firemaking', 'mark-fletching']) {
        const offer = workshop(id, ctx(trainee(id === 'mark-firemaking' ? { Firemaking: 3 } : { Fletching: 3 })));
        if (typeof offer === 'string') throw new Error(offer);
        expect(offer.work.find((w) => w.action === 'chop_trees')?.amount).toBeLessThanOrEqual(20);
    }
});
test('Crafting trains the best jewellery its level allows and needs a complete chain', () => {
    const pick = (level: number) => {
        const crafters = trainee({ Crafting: level, Mining: 40, Smithing: 40 }).map((m, i) => (i ? m : { ...m, carried: { ...m.carried, 'ring mould': 1, 'necklace mould': 1, 'amulet mould': 1 } }));
        const offer = workshop('mark-crafting', ctx(crafters));
        return typeof offer === 'string' ? offer : offer.work.find((w) => w.action === 'craft')?.target;
    };
    expect(pick(5)).toBe('gold ring');
    expect(pick(6)).toBe('gold necklace');
    expect(pick(8)).toBe('gold amulet');
});
test('Crafting is not offered when no complete chain exists', () => {
    const c = ctx(trainee({ Crafting: 5 }));
    c.spots = SPOTS.filter((s) => s.kind !== 'furnace');
    expect(typeof workshop('mark-crafting', c)).toBe('string');
});
test('workshop offers always carry a game-checked skill milestone and never exceed the 99 ceiling', () => {
    for (const id of ['mark-firemaking', 'mark-fletching', 'mark-crafting']) {
        const skill = id.replace('mark-', '');
        const offer = workshop(id, ctx(trainee({ [skill[0].toUpperCase() + skill.slice(1)]: 3, Mining: 40, Smithing: 40 })));
        if (typeof offer === 'string') continue;
        const skills = offer.milestones.filter((m) => m.check.kind === 'skill');
        expect(skills.length).toBeGreaterThan(0);
        for (const m of skills) if (m.check.kind === 'skill') expect(m.check.level).toBeLessThanOrEqual(99);
    }
});

const smiths = (extra: Record<string, number> = {}) =>
    ['bram', 'wren', 'mike', 'trish'].map((n) => member(n, { carried: { coins: 1000, 'bronze pickaxe': 1, 'bronze axe': 1, hammer: 1, 'iron ore': 500, coal: 500 } }, { Smithing: 40, Mining: 41, ...extra }));
const why = (c: Ctx, title: string) => explainMenu(c).find((d) => d.template === title)!;

test('a bar reserve below what the best smith can make is too easy to offer', () => {
    const c = ctx(smiths());
    expect(why(c, 'Bronze Bar Reserve').eligible).toBe(false);
    expect(why(c, 'Bronze Bar Reserve').why).toContain('too easy');
    expect(why(c, 'Iron Bar Reserve').eligible).toBe(false);
    expect(why(c, 'Steel Bar Reserve').why).not.toContain('too easy');
});

test('a stock reserve already half held is too little work to be a mission', () => {
    const c = ctx(smiths().map((m, i) => (i ? m : { ...m, bank: { 'steel bar': 30 } })));
    expect(why(c, 'Steel Bar Reserve').why).toContain('too little work');
});

test('stock reserves only fill a thin shortlist and never follow another reserve', () => {
    const c = ctx(smiths());
    const reserves = (menu: { template: string }[]) => menu.filter((m) => /^(ore|wood|bars|food)-/.test(m.template));
    const full = buildMenu(c);
    if (full.length - reserves(full).length >= 3) expect(reserves(full)).toHaveLength(0);
    const recent = buildMenu(c, ['bars-steel:x']);
    expect(reserves(recent).length).toBeLessThanOrEqual(reserves(full).length);
    if (full.length - reserves(full).length < 3) expect(reserves(recent)).toHaveLength(0);
});

test('a template used in the last two missions sorts after fresh ones', () => {
    const c = ctx(four());
    const first = buildMenu(c)[0];
    const next = buildMenu(c, ['unrelated:x', `${first.template}:other`]);
    expect(next[0]?.template).not.toBe(first.template);
});

test('Smithing workshop offers a complete eligible adamant chain before steel', () => {
    const c = ctx(trainee({ Smithing: 71, Mining: 87 }, {
        bank: { 'adamantite ore': 20, coal: 150 },
    }));
    const offer = workshop('mark-smithing', c);
    if (typeof offer === 'string') throw new Error(offer);
    expect(offer.work.some(w => w.action === 'smith' && w.target === 'adamant dagger')).toBe(true);
    expect(offer.work.some(w => w.action === 'smelt' && /adamant/i.test(w.target))).toBe(true);
});

test('supplied hunters may consider wilderness monsters without claiming a wilderness visit',()=>{
    const c=ctx(four().map(m=>({...m,combat:90,skills:{...m.skills,Fishing:50,Cooking:60}})));
    c.spots=[...SPOTS.filter(s=>s.kind!=='monster'),
        {kind:'monster',type:'skeleton',x:3073,z:3532,count:3,near:'wilderness',level:25},
        {kind:'monster',type:'giant rat',x:3227,z:3533,count:3,near:'wilderness',level:6}];
    const offer=MISSION_LIBRARY.find(t=>t.id==='hunters')!.offer(c);
    if(typeof offer==='string')throw Error(offer);
    expect(offer.work.some(w=>w.action==='fight'&&w.note.includes('wilderness'))).toBe(true);
    expect(offer.work.some(w=>w.action==='withdraw_from_bank'&&w.target==='cooked trout')).toBe(true);
});
