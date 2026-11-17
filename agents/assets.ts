// Live images (portraits and screenshots) go to the website's S3 bucket, which CloudFront serves
// from /images/* on the site's own domain. They used to be Redis values served through a Lambda,
// which spent the shared Redis plan's network allowance and its 30 connections. Optional: without
// RASCALS_S3_BUCKET in ../.env the publisher keeps using Redis for them.
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/** Where the site finds them (same origin as the page); the snapshot carries it so the site knows to use it. */
export const ASSET_BASE = '/images/rascals-live';
const KEY_ROOT = ASSET_BASE.slice(1);

/** One immutable object per rendered view; a new appearance gets a new version, so nothing is ever replaced. */
export const portraitKey = (name: string, kind: 'head' | 'body', angle: number, version: string) =>
    `${KEY_ROOT}/portraits/${name}/${kind}-${angle}-${version}.png`;
export const portraitPrefix = (name: string) => `${KEY_ROOT}/portraits/${name}/`;
/** Replaced in place every few minutes, so it carries a short cache lifetime instead of a version. */
export const shotKey = (name: string) => `${KEY_ROOT}/shots/${name}.jpg`;

export const IMMUTABLE = 'public,max-age=31536000,immutable';
export const SHOT_CACHE = 'public,max-age=300';

/** Versions are content hashes; anything else would not be a safe file name. */
export const validVersion = (version: string) => /^[A-Za-z0-9]+$/.test(version);

/** Objects under a character's portrait prefix that belong to some other version. */
export const staleKeys = (existing: string[], version: string) => existing.filter(key => !key.endsWith(`-${version}.png`));

function envVar(name: string): string | undefined {
    if (process.env[name]) return process.env[name];
    const envFile = join(import.meta.dir, '..', '.env');
    if (!existsSync(envFile)) return undefined;
    return readFileSync(envFile, 'utf-8').match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '');
}

export interface AssetStore {
    put(key: string, body: Buffer, contentType: string, cacheControl: string): Promise<void>;
    list(prefix: string): Promise<string[]>;
    remove(keys: string[]): Promise<void>;
}

let store: AssetStore | null | undefined;

/** The bucket, or null when it is not configured. Uses the publisher's own keys when present, else the default AWS credentials. */
export function assetStore(): AssetStore | null {
    if (store !== undefined) return store;
    const Bucket = envVar('RASCALS_S3_BUCKET');
    if (!Bucket) return (store = null);
    const accessKeyId = envVar('RASCALS_AWS_ACCESS_KEY_ID');
    const secretAccessKey = envVar('RASCALS_AWS_SECRET_ACCESS_KEY');
    const s3 = new S3Client({
        region: envVar('RASCALS_S3_REGION') ?? 'us-west-2',
        ...(accessKeyId && secretAccessKey && { credentials: { accessKeyId, secretAccessKey } })
    });
    return (store = {
        async put(Key, Body, ContentType, CacheControl) {
            await s3.send(new PutObjectCommand({ Bucket, Key, Body, ContentType, CacheControl }));
        },
        async list(Prefix) {
            const keys: string[] = [];
            let ContinuationToken: string | undefined;
            do {
                const page = await s3.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
                keys.push(...(page.Contents ?? []).flatMap(o => (o.Key ? [o.Key] : [])));
                ContinuationToken = page.NextContinuationToken;
            } while (ContinuationToken);
            return keys;
        },
        async remove(keys) {
            for (let i = 0; i < keys.length; i += 1000) {
                await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.slice(i, i + 1000).map(Key => ({ Key })), Quiet: true } }));
            }
        }
    });
}
