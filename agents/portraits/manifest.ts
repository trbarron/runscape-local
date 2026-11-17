import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

export const PORTRAIT_DIR = join(import.meta.dir, '..', 'public', 'portraits');
export interface PortraitMeta { version: string; renderedAt: number; angles?: number }
export type PortraitManifest = Record<string, PortraitMeta>;
export function readManifest(dir = PORTRAIT_DIR, file = '.manifest.json'): PortraitManifest {
    try { return JSON.parse(readFileSync(join(dir, file), 'utf8')); } catch { return {}; }
}
export function saveManifest(manifest: PortraitManifest, dir = PORTRAIT_DIR, file = '.manifest.json'): void {
    const path = join(dir, file);
    writeFileSync(path + '.tmp', JSON.stringify(manifest, null, 2));
    renameSync(path + '.tmp', path);
}
/** Views per figure; the renderer and the publisher both read this. */
export const ANGLES = 16;
/** Angle 0 keeps the original file name, so the front view works wherever only one image is known. */
export const angleFile = (name: string, kind: 'head' | 'body', angle: number) => `${name}-${kind}${angle ? `-${angle}` : ''}.png`;
export function needsPortrait(name: string, version: string, manifest: PortraitManifest, dir: string): boolean {
    if (manifest[name]?.version !== version) return true;
    return (['head', 'body'] as const).some(kind => Array.from({ length: ANGLES }, (_, a) => a).some(a => !existsSync(join(dir, angleFile(name, kind, a)))));
}
