import { expect, test } from 'bun:test';
import { captureGameShot, storeGameShot } from './game-shots';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const url = 'data:image/jpeg;base64,' + jpeg.toString('base64');
test('recovers the exact character tab and captures again in the same cycle', async () => {
    const closed = { isClosed: () => true };
    const wrong = { url: () => 'http://localhost/bot?bot=mike2', evaluate: async () => { throw new Error('wrong tab'); } };
    const live = { url: () => 'http://localhost/bot?bot=mike', evaluate: async () => url };
    const pages = new Map<string, any>([['mike', closed]]);
    expect(await captureGameShot('mike', pages, { pages: async () => [live, wrong] })).toEqual(jpeg);
    expect(pages.get('mike')).toBe(live);
});
test('invalid canvas bytes preserve the last good image instead of being published', async () => {
    const page = { evaluate: async () => 'data:,' };
    await expect(captureGameShot('bram', new Map([['bram', page]]), { pages: async () => [] })).rejects.toThrow('JPEG');
});
test('local capture and published timestamps diverge honestly during a Redis failure', async () => {
    const stamps = { local: 1, remote: 1 };
    const sinks = { local: (_bytes: Buffer, at: number) => { stamps.local = at; }, publish: async () => false, published: (at: number) => { stamps.remote = at; } };
    await storeGameShot(jpeg, 2, sinks); expect(stamps).toEqual({ local: 2, remote: 1 });
    sinks.publish = async () => true;
    await storeGameShot(jpeg, 3, sinks); expect(stamps).toEqual({ local: 3, remote: 3 });
});
