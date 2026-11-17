import { describe, expect, test } from 'bun:test';
import type { AssetStore } from './assets';
import { portraitKey } from './assets';
import { publishPortraitToBucket } from './publish';

function memoryStore() {
    const objects = new Map<string, { cache: string; type: string }>();
    const puts: string[] = [];
    const store: AssetStore = {
        async put(key, _body, type, cache) { puts.push(key); objects.set(key, { cache, type }); },
        async list(prefix) { return [...objects.keys()].filter(k => k.startsWith(prefix)); },
        async remove(keys) { for (const k of keys) objects.delete(k); }
    };
    return { store, objects, puts };
}
const views = (n: number) => Array.from({ length: n }, () => Buffer.from('png'));

describe('publishPortraitToBucket', () => {
    test('uploads every view as an immutable PNG', async () => {
        const { store, objects } = memoryStore();
        expect(await publishPortraitToBucket(store, 'bram', views(16), views(16), 'v1')).toBe(true);
        expect(objects.size).toBe(32);
        expect(objects.get(portraitKey('bram', 'body', 15, 'v1'))).toEqual({ cache: 'public,max-age=31536000,immutable', type: 'image/png' });
    });

    test('a republish of the same version uploads nothing', async () => {
        const { store, puts } = memoryStore();
        await publishPortraitToBucket(store, 'bram', views(16), views(16), 'v1');
        puts.length = 0;
        expect(await publishPortraitToBucket(store, 'bram', views(16), views(16), 'v1')).toBe(true);
        expect(puts).toEqual([]);
    });

    test('a new version replaces the old one but leaves other characters alone', async () => {
        const { store, objects } = memoryStore();
        await publishPortraitToBucket(store, 'wren', views(16), views(16), 'v1');
        await publishPortraitToBucket(store, 'bram', views(16), views(16), 'v1');
        await publishPortraitToBucket(store, 'bram', views(16), views(16), 'v2');
        const keys = [...objects.keys()];
        expect(keys.filter(k => k.includes('/bram/')).every(k => k.endsWith('-v2.png'))).toBe(true);
        expect(keys.filter(k => k.includes('/bram/')).length).toBe(32);
        expect(keys.filter(k => k.includes('/wren/')).length).toBe(32);
    });

    test('an unusable version is refused before anything is written', async () => {
        const { store, objects } = memoryStore();
        expect(await publishPortraitToBucket(store, 'bram', views(1), views(1), '../x')).toBe(false);
        expect(objects.size).toBe(0);
    });
});
