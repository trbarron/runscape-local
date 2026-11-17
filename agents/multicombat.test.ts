import { expect, test } from 'bun:test';
import { isMulticombat, parseMulticombat } from './multicombat';
test('zone parser matches server map coordinates, floor and 8x8 boundaries',()=>{
    const multi=parseMulticombat('// comment\n0_48_53_8_16\r\n1_48_53_8_16\n0_48_53_9_16\ngarbage');
    expect(multi(3080,3408,0)).toBe(true);
    expect(multi(3087,3415,1)).toBe(true);
    expect(multi(3088,3415,0)).toBe(false);
    expect(multi(3080,3416,0)).toBe(false);
    expect(multi(3080,3408,2)).toBe(false);
    expect(multi(NaN,3408,0)).toBe(false);
});
test('real server data includes Barbarian Village and excludes Lumbridge cow field',()=>{
    expect(isMulticombat(3080,3415)).toBe(true);
    expect(isMulticombat(3255,3270)).toBe(false);
});
