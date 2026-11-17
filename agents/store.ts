// Tiny JSON persistence under agents/state/, so a restart keeps the party's social context.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

const DIR = join(import.meta.dir, 'state');
mkdirSync(DIR, { recursive: true });

export function load<T>(name: string, fallback: T): T {
    const file = join(DIR, `${name}.json`);
    if (!existsSync(file)) return fallback;
    try {
        const value = JSON.parse(readFileSync(file, 'utf-8'));
        // Objects merge over their defaults; lists come back as they were saved.
        if (Array.isArray(fallback)) return Array.isArray(value) ? (value as T) : fallback;
        return { ...fallback, ...value };
    } catch {
        return fallback;
    }
}

export function save(name: string, value: unknown): void {
    const file = join(DIR, `${name}.json`);
    writeFileSync(file + '.tmp', JSON.stringify(value, null, 2));
    renameSync(file + '.tmp', file);
}
