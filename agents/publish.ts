// Publishes the dashboard to the website's Redis, which tylerbarron.com/runescape-rascals
// reads (portraits and screenshots go to S3 instead when it is configured, see assets.ts). Keys follow the site's per-feature namespace convention. Optional: without
// REDIS_URL (in ../.env) nothing is published and the local dashboard still works.
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import Redis from 'ioredis';
import { emit } from './events';
import { WriteGate, type Piece } from './lanes';
import { ASSET_BASE, IMMUTABLE, type AssetStore, SHOT_CACHE, assetStore, portraitKey, portraitPrefix, shotKey, staleKeys, validVersion } from './assets';

const PREFIX = 'runescapeRascals:';
const TTL_SECONDS = 7 * 24 * 3600;

function redisUrl(): string | undefined {
    if (process.env.REDIS_URL) return process.env.REDIS_URL;
    const envFile = join(import.meta.dir, '..', '.env');
    if (!existsSync(envFile)) return undefined;
    return readFileSync(envFile, 'utf-8').match(/^REDIS_URL=(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, '');
}

let client: Redis | null = null;
let failing = false;

function redis(): Redis | null {
    if (client) return client;
    const url = redisUrl();
    if (!url) return null;
    client = new Redis(url, {
        maxRetriesPerRequest: 2,
        ...(url.startsWith('rediss://') && { tls: { rejectUnauthorized: false } })
    });
    client.on('error', e => {
        if (!failing) emit('party', 'error', { error: `redis: ${e.message}` });
        failing = true;
    });
    client.on('ready', () => (failing = false));
    return client;
}

export const publishing = () => !!redisUrl();

const gate = new WriteGate();

/**
 * Called every dashboard tick with the snapshot already split into pieces (see lanes.ts). A piece
 * is looked at only when its own cadence is due, and written only if its content changed (or its
 * heartbeat is due), so a quiet party costs almost nothing.
 */
export async function publishSnapshot(pieces: Piece[]): Promise<void> {
    const db = redis();
    if (!db) return;
    for (const piece of pieces) {
        const key = `${PREFIX}snapshot:${piece.name}`;
        if (!gate.due(key, piece.everyMs) || !gate.shouldWrite(key, piece.fingerprint, Date.now(), piece.heartbeatMs)) continue;
        try {
            await db.set(key, piece.value, 'EX', TTL_SECONDS);
            gate.wrote(key, piece.fingerprint);
        } catch { /* not recorded as written, so the next time this piece is due it is tried again */ }
    }
}

/** Set in the snapshot when images are in S3, which tells the site where to find them. */
export const assetBase = () => (assetStore() ? ASSET_BASE : undefined);

export async function publishShot(name: string, jpeg: Buffer): Promise<boolean> {
    const bucket = assetStore();
    const db = bucket ? null : redis();
    if (!bucket && !db) return false;
    try {
        if (bucket) await bucket.put(shotKey(name), jpeg, 'image/jpeg', SHOT_CACHE);
        else await db!.set(`${PREFIX}shot:${name}`, jpeg, 'EX', TTL_SECONDS);
        return true;
    }
    catch (error) {
        emit('party', 'error', { error: `screenshot publish ${name}: ${error instanceof Error ? error.message : String(error)}` });
        return false;
    }
}

export async function closePublisher(): Promise<void> {
    await client?.quit().catch(() => {});
}

/**
 * Commit a complete set of portrait views before exposing its version in the next snapshot. The
 * front view (angle 0) keeps the original key; the others add the angle, so older readers still work.
 */
export async function publishPortrait(name: string, head: Buffer[], body: Buffer[], version: string): Promise<boolean> {
    const bucket = assetStore();
    if (bucket) return publishPortraitToBucket(bucket, name, head, body, version);
    const db = redis();
    if (!db) return false;
    try {
        const tx = db.multi();
        for (const [kind, views] of [['head', head], ['body', body]] as const) {
            views.forEach((png, angle) => tx.set(`${PREFIX}portrait:${name}:${kind}${angle ? `:${angle}` : ''}`, png, 'EX', TTL_SECONDS));
        }
        const result = await tx.set(`${PREFIX}portrait:${name}:version`, version, 'EX', TTL_SECONDS).exec();
        if (!result || result.some(([error]) => error)) throw new Error('portrait transaction failed');
        return true;
    } catch (error) {
        emit('party', 'error', { error: `portrait publish ${name}: ${error instanceof Error ? error.message : String(error)}` });
        return false;
    }
}

/** Upload every view of the new version, then drop the character's older versions: nothing the page can ask for goes missing. */
export async function publishPortraitToBucket(bucket: AssetStore, name: string, head: Buffer[], body: Buffer[], version: string): Promise<boolean> {
    try {
        if (!validVersion(version)) throw new Error(`unusable portrait version "${version}"`);
        const views = ([['head', head], ['body', body]] as const).flatMap(([kind, pngs]) => pngs.map((png, angle) => ({ key: portraitKey(name, kind, angle, version), png })));
        // The watcher republishes every few minutes; only what is not in the bucket yet is uploaded (objects never change under a version).
        const existing = await bucket.list(portraitPrefix(name));
        const missing = views.filter(v => !existing.includes(v.key));
        for (let i = 0; i < missing.length; i += 8) await Promise.all(missing.slice(i, i + 8).map(v => bucket.put(v.key, v.png, 'image/png', IMMUTABLE)));
        await bucket.remove(staleKeys(existing, version));
        return true;
    } catch (error) {
        emit('party', 'error', { error: `portrait publish ${name}: ${error instanceof Error ? error.message : String(error)}` });
        return false;
    }
}
