import { expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { processAlive, readJson } from './runtime-health';

test('supervision replaces a killed controller and reclaims its child after supervisor loss', async () => {
    const dir=mkdtempSync(join(tmpdir(),'rascals-supervisor-'));
    mkdirSync(join(dir,'agents/state'),{recursive:true});
    for(const file of ['supervisor.ts','runtime-health.ts'])copyFileSync(join(import.meta.dir,file),join(dir,'agents',file));
    writeFileSync(join(dir,'agents/orchestrator.ts'),`
        import {writeJson} from './runtime-health';
        const health={pid:process.pid,supervisorPid:Number(process.env.RASCALS_SUPERVISOR_PID),at:Date.now(),startedAt:Date.now(),phase:'running',run:'isolated-test',bots:['fixture']};
        const pulse=()=>{health.at=Date.now();writeJson('agents/state/controller-heartbeat.json',health)};pulse();setInterval(pulse,100);
        process.on('SIGTERM',()=>{health.phase='stopped';pulse();process.exit(0)});
    `);
    const launch=()=>Bun.spawn([process.execPath,join(dir,'agents/supervisor.ts')],{cwd:dir,stdout:'ignore',stderr:'ignore'});
    let supervisor=launch();const children=new Set<number>();
    const health=()=>readJson<{pid:number}>(join(dir,'agents/state/controller-heartbeat.json'));
    const wait=async(check:()=>boolean)=>{const end=Date.now()+20_000;while(!check()&&Date.now()<end)await Bun.sleep(50);expect(check()).toBe(true)};
    try {
        await wait(()=>!!health());const first=health()!.pid;children.add(first);
        process.kill(first,'SIGKILL');
        await wait(()=>!!health() && health()!.pid!==first);const second=health()!.pid;children.add(second);
        expect(processAlive(first)).toBe(false);
        supervisor.kill('SIGKILL');await supervisor.exited;
        expect(processAlive(second)).toBe(true);
        supervisor=launch();
        await wait(()=>!!health() && health()!.pid!==second);children.add(health()!.pid);
        expect(processAlive(second)).toBe(false);
        const events=readFileSync(join(dir,'agents/runs/supervisor.jsonl'),'utf8');
        expect(events).toContain('controller-exited');
        expect(events).toContain('orphan-controller-stop');
        supervisor.kill('SIGTERM');expect(await supervisor.exited).toBe(0);
    } finally {
        supervisor.kill('SIGKILL');await supervisor.exited;
        for(const pid of children)if(processAlive(pid))process.kill(pid,'SIGKILL');
        rmSync(dir,{recursive:true,force:true});
    }
},60_000);
