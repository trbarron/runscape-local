import { expect, test } from 'bun:test';
import { idlePass, stepTimeLimit, withStallCause } from './execution-outcomes';

test('productive skill and count goals yield without declaring completion or failure', () => {
    for (const type of ['skill_level', 'gathered', 'exhausted']) {
        expect(stepTimeLimit(type, true)).toMatchObject({ kind: 'yielded' });
        expect(stepTimeLimit(type, true).why).toContain('unfinished');
    }
    expect(stepTimeLimit('minutes', true).kind).toBe('done');
    expect(stepTimeLimit('skill_level', false).kind).toBe('stuck');
});

test('an unproductive non-minute goal is stuck, and its reason mentions the missing progress', () => {
    const r = stepTimeLimit('gathered', false);
    expect(r.kind).toBe('stuck');
    expect(r.why).toContain('no measured work progress');
});
test('minute goals complete whether or not measured progress was made', () => {
    expect(stepTimeLimit('minutes', false)).toEqual({ kind: 'done', why: '' });
    expect(stepTimeLimit('minutes', true)).toEqual({ kind: 'done', why: '' });
});
test('a yield is neither a completion nor a failure', () => {
    const r = stepTimeLimit('skill_level', true);
    expect(r.kind).not.toBe('done');
    expect(r.kind).not.toBe('stuck');
    expect(r.why).toContain('resume');
});

test('three consecutive passes without progress make a goal stuck', () => {
    let n = 0;
    for (let i = 1; i <= 2; i++) {
        const r = idlePass('mine', false, n);
        expect(r.stuck).toBeNull();
        n = r.idlePasses;
    }
    const third = idlePass('mine', false, n);
    expect(third.stuck).toMatchObject({ kind: 'stuck' });
    expect(third.idlePasses).toBe(3);
});
test('a productive pass resets the idle count', () => {
    expect(idlePass('mine', true, 2)).toEqual({ idlePasses: 0, stuck: null });
    const after = idlePass('mine', false, idlePass('mine', true, 2).idlePasses);
    expect(after).toEqual({ idlePasses: 1, stuck: null });
});
test('resting never counts as an idle pass', () => {
    expect(idlePass('rest', false, 2)).toEqual({ idlePasses: 0, stuck: null });
});

test('a stuck report names the last recorded cause, and is unchanged without one', () => {
    const stuck = idlePass('pickpocket', false, 2).stuck!;
    expect(withStallCause(stuck, 'Pickpocket dispatch failed [dispatch_failed]').why).toBe('three passes in a row with no progress (last cause: Pickpocket dispatch failed [dispatch_failed])');
    expect(withStallCause(stuck)).toBe(stuck);
    expect(withStallCause(stuck, '').kind).toBe('stuck');
});
