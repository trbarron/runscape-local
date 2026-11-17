import { expect, test } from 'bun:test';
import { assignCoverage, missingOwners } from './mission-coordination';
import type { TeamGoal } from './memory';
const goal = {
    mission: 'supply food',
    milestones: [
        {
            id: 1,
            what: '60 trout',
            needs: 'a fishes; b cooks',
            done: false,
            owner: 'b',
            next: { owner: 'a', action: 'fish', target: 'lure', note: 'catch fish' },
        },
        { id: 2, what: 'old', needs: '', done: true },
    ],
    work: [
        { owner: 'a', action: 'buy', target: 'Feather', note: 'buy own feathers' },
        { owner: 'b', action: 'cook', target: 'raw trout', note: 'cook supplied fish' },
    ],
} as TeamGoal;
test('council agreement alone does not cover an unowned open milestone', () => {
    const claims = new Map([['a', { commitment: 'mining', milestone_ids: [] }]]);
    expect(missingOwners(goal, claims.values())).toEqual([1]);
    const coverage = assignCoverage(goal, claims, ['a', 'b']);
    expect(coverage).toHaveLength(1);
    expect(coverage[0].owner).toBe('b');
    expect(coverage[0].source).toBe('suggested');
    expect(coverage[0].next).toContain('cook');
});
test('a character can accept accountability explicitly and receives their own concrete chain step', () => {
    const claims = new Map([['a', { commitment: 'buy feathers and fish', milestone_ids: [1] }]]);
    expect(missingOwners(goal, claims.values())).toEqual([]);
    const c = assignCoverage(goal, claims, ['a', 'b'])[0];
    expect(c.owner).toBe('a');
    expect(c.source).toBe('council');
    expect(c.next).toContain('Feather');
    expect(c.fallback).toBeTruthy();
});

test('a rescope retains unfinished objectives without marking them complete', async () => {
    const { retainUnfinished } = await import('./mission-coordination');
    const history = retainUnfinished(goal, 'missing supported method', [], 123);
    expect(history[0].goal.milestones[0].done).toBe(false);
    expect(history[0].reason).toBe('missing supported method');
    expect(history[0].at).toBe(123);
    const complete = { ...goal, milestones: goal.milestones.map((m) => ({ ...m, done: true })) };
    expect(retainUnfinished(complete, 'completed', history)).toBe(history);
});

test('ordinary council request signature ignores repeated prose but changes for goal progress or deaths', async () => {
    const { councilRequestSignature } = await import('./mission-coordination');
    const deaths: [string,number][] = [['a',0],['b',0]];
    const before=councilRequestSignature(goal,deaths);
    expect(councilRequestSignature({...goal,mission:'same goal, new wording'},deaths)).toBe(before);
    const changed=JSON.parse(JSON.stringify(goal)) as TeamGoal; changed.milestones[0].done=true;
    expect(councilRequestSignature(changed,deaths)).not.toBe(before);
    expect(councilRequestSignature(goal,[['a',1],['b',0]])).not.toBe(before);
});
