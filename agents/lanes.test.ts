import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'zlib';
import { WriteGate, splitSnapshot } from './lanes';

const remote = (over: Record<string, unknown> = {}, bot: Record<string, unknown> = {}) => ({
    generatedAt: 1000,
    lastEventAt: 900,
    uptimeMin: 5,
    bots: [{ name: 'bram', action: 'mining', actionSince: 10, location: 'Lumbridge', pos: { x: 1, z: 2 }, hp: { cur: 5, max: 9 }, skills: [{ name: 'mining', level: 3 }], ...bot }],
    plan: null,
    log: [{ t: 1 }],
    history: [{ t: 1 }],
    routes: [],
    achievements: [],
    scorecard: [{ t: 'x' }],
    board: [],
    ...over
});

type Pieces = ReturnType<typeof splitSnapshot>;
const piece = (pieces: Pieces, name: string) => pieces.find(p => p.name === name)!;
const body = (pieces: Pieces, name: string) => JSON.parse(gunzipSync(piece(pieces, name).value as Buffer).toString());

describe('splitSnapshot', () => {
    test('the fast lane carries the stamps, location, action and hp, uncompressed', () => {
        const fast = JSON.parse(piece(splitSnapshot(remote()), 'fast').value as string);
        expect(fast).toEqual({ generatedAt: 1000, lastEventAt: 900, uptimeMin: 5, bots: [{ name: 'bram', action: 'mining', actionSince: 10, location: 'Lumbridge', pos: { x: 1, z: 2 }, hp: { cur: 5, max: 9 } }] });
    });

    test('big sections get their own key; the core keeps the rest, minus the fast fields', () => {
        const pieces = splitSnapshot(remote());
        expect(body(pieces, 'scorecard')).toEqual({ scorecard: [{ t: 'x' }] });
        expect(body(pieces, 'log')).toEqual({ log: [{ t: 1 }] });
        const core = body(pieces, 'core');
        expect(core.scorecard).toBeUndefined();
        expect(core.generatedAt).toBeUndefined();
        expect(core.board).toEqual([]);
        expect(core.bots).toEqual([{ name: 'bram', skills: [{ name: 'mining', level: 3 }] }]);
    });

    test('a field nobody planned for lands in the core rather than vanishing', () => {
        expect(body(splitSnapshot(remote({ newThing: 7 })), 'core').newThing).toBe(7);
    });

    test('a moving character changes only the fast fingerprint', () => {
        const a = splitSnapshot(remote());
        const b = splitSnapshot(remote({ generatedAt: 2000, lastEventAt: 1999, uptimeMin: 6 }, { action: 'fishing', pos: { x: 9, z: 9 }, location: 'Draynor' }));
        for (const p of a) expect(piece(b, p.name).fingerprint === p.fingerprint).toBe(p.name !== 'fast');
    });

    test('a new log entry changes only the log fingerprint', () => {
        const a = splitSnapshot(remote());
        const b = splitSnapshot(remote({ log: [{ t: 1 }, { t: 2 }] }));
        for (const p of a) expect(piece(b, p.name).fingerprint === p.fingerprint).toBe(p.name !== 'log');
    });

    test('compression makes a big section much smaller', () => {
        const scorecard = Array.from({ length: 60 }, (_, i) => ({ t: `2026-10-${i}`, name: 'change', note: 'a long repeated note about what changed', xpShare: { making: 0.1, gathering: 0.2 } }));
        const p = piece(splitSnapshot(remote({ scorecard })), 'scorecard');
        expect((p.value as Buffer).length).toBeLessThan(JSON.stringify({ scorecard }).length / 4);
    });
});

describe('WriteGate', () => {
    test('writes the first time, then skips unchanged content', () => {
        const gate = new WriteGate();
        expect(gate.shouldWrite('k', 'a', 0)).toBe(true);
        gate.wrote('k', 'a', 0);
        expect(gate.shouldWrite('k', 'a', 10_000)).toBe(false);
        expect(gate.shouldWrite('k', 'b', 10_000)).toBe(true);
    });

    test('a failed write is not remembered, so it is tried again', () => {
        const gate = new WriteGate();
        expect(gate.shouldWrite('k', 'a', 0)).toBe(true);
        expect(gate.shouldWrite('k', 'a', 1)).toBe(true);
    });

    test('a heartbeat rewrites unchanged content once it is due', () => {
        const gate = new WriteGate();
        gate.wrote('k', 'a', 0);
        expect(gate.shouldWrite('k', 'a', 44_000, 45_000)).toBe(false);
        expect(gate.shouldWrite('k', 'a', 45_000, 45_000)).toBe(true);
    });

    test('a key is only looked at once per cadence', () => {
        const gate = new WriteGate();
        expect(gate.due('k', 60_000, 0)).toBe(true);
        expect(gate.due('k', 60_000, 15_000)).toBe(false);
        expect(gate.due('k', 60_000, 45_000)).toBe(false);
        expect(gate.due('k', 60_000, 59_500)).toBe(true);
    });
});
