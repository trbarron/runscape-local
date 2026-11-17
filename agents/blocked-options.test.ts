import { expect, test } from 'bun:test';
import { blockedOption, rememberBlockedOption, renderBlockedOptions, BLOCK_OPTION_MS, type BlockedOption, type OptionFacts } from './blocked-options';
const now = 1_000_000;
const withdraw = { action: 'withdraw_from_bank', args: { target: 'Bronze med helm' } };
const missing = 'your known bank has no Bronze med helm; choose available stock, buy it or arrange a handoff';
const facts = (): OptionFacts => ({ inventory: [{ name: 'Coins', count: 50 }], skills: [{ name: 'Defence', baseLevel: 1 }, { name: 'Mining', baseLevel: 20 }], bank: { t: 1, items: { Coins: 500, 'Iron ore': 50 } } });
const remembered = () => { const options: BlockedOption[] = []; rememberBlockedOption(options, withdraw, missing, facts(), now); return options; };

test('same absent bank item stays excluded across renamed routines, quantities and unrelated changes', () => {
    const options = remembered(); const changed = facts();
    changed.inventory.push({ name: 'Iron ore', count: 1 }); changed.inventory[0].count += 50; changed.skills[1].baseLevel++;
    expect(blockedOption(options, { ...withdraw, args: { target: ' bronze\u00ad med helm ', amount: 5 } }, changed, now + 1)).toBeDefined();
    expect(blockedOption(options, { action: 'buy', args: withdraw.args }, changed, now + 1)).toBeUndefined();
    expect(renderBlockedOptions(options, changed, now + 1)).toContain('arrange a delivery');
});

test('actual delivery and changed bank stock invalidate the old observation', () => {
    for (const change of [
        (f: OptionFacts) => f.inventory.push({ name: 'Bronze med helm', count: 1 }),
        (f: OptionFacts) => { f.bank!.items['Bronze med helm'] = 1; },
    ]) { const f = facts(); change(f); expect(blockedOption(remembered(), withdraw, f, now + 1)).toBeUndefined(); }
});

test('a suppressed attempt never refreshes expiry; an expired observation permits reconsideration', () => {
    const options = remembered();
    expect(rememberBlockedOption(options, withdraw, missing, facts(), now + 1000)).toBe(false);
    expect(options[0].expiresAt).toBe(now + BLOCK_OPTION_MS);
    expect(blockedOption(options, withdraw, facts(), now + BLOCK_OPTION_MS)).toBeUndefined();
    expect(rememberBlockedOption(options, withdraw, missing, facts(), now + BLOCK_OPTION_MS)).toBe(true);
});

test('material constraints only unlock on relevant supplies', () => {
    const options: BlockedOption[] = []; const smith = { action: 'smith', args: { target: 'bronze platebody' } };
    rememberBlockedOption(options, smith, 'preparation: needs 5 bronze bar; not enough usable stock in your own bank and no automatic purchase available', facts(), now);
    const f = facts(); f.inventory.push({ name: 'Logs', count: 10 });
    expect(blockedOption(options, smith, f, now + 1)).toBeDefined();
    f.inventory.push({ name: 'Bronze bar', count: 5 });
    expect(blockedOption(options, smith, f, now + 2)).toBeUndefined();
});

test('required level changes unlock equipment; unrelated skill training does not', () => {
    const options: BlockedOption[] = []; const equip = { action: 'equip', args: { target: 'steel med helm' } };
    rememberBlockedOption(options, equip, 'steel med helm needs Defence 5 (you are 1)', facts(), now);
    const f = facts(); f.skills[1].baseLevel++;
    expect(blockedOption(options, equip, f, now + 1)).toBeDefined();
    f.skills[0].baseLevel = 5;
    expect(blockedOption(options, equip, f, now + 2)).toBeUndefined();
});

test('a cheaper purchase is a different option, and funding unlocks the original one', () => {
    const options: BlockedOption[] = []; const buy = { action: 'buy', args: { target: 'Fishing bait', amount: 1000 } };
    rememberBlockedOption(options, buy, 'purchases exceed carried and banked coins by 450', facts(), now);
    expect(blockedOption(options, { ...buy, args: { ...buy.args, amount: 10 } }, facts(), now + 1)).toBeUndefined();
    const f = facts(); f.inventory[0].count += 500;
    expect(blockedOption(options, buy, f, now + 2)).toBeUndefined();
});

test('transient and safety failures are not memorized as infeasibility', () => {
    for (const reason of ['Smithing timed out', 'HP 5/20, out of food: ran to safety', 'trade failed: Player not found nearby: mike', 'three passes in a row with no progress', 'preparation limit reached; reassess this routine'])
        expect(rememberBlockedOption([], withdraw, reason, facts(), now)).toBe(false);
});

test('persisted records survive serialization, are bounded, and remain character-local', () => {
    const a = remembered(); const b: BlockedOption[] = [];
    expect(blockedOption(b, withdraw, facts(), now + 1)).toBeUndefined();
    expect(blockedOption(JSON.parse(JSON.stringify(a)), withdraw, facts(), now + 1)).toBeDefined();
    for (let i = 0; i < 30; i++) rememberBlockedOption(a, { ...withdraw, args: { target: `absent item ${i}` } }, 'your known bank has no item', facts(), now);
    expect(a.length).toBe(24);
});

test('newly worn equipment clears a stale missing-item exclusion', () => {
    const f = facts(); f.equipment = [{ name: 'Bronze med helm', count: 1 }];
    expect(blockedOption(remembered(), withdraw, f, now + 1)).toBeUndefined();
});

test('typed material alternatives invalidate a generic raw-food blocker on delivery or usable-level gain', () => {
    const options: BlockedOption[] = [];
    const f = facts();
    f.skills.push({ name: 'Cooking', baseLevel: 1 });
    const cook = { action: 'cook', args: { target: null } };
    rememberBlockedOption(
        options,
        cook,
        'needs 1 raw fish you can cook; not enough usable stock in your own bank and no automatic purchase available',
        f,
        now,
        { pattern: '^raw (shrimps|anchovies)$', flags: 'i', skill: 'Cooking' },
    );
    const delivered = JSON.parse(JSON.stringify(f)) as OptionFacts;
    delivered.inventory.push({ name: 'Raw shrimps', count: 1 });
    expect(blockedOption([...options], cook, delivered, now + 1)).toBeUndefined();
    f.skills.find((s) => s.name === 'Cooking')!.baseLevel = 25;
    expect(blockedOption(options, cook, f, now + 1)).toBeUndefined();
});

test('unrelated bank visits do not revive absent ingredients', () => {
    const options = remembered(), f = facts();
    f.bank!.t += 60000; f.bank!.items['Logs'] = 100;
    expect(blockedOption(options, withdraw, f, now + 1)).toBeDefined();
    f.bank!.items['Bronze med helm'] = 1;
    expect(blockedOption(options, withdraw, f, now + 2)).toBeUndefined();
});

test('unsupported recipes stay blocked despite new bars, but alternatives and expiry remain available', () => {
    const options: BlockedOption[] = [], step = {action:'smith',args:{target:'silver dagger'}};
    expect(rememberBlockedOption(options,step,'unknown smithing recipe silver dagger; name the metal and item',facts(),now)).toBe(true);
    const f = facts(); f.bank!.t++; f.bank!.items['Silver bar'] = 20;
    expect(blockedOption(options,step,f,now+1)).toBeDefined();
    expect(blockedOption(options,{action:'smith',args:{target:'iron dagger'}},f,now+1)).toBeUndefined();
    expect(blockedOption(options,step,f,now+BLOCK_OPTION_MS)).toBeUndefined();
});
