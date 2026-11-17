import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ANGLES, angleFile, needsPortrait, readManifest, saveManifest } from './portraits/manifest';

test('render cache belongs to its output directory and requires every angle of both figures', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rascals-portrait-'));
    const manifest = { bram: { version: 'look-1', renderedAt: 1 } };
    for (let a = 0; a < ANGLES; a++) writeFileSync(join(dir, angleFile('bram', 'head', a)), 'head');
    expect(needsPortrait('bram', 'look-1', manifest, dir)).toBe(true);
    for (let a = 0; a < ANGLES - 1; a++) writeFileSync(join(dir, angleFile('bram', 'body', a)), 'body');
    expect(needsPortrait('bram', 'look-1', manifest, dir)).toBe(true); // one angle still missing
    writeFileSync(join(dir, angleFile('bram', 'body', ANGLES - 1)), 'body');
    expect(needsPortrait('bram', 'look-1', manifest, dir)).toBe(false);
    expect(needsPortrait('bram', 'look-2', manifest, dir)).toBe(true);
    const other = join(dir, 'other'); mkdirSync(other);
    expect(needsPortrait('bram', 'look-1', manifest, other)).toBe(true);
});

test('rendered and published versions stay separate until publication succeeds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rascals-published-'));
    saveManifest({ bram: { version: 'old', renderedAt: 1 } }, dir, '.published.json');
    saveManifest({ bram: { version: 'new', renderedAt: 2 } }, dir);
    expect(readManifest(dir).bram.version).toBe('new');
    expect(readManifest(dir, '.published.json').bram.version).toBe('old');
    saveManifest(readManifest(dir), dir, '.published.json');
    expect(readManifest(dir, '.published.json').bram.version).toBe('new');
});

test('angle 0 keeps the original file name so single-image readers still work', () => {
    expect(angleFile('wren', 'head', 0)).toBe('wren-head.png');
    expect(angleFile('wren', 'body', 5)).toBe('wren-body-5.png');
});
