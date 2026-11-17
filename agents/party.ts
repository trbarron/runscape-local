// The running party: a registry the planner, council and dashboard all read.
import type { Agent } from './agent';

export const agents = new Map<string, Agent>();

export function partyTotal(): number {
    return [...agents.values()].reduce((s, a) => s + a.totalLevel(), 0);
}
