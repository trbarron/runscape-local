import { expect, test } from 'bun:test';
import { openSeller, openShopAt, type Ctx } from './skills';
import { SHOPS, type Shop } from './shops';

const context = (opens: { success: boolean; message: string }[], shop: Shop) => {
    let attempts = 0, resets = 0;
    const controller = new AbortController();
    const c = { name: 'recovery-test', deadline: Date.now() + 60_000, signal: controller.signal, notes: [],
        sdk: { getState: () => ({ player: { worldX: shop.x, worldZ: shop.z } }), sendCloseModal: async () => { resets++; }, waitForTicks: async () => {} },
        bot: { openShop: async () => opens[Math.min(attempts++, opens.length - 1)] }
    } as unknown as Ctx;
    return { c, controller, attempts: () => attempts, resets: () => resets };
};
const shop = (name: string): Shop => ({ name, x: 3229, z: 3437, items: [] });

test('retry a temporary shop timeout once, resetting the interface first', async () => {
    const s = shop('temporary test shop');
    const f = context([{ success: false, message: 'Timed out waiting for shop to open' }, { success: true, message: 'opened' }], s);
    expect(await openShopAt(f.c, s)).toBeUndefined();
    expect(f.attempts()).toBe(2); expect(f.resets()).toBe(1);
});

test('bound repeated failures and cool the shop down across later calls', async () => {
    const s = shop('cooldown test shop'); const f = context([{ success: false, message: 'Timed out waiting for shop to open' }], s);
    expect(await openShopAt(f.c, s)).toContain('bounded recovery');
    expect(f.attempts()).toBe(2);
    expect(await openShopAt(f.c, s)).toContain('five-minute cooldown');
    expect(f.attempts()).toBe(2);
});

test('do not retry a permanent failure or an aborted operation', async () => {
    const s = shop('permanent test shop'); const f = context([{ success: false, message: 'Access denied' }], s);
    expect(await openShopAt(f.c, s)).toContain('Access denied'); expect(f.attempts()).toBe(1);
    f.controller.abort(); await openShopAt(f.c, s); expect(f.attempts()).toBe(1);
});

test('a failed seller can fall back to one other known shop without buying', async () => {
    const price = (s: Shop) => s.items.find(i => i.name === 'Tinderbox')!.price;
    const all = SHOPS.filter(s => s.items.some(i => i.name === 'Tinderbox')).sort((a, b) => price(a) - price(b));
    // The character starts at the cheapest seller; equal prices are tried nearest first, as openSeller does.
    const start = all[0];
    const sellers = [...all].sort((a, b) => price(a) - price(b) || Math.hypot(a.x - start.x, a.z - start.z) - Math.hypot(b.x - start.x, b.z - start.z));
    expect(sellers.length).toBeGreaterThan(1);
    const f = context([{ success: false, message: 'Timed out waiting for shop to open' }, { success: false, message: 'Timed out waiting for shop to open' }, { success: true, message: 'opened' }], sellers[0]);
    // Mock the successful relocation between known sellers; buying remains outside this helper.
    (f.c.bot as any).walkTo = async (x: number, z: number) => { (f.c.sdk as any).getState = () => ({ player: { worldX: x, worldZ: z } }); return { success: true }; };
    // goNear uses pathfinding only for actual movement; simulate position at the requested shop.
    const original = (f.c.sdk as any).getState;
    (f.c.sdk as any).getState = () => ({ player: { ...original().player, worldX: sellers[Math.min(Math.floor(f.attempts() / 2), 1)].x, worldZ: sellers[Math.min(Math.floor(f.attempts() / 2), 1)].z } });
    const result = await openSeller(f.c, 'Tinderbox');
    expect(typeof result).toBe('object');
    expect(f.attempts()).toBe(3);
});

test('a thrown timeout is recovered just like a returned timeout', async () => {
    const s = shop('thrown timeout test shop'); const f = context([{ success: true, message: 'opened' }], s);
    let calls = 0;
    (f.c.bot as any).openShop = async () => { if (++calls === 1) throw new Error('timeout while opening shop'); return { success: true }; };
    expect(await openShopAt(f.c, s)).toBeUndefined();
    expect(calls).toBe(2); expect(f.resets()).toBe(1);
});
