import {expect,test} from 'bun:test';
import type {AgentEvent} from './events';
import {createProgressMonitor,productiveBlockSignals} from './progress-signals';
const block=(hp=30)=>({t:100,bot:'fighter',type:'order_end',action:'fight',outcome:'blocked',reason:`retreated at HP ${hp}/70`,xp:{Attack:32}} as AgentEvent);
test('repeated failures with XP remain visible, with numeric reasons grouped',()=>{
    expect(productiveBlockSignals([block(),block(25)],0)).toEqual([]);
    const signals=productiveBlockSignals([block(),block(25),block(20)],0);
    expect(signals).toHaveLength(1);expect(signals[0].message).toContain('despite XP');
    expect(productiveBlockSignals([block(),block(),block()],101)).toEqual([]);
    expect(productiveBlockSignals([block(),block(),{...block(),outcome:'yielded'}],0)).toEqual([]);
});
test('controller hook defers startup, deduplicates recursion/requests, and reopens after cooldown',()=>{
    let now=1000,ready=false,requests=0,held=0,allowed=false;
    const rows=[block(),block(),block()],warnings:string[]=[],notices:string[]=[];
    const monitor=createProgressMonitor({ready:()=>ready,events:()=>rows,now:()=>now,
        warn:text=>{warnings.push(text);monitor({t:now,bot:'overview',type:'info'} as AgentEvent);},
        notice:text=>notices.push(text),council:()=>{requests++;if(allowed)held++;}});
    monitor(block());expect(warnings).toEqual([]);
    ready=true;monitor(block());expect(warnings).toHaveLength(1);expect(notices).toHaveLength(1);
    expect(requests).toBe(1);expect(held).toBe(0); // request isn't proof a throttled council ran
    monitor(block());expect(requests).toBe(1);
    now+=30*60000;rows.forEach(e=>e.t=now);allowed=true;monitor(block());
    expect(requests).toBe(2);expect(held).toBe(1);
});
