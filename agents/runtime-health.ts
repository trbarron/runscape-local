import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';

export interface ControllerHealth {
    pid: number;
    supervisorPid?: number;
    at: number;
    startedAt: number;
    phase: 'starting' | 'running' | 'stopping' | 'stopped';
    run: string;
    bots: string[];
    browserEndpoint?: string;
}
export function readJson<T>(file: string): T | null {
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}
export function writeJson(file: string, data: unknown): void {
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    renameSync(temp, file);
}
export function processAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
}
export function controllerStale(health: ControllerHealth | null, pid: number, started: number, now = Date.now()): boolean {
    if (!health || health.pid !== pid) return now - started > 180_000;
    if (health.phase === 'starting' && now - health.startedAt > 180_000) return true;
    return now - health.at > 90_000;
}
export function freshSaves(directory: string, bots: string[], since: number): boolean {
    return bots.length > 0 && bots.every(name => {
        const file = `${directory}/${name}.sav`;
        return existsSync(file) && Bun.file(file).lastModified >= since;
    });
}
