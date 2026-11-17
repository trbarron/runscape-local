import { expect, test } from 'bun:test';
import { findLongPath, initPathfinding, isTileWalkable } from '../rs-sdk/sdk/pathfinding';
import { SHOPS, renderShops, shopSelling, bestBuyer } from './shops';

initPathfinding();
const START = { x: 3222, z: 3218 }; // Lumbridge castle

test('every shop has stock, a name nobody else uses, and a keeper the party can walk up to', () => {
    expect(new Set(SHOPS.map(s => s.name)).size).toBe(SHOPS.length);
    for (const s of SHOPS) {
        expect(s.items.length, `${s.name} has no stock: check its wiki file name`).toBeGreaterThan(0);
        let reached = false;
        for (let dx = -4; dx <= 4 && !reached; dx++) {
            for (let dz = -4; dz <= 4 && !reached; dz++) {
                if (!isTileWalkable(0, s.x + dx, s.z + dz)) continue;
                const end = findLongPath(0, START.x, START.z, s.x + dx, s.z + dz, 500).at(-1);
                reached = !!end && end.x === s.x + dx && end.z === s.z + dz;
            }
        }
        expect(reached, `${s.name} at ${s.x},${s.z} cannot be walked to from Lumbridge`).toBe(true);
    }
});

test('smithed goods and gems now have a buyer', () => {
    for (const item of ['Bronze scimitar', 'Iron platelegs', 'Steel chainbody', 'Iron mace', 'Steel battleaxe', 'Mithril 2h sword', 'Uncut sapphire', 'Gold ring']) {
        expect(bestBuyer(item) ?? shopSelling(item), `nobody buys ${item}`).toBeTruthy();
    }
});

test('the atlas lists every shop', () => {
    expect(renderShops().split('\n').length).toBe(SHOPS.length);
});
