// The published snapshot goes out in pieces, because every byte written to or read from the shared
// Redis counts against its monthly network allowance. The fast lane is tiny (where each character is
// and what they are doing, plus the liveness stamp) and goes out often. The rest is split into
// sections by how often it really changes; each is gzipped and written only when its content changed.
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';

export const FAST_EVERY_MS = 15_000;
/** An unchanged fast lane is still rewritten this often, because its stamp tells the site the party is alive. */
export const FAST_HEARTBEAT_MS = 45_000;

const FAST_BOT_FIELDS = ['name', 'action', 'actionSince', 'location', 'pos', 'hp'] as const;

/** Top-level snapshot fields that get their own key, and how often that key is considered. Everything else is `core`. */
export const SECTIONS = {
    core: { fields: null, everyMs: 60_000 },
    log: { fields: ['log'], everyMs: 60_000 },
    history: { fields: ['history'], everyMs: 5 * 60_000 },
    routes: { fields: ['routes'], everyMs: 5 * 60_000 },
    achievements: { fields: ['achievements'], everyMs: 5 * 60_000 },
    scorecard: { fields: ['scorecard'], everyMs: 5 * 60_000 }
} as const satisfies Record<string, { fields: readonly string[] | null; everyMs: number }>;

export type SectionName = keyof typeof SECTIONS;

interface RemoteSnapshot {
    generatedAt: number;
    lastEventAt: number;
    uptimeMin: number;
    bots: Record<string, any>[];
    [key: string]: unknown;
}

export interface Piece {
    /** Key suffix after `snapshot:`. */
    name: 'fast' | SectionName;
    value: Buffer | string;
    fingerprint: string;
    everyMs: number;
    /** Rewrite even when unchanged this often. */
    heartbeatMs?: number;
}

const digest = (s: string) => createHash('sha1').update(s).digest('hex');

export function splitSnapshot(remote: RemoteSnapshot): Piece[] {
    const { generatedAt, lastEventAt, uptimeMin, ...rest } = remote;
    const fastBody = { bots: remote.bots.map(bot => Object.fromEntries(FAST_BOT_FIELDS.map(f => [f, bot[f] ?? null]))) };
    const pieces: Piece[] = [{
        name: 'fast',
        value: JSON.stringify({ generatedAt, lastEventAt, uptimeMin, ...fastBody }),
        fingerprint: JSON.stringify(fastBody),
        everyMs: FAST_EVERY_MS,
        heartbeatMs: FAST_HEARTBEAT_MS
    }];
    const claimed = new Set<string>(Object.values(SECTIONS).flatMap(s => s.fields ?? []));
    for (const [name, { fields, everyMs }] of Object.entries(SECTIONS) as [SectionName, (typeof SECTIONS)[SectionName]][]) {
        const body: Record<string, unknown> = fields
            ? Object.fromEntries(fields.map(f => [f, rest[f]]))
            : {
                ...Object.fromEntries(Object.entries(rest).filter(([k]) => !claimed.has(k))),
                // Only what is not in the fast lane, so a moving character does not rewrite the core.
                bots: remote.bots.map(bot => Object.fromEntries(Object.entries(bot).filter(([k]) => k === 'name' || !(FAST_BOT_FIELDS as readonly string[]).includes(k))))
            };
        const json = JSON.stringify(body);
        pieces.push({ name, value: gzipSync(json), fingerprint: digest(json), everyMs });
    }
    return pieces;
}

/** Remembers what each key last held and when it was last considered, so unchanged or not-yet-due content is not sent. */
export class WriteGate {
    private last = new Map<string, { fingerprint: string; at: number }>();
    private checked = new Map<string, number>();

    /** True when `key` has not been looked at for `everyMs`; looking marks it checked. */
    due(key: string, everyMs: number, now = Date.now()): boolean {
        if (now - (this.checked.get(key) ?? -Infinity) < everyMs - 1000) return false;
        this.checked.set(key, now);
        return true;
    }

    /** `heartbeatMs` forces a write even when nothing changed; omit it to wait for a change. */
    shouldWrite(key: string, fingerprint: string, now = Date.now(), heartbeatMs = Infinity): boolean {
        const prev = this.last.get(key);
        return !prev || prev.fingerprint !== fingerprint || now - prev.at >= heartbeatMs;
    }

    /** Call only after the write succeeded, so a failed write is tried again. */
    wrote(key: string, fingerprint: string, now = Date.now()) {
        this.last.set(key, { fingerprint, at: now });
    }
}
