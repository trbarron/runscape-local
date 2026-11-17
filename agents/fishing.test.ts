import { expect, test } from 'bun:test';
import { FISHING, fishMethod } from './fishing';

test('each catch has its exact Fishing level', () => {
    const levels: Record<string, number> = {
        net: 1, anchovies: 15, sardine: 5, herring: 10, trout: 20, pike: 25, salmon: 30, tuna: 35, lobster: 40, swordfish: 50,
    };
    for (const [method, level] of Object.entries(levels)) {
        if (FISHING[method]) expect(FISHING[method].level).toBe(level);
    }
    for (const method of ['trout', 'pike', 'salmon', 'tuna', 'lobster', 'swordfish']) expect(FISHING[method]).toBeDefined();
});
test('the generic lure entry is no higher than the species it contains, and salmon is stricter than trout', () => {
    expect(FISHING.salmon.level).toBeGreaterThan(FISHING.trout.level);
    expect(FISHING.trout.level).toBe(20);
});
test('only the Musa Point cage/harpoon methods are ferry-backed', () => {
    for (const [name, method] of Object.entries(FISHING)) {
        expect(method.via === 'Karamja').toBe(method.spot === 'cage/harpoon');
        if (method.via) expect(['harpoon', 'tuna', 'swordfish', 'cage', 'lobster']).toContain(name);
    }
});
test('harpoon species and lobster share a spot type with different options and tools', () => {
    expect(FISHING.tuna.option.test('harpoon')).toBe(true);
    expect(FISHING.swordfish.option.test('harpoon')).toBe(true);
    expect(FISHING.lobster.option.test('cage')).toBe(true);
    expect(FISHING.lobster.tools[0][0]).toBe('lobster pot');
    expect(FISHING.swordfish.tools[0][0]).toBe('harpoon');
});
test('method lookup keeps old aliases and falls back to net', () => {
    expect(fishMethod('swordfish')).toBe('swordfish');
    expect(fishMethod('lobster')).toBe('lobster');
    expect(fishMethod(null)).toBe('net');
    expect(fishMethod('Harpoon')).toBe('harpoon');
});
