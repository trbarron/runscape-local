import { describe, expect, test } from 'bun:test';
import { portraitKey, portraitPrefix, shotKey, staleKeys, validVersion } from './assets';

describe('asset keys', () => {
    test('portraits are one object per view and version, under the character prefix', () => {
        const key = portraitKey('bram', 'head', 3, 'abc123');
        expect(key).toBe('images/rascals-live/portraits/bram/head-3-abc123.png');
        expect(key.startsWith(portraitPrefix('bram'))).toBe(true);
    });

    test('a screenshot has one fixed key per character', () => {
        expect(shotKey('wren')).toBe('images/rascals-live/shots/wren.jpg');
    });

    test('only other versions are stale, so the live set and a similar version survive', () => {
        const keys = [portraitKey('bram', 'head', 0, 'abc'), portraitKey('bram', 'body', 15, 'abc'), portraitKey('bram', 'head', 0, 'zabc'), portraitKey('bram', 'head', 0, 'old1')];
        expect(staleKeys(keys, 'abc')).toEqual([portraitKey('bram', 'head', 0, 'zabc'), portraitKey('bram', 'head', 0, 'old1')]);
    });

    test('a version has to be a plain hash', () => {
        expect(validVersion('0a1B2c')).toBe(true);
        for (const bad of ['', '../x', 'a b', 'a/b', 'a.png']) expect(validVersion(bad)).toBe(false);
    });
});
