import { expect, test } from 'bun:test';
import type { AgentEvent } from './events';
import { computeMetrics } from './metrics';
import { promiseMetrics } from './promise-metrics';

const event = (type: AgentEvent['type'], id: number, status?: string, t = 1): AgentEvent => ({ bot: 'trish', t, type, id, status });

test('a window with only older resolutions has no negative open count', () => {
    expect(promiseMetrics([event('resolve', 1, 'done'), event('resolve', 2, 'dropped')])).toEqual({
        made: 0, done: 0, dropped: 0, open: 0, carriedDone: 1, carriedDropped: 1
    });
});

test('the observed 19 completions / 17 creations remains a valid cohort', () => {
    const events = Array.from({ length: 17 }, (_, i) => event('commit', i));
    events.push(...Array.from({ length: 19 }, (_, i) => event('resolve', i, 'done', 2)));
    expect(promiseMetrics(events)).toEqual({ made: 17, done: 17, dropped: 0, open: 0, carriedDone: 2, carriedDropped: 0 });
});

test('matches IDs, keeps open and dropped promises, and deduplicates events', () => {
    const events = [event('commit', 1), event('commit', 2), event('commit', 3), event('commit', 1),
        event('resolve', 1, 'done', 2), event('resolve', 1, 'done', 2), event('resolve', 2, 'dropped', 2),
        event('resolve', 9, 'done', 2), event('resolve', 9, 'done', 2)];
    expect(promiseMetrics(events)).toEqual({ made: 3, done: 1, dropped: 1, open: 1, carriedDone: 1, carriedDropped: 0 });
    expect(promiseMetrics([...events].reverse())).toEqual(promiseMetrics(events));
});

test('metrics isolate promise IDs by character', () => {
    const events = [event('commit', 1), event('resolve', 1, 'done', 2), { ...event('commit', 1), bot: 'bram' }];
    const metrics = computeMetrics(events, 3).bots;
    expect(metrics.find(b => b.name === 'trish')!.commitments.done).toBe(1);
    expect(metrics.find(b => b.name === 'bram')!.commitments).toEqual({ made: 1, done: 0, dropped: 0, open: 1, carriedDone: 0, carriedDropped: 0 });
});
