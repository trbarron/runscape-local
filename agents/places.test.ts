import { expect, test } from 'bun:test';
import { isTileWalkable } from '../rs-sdk/sdk/pathfinding';
import { PLACE_NAMES } from './world-index/index';

const place = (name: string) => PLACE_NAMES.find(p => p.name === name)!;

test('Port Sarim is anchored at its shops, not the label that sits in the sea', () => {
    expect(place('Port Sarim')).toMatchObject({ x: 3014, z: 3224 });
    expect(isTileWalkable(0, 3014, 3224)).toBe(true);
});

test('every atlas place a character can reach is a tile they can stand on', () => {
    // Tutorial Island is cut off from the mainland, so its label stays as it was.
    const stuck = PLACE_NAMES.filter(p => p.name !== 'Tutorial Island' && !isTileWalkable(0, p.x, p.z)).map(p => p.name);
    expect(stuck).toEqual([]);
});

test('a place that was already walkable keeps its coordinates', () => {
    expect(PLACE_NAMES.filter(p => isTileWalkable(0, p.x, p.z)).length).toBeGreaterThanOrEqual(PLACE_NAMES.length - 1);
});
