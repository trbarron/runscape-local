import type { GameMessage } from '../rs-sdk/sdk/types';
import { ORE_PAIRS, partnerNeed } from './smelting';

export const IRON_LOSS_RETRY_LIMIT = 10;
export interface SmeltingReport {
    /** Observed resolved attempts, not SDK calls or preparation passes. */
    resolvedAttempts: number;
    barsProduced: Record<string, number>;
    confirmedInputsConsumed: Record<string, number>;
    impurityFailures: number;
    reachFailures: number;
    consecutiveImpurityFailures: number;
}
const cursor = (m: GameMessage) => m.observationId ?? m.tick;
const metals = new Set(['bronze', 'iron', 'steel', 'silver', 'gold', 'mithril', 'adamantite', 'runite']);

/** Collect only newly published, explicit server outcomes. Never infer a loss from missing XP. */
export class SmeltingObservation {
    readonly report: SmeltingReport = { resolvedAttempts: 0, barsProduced: {}, confirmedInputsConsumed: {}, impurityFailures: 0, reachFailures: 0, consecutiveImpurityFailures: 0 };
    private readonly baseline: number;
    private readonly seen = new Set<string>();
    constructor(messages: GameMessage[] = []) {
        this.baseline = Math.max(0, ...messages.map(cursor));
    }
    observe(messages: GameMessage[] = []): void {
        const input = (name: string, n: number) => {
            this.report.confirmedInputsConsumed[name] = (this.report.confirmedInputsConsumed[name] ?? 0)+n;
        };
        const repeats = new Map<string, number>();
        for (const m of [...messages].sort((a,b) => cursor(a)-cursor(b))) {
            if (cursor(m) <= this.baseline) continue;
            const identity = m.observationId !== undefined ? `observation:${m.observationId}` : `${m.tick}:${m.type}:${m.sender}:${m.text}`;
            const occurrence = repeats.get(identity) ?? 0;
            repeats.set(identity, occurrence+1);
            const key = m.observationId !== undefined ? identity : `${identity}:${occurrence}`;
            if (this.seen.has(key)) continue;
            this.seen.add(key);
            if (m.type !== 0 || m.sender) continue;
            const text = m.text.trim();
            if (/^The ore is too impure and you fail to refine it\.$/i.test(text)) {
                this.report.resolvedAttempts++;
                this.report.impurityFailures++;
                this.report.consecutiveImpurityFailures++;
                input('iron ore',1);
                continue;
            }
            const metal = text.match(/^You retrieve a bar of (\w+)(?: from the furnace)?\.$/i)?.[1].toLowerCase();
            if (metal && metals.has(metal)) {
                this.report.resolvedAttempts++;
                this.report.barsProduced[metal] = (this.report.barsProduced[metal] ?? 0)+1;
                this.report.consecutiveImpurityFailures = 0;
                const key = metal === 'adamantite' ? 'adamant' : metal === 'runite' ? 'rune' : metal;
                const [main, partner] = ORE_PAIRS[key];
                input(main.source.replace(/[\^$]/g,''),key === 'steel' ? 2 : 1);
                if (partner) input(partner.source.replace(/[\^$]/g,''),partnerNeed(key));
            } else if (/can't reach|cannot reach/i.test(text)) this.report.reachFailures++;
        }
    }
    get retryLimitReached(): boolean { return this.report.consecutiveImpurityFailures >= IRON_LOSS_RETRY_LIMIT; }
    summary(): string {
        const r = this.report;
        if (!r.resolvedAttempts && !r.reachFailures) return '';
        const bars = Object.entries(r.barsProduced).map(([metal,count]) => `${count} ${metal} bar${count===1?'':'s'}`).join(', ') || '0 bars';
        const inputs = Object.entries(r.confirmedInputsConsumed).map(([name,count]) => `${count} ${name}`).join(', ');
        const losses = r.impurityFailures ? `; ${r.impurityFailures} normal iron impurity losses (50% chance)` : '';
        return `${bars}${inputs ? `; used ${inputs}` : ''}${losses}${r.reachFailures ? `; ${r.reachFailures} reach failures` : ''}`;
    }
}

export function ironLossYield(observation: SmeltingObservation): {kind:string;why:string} {
    return { kind:'yielded', why:`bounded iron retry budget reached after ${observation.report.consecutiveImpurityFailures} consecutive confirmed impurity losses; the furnace processed ore, target remains unfinished; choose whether to retry or use another supported recipe` };
}
