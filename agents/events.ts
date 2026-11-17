// Append-only event log for a run. The dashboard and any later analysis read this.
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface AgentEvent {
    t: number;
    bot: string;
    type: 'decision' | 'order_end' | 'chat' | 'trade' | 'spend' | 'error' | 'info' | 'death' | 'commit' | 'resolve' | 'reflect' | 'council' | 'lookup' | 'want' | 'achievement';
    [key: string]: unknown;
}

const runDir = join(import.meta.dir, 'runs', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(runDir, { recursive: true });
const file = join(runDir, 'events.jsonl');

const recent: AgentEvent[] = [];
const listeners = new Set<(e: AgentEvent) => void>();

export function emit(bot: string, type: AgentEvent['type'], data: Record<string, unknown> = {}): void {
    const event = { t: Date.now(), bot, type, ...data } as AgentEvent;
    appendFileSync(file, JSON.stringify(event) + '\n');
    recent.push(event);
    if (recent.length > 500) recent.shift();
    for (const l of listeners) l(event);
    const detail = (data.summary ?? data.text ?? data.thought ?? data.error ?? '') as string;
    console.log(`[${new Date(event.t).toLocaleTimeString()}] ${bot.padEnd(9)} ${type.padEnd(6)} ${String(detail).slice(0, 160)}`);
}

export const recentEvents = () => recent;
export const subscribe = (fn: (e: AgentEvent) => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
};
export const runDirectory = runDir;
