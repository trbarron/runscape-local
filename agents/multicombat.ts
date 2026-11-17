import { readFileSync } from 'fs';
import { join } from 'path';

/** Match GameMap.loadCsvMap: each record denotes one 8x8 zone. Unknown tiles fail closed. */
export function parseMulticombat(text: string): (x: number, z: number, level: number) => boolean {
    const zones = new Set<string>();
    for (const line of text.split(/\r?\n/)) {
        if (!/^\d+_\d+_\d+_\d+_\d+$/.test(line.trim())) continue;
        const [y, mx, mz, lx, lz] = line.trim().split('_').map(Number);
        if (y > 3 || lx >= 64 || lz >= 64 || lx % 8 || lz % 8) continue;
        zones.add(`${y}:${(mx * 64 + lx) / 8}:${(mz * 64 + lz) / 8}`);
    }
    return (x, z, level) => [x,z,level].every(Number.isFinite)
        && zones.has(`${level}:${Math.floor(x / 8)}:${Math.floor(z / 8)}`);
}
let lookup: ReturnType<typeof parseMulticombat> | undefined;
export function isMulticombat(x: number, z: number, level = 0): boolean {
    if (!lookup) {
        try { lookup = parseMulticombat(readFileSync(join(import.meta.dir, '../rs-sdk/server/content/maps/multiway.csv'), 'utf8')); }
        catch { lookup = () => false; }
    }
    return lookup(x, z, level);
}
