import { expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { controllerStale, freshSaves, processAlive, readJson, writeJson, type ControllerHealth } from './runtime-health';
import { servicePlist } from './service';

test('heartbeat supervision distinguishes startup grace, stalled controllers and a previous PID', () => {
    const h:ControllerHealth={pid:123,at:100_000,startedAt:0,phase:'running',run:'test',bots:['a']};
    expect(controllerStale(h,123,0,150_000)).toBe(false);
    expect(controllerStale(h,123,0,191_000)).toBe(true);
    expect(controllerStale(h,124,150_000,200_000)).toBe(false);
    expect(controllerStale(null,124,0,181_000)).toBe(true);
    expect(controllerStale({...h,phase:'starting',at:181_000},123,0,181_000)).toBe(true);
    expect(processAlive(process.pid)).toBe(true);
    expect(processAlive(-1)).toBe(false);
});
test('save verification requires every character and excludes saves older than the disconnect', () => {
    const dir=mkdtempSync(join(tmpdir(),'rascals-health-'));
    try {
        writeFileSync(join(dir,'a.sav'),'test');
        expect(freshSaves(dir,['a','b'],0)).toBe(false);
        writeFileSync(join(dir,'b.sav'),'test');
        utimesSync(join(dir,'b.sav'),1,1);
        expect(freshSaves(dir,['a','b'],2000)).toBe(false);
        expect(freshSaves(dir,['a','b'],0)).toBe(true);
        const file=join(dir,'health.json');writeJson(file,{phase:'running'});
        expect(readJson(file)).toEqual({phase:'running'});
    } finally {rmSync(dir,{recursive:true,force:true});}
});
test('LaunchAgent uses an absolute command, durable restart and enough shutdown time', () => {
    const plist=servicePlist('/tmp/Party & Friends','/opt/bun','/usr/bin');
    expect(plist).toContain('/tmp/Party &amp; Friends/agents/supervisor.ts');
    expect(plist).toContain('<key>KeepAlive</key><true/>');
    expect(plist).toContain('<key>ExitTimeOut</key><integer>360</integer>');
    expect(plist).not.toContain('OPENAI_API_KEY');
});

test('a heartbeat is stale only after 90 seconds, and a starting controller only after 180', () => {
    const h: ControllerHealth = { pid: 7, at: 0, startedAt: 0, phase: 'running', run: 'r', bots: ['a'] };
    expect(controllerStale(h, 7, 0, 90_000)).toBe(false);
    expect(controllerStale(h, 7, 0, 90_001)).toBe(true);
    // A fresh heartbeat that still says "starting" is stale once startup exceeds 180s.
    const starting = (now: number) => ({ ...h, phase: 'starting' as const, at: now });
    expect(controllerStale(starting(180_000), 7, 0, 180_000)).toBe(false);
    expect(controllerStale(starting(180_001), 7, 0, 180_001)).toBe(true);
});
test('a heartbeat from a different PID does not keep a new controller alive', () => {
    const h: ControllerHealth = { pid: 1, at: 999_000, startedAt: 0, phase: 'running', run: 'r', bots: ['a'] };
    expect(controllerStale(h, 2, 1_000_000, 1_100_000)).toBe(false);
    expect(controllerStale(h, 2, 1_000_000, 1_180_001)).toBe(true);
});
test('writeJson leaves no temporary file and uses owner-only permissions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rascals-json-'));
    try {
        const file = join(dir, 'beat.json');
        writeJson(file, { a: 1 });
        writeJson(file, { a: 2 });
        expect(readJson(file)).toEqual({ a: 2 });
        expect(readdirSync(dir)).toEqual(['beat.json']);
        expect(statSync(file).mode & 0o777).toBe(0o600);
        expect(readJson(join(dir, 'missing.json'))).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('a missing save directory never counts as fresh', () => {
    expect(freshSaves('/nonexistent/rascals/saves', ['a'], 0)).toBe(false);
});
