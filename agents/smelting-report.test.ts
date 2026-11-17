import { expect, test } from 'bun:test';
import type { BotWorldState, GameMessage, InventoryItem } from '../rs-sdk/sdk/types';
import { Agent } from './agent';
import { IRON_LOSS_RETRY_LIMIT, SmeltingObservation } from './smelting-report';
import { subscribe } from './events';

const impurity = 'The ore is too impure and you fail to refine it.';
const message = (text: string, id: number, extra: Partial<GameMessage> = {}): GameMessage =>
    ({ text, tick:id, observationId:id, type:0, sender:'', fromSelf:false, ...extra });

test('counts only fresh explicit server outcomes and deduplicates published frames', () => {
    const old=message(impurity,1);
    const report=new SmeltingObservation([old]);
    const frames=[old,message(impurity,2),message('You retrieve a bar of iron.',3),message(impurity,4)];
    report.observe(frames);report.observe(frames);
    report.observe([message(impurity,5,{type:2,sender:'other'}),message('I lost some ore',6)]);
    expect(report.report).toEqual({resolvedAttempts:3,barsProduced:{iron:1},confirmedInputsConsumed:{'iron ore':3},impurityFailures:2,reachFailures:0,consecutiveImpurityFailures:1});
    expect(report.summary()).toContain('1 iron bar; used 3 iron ore; 2 normal iron impurity losses');
});
test('legacy tick messages and distinct identical observations remain deduplicated', () => {
    const r=new SmeltingObservation([message('old',1,{observationId:undefined})]);
    const m=message(impurity,2,{observationId:undefined});r.observe([m,m]);r.observe([m,m]);
    expect(r.report.impurityFailures).toBe(2);
    const observed=new SmeltingObservation();
    observed.observe([message(impurity,10,{tick:2}),message(impurity,11,{tick:2})]);
    expect(observed.report.impurityFailures).toBe(2);
});
test('steel output consumes ore and coal without an iron impurity roll', () => {
    const r=new SmeltingObservation();
    r.observe([message('You place the iron and two heaps of coal into the furnace.',1),message('You retrieve a bar of steel.',2)]);
    expect(r.report.resolvedAttempts).toBe(1);
    expect(r.report.confirmedInputsConsumed).toEqual({coal:2,'iron ore':1});
    expect(r.report.impurityFailures).toBe(0);
});
test('success resets consecutive losses; reach evidence remains separate', () => {
    const r=new SmeltingObservation();
    r.observe(Array.from({length:IRON_LOSS_RETRY_LIMIT},(_,i)=>message(impurity,i+1)));
    expect(r.retryLimitReached).toBe(true);
    r.observe([message('You retrieve a bar of iron.',11),message("I can't reach that!",12)]);
    expect(r.retryLimitReached).toBe(false);
    expect(r.report.reachFailures).toBe(1);
});

function executor(outcomes: string[]) {
    const item=(name:string,slot:number):InventoryItem=>({name,slot,count:1,id:slot+1,optionsWithIndex:[]});
    const s={inventory:Array.from({length:20},(_,i)=>item('Iron ore',i)),equipment:[],
        skills:[{name:'Smithing',baseLevel:65}],gameMessages:[],player:{hp:10,maxHp:10}} as unknown as BotWorldState;
    const report=new SmeltingObservation();const agent:any=Object.create(Agent.prototype);
    let calls=0;
    Object.assign(agent,{name:'smelting-report-test',stopped:false,pending:null,inbox:[],stepNotes:[],
        sdk:{getState:()=>s,getInventory:()=>s.inventory},checkDeath:()=>null,waitAlive:async()=>true,
        untilMet:(_:unknown,g:Map<string,number>)=>(g.get('Iron bar')??0)>=1,
        runPass:async()=>{
            const outcome=outcomes[calls++]??'empty';
            const gained=new Map<string,number>();let blocker: string|undefined;
            if(outcome==='loss'){s.inventory.pop();report.observe([message(impurity,calls)]);}
            if(outcome==='success'){s.inventory.pop();s.inventory.push(item('Iron bar',19));gained.set('Iron bar',1);report.observe([message('You retrieve a bar of iron.',calls)]);}
            if(outcome==='reach'){report.observe([message("I can't reach that!",calls)]);blocker='could not reach the furnace';}
            return {gained,progress:outcome==='success',aborted:false,blocker};
        }});
    const order={action:'smelt',args:{target:'iron'},until:{type:'gathered',skill:null,item:'Iron bar',value:1}};
    return {agent,order,report,state:s,calls:()=>calls};
}
test('three ordinary impurity losses do not claim stuck or count as produced bars', async () => {
    const e=executor(['loss','loss','loss','success']);const gained=new Map<string,number>();
    const result=await e.agent.runOrder(e.order,Date.now(),gained,e.report);
    expect(result.kind).toBe('done');expect(e.calls()).toBe(4);
    expect(gained.get('Iron bar')).toBe(1);expect(e.report.report.impurityFailures).toBe(3);
});
test('ten consecutive confirmed losses yield with zero progress and an unfinished target', async () => {
    const e=executor(Array(IRON_LOSS_RETRY_LIMIT).fill('loss'));const gained=new Map<string,number>();
    const result=await e.agent.runOrder(e.order,Date.now(),gained,e.report);
    expect(result.kind).toBe('yielded');expect(result.why).toContain('target remains unfinished');
    expect(e.calls()).toBe(IRON_LOSS_RETRY_LIMIT);expect(gained.size).toBe(0);
});
test('empty attempts still become stuck and real reach failures still block', async () => {
    const empty=executor([]);
    expect((await empty.agent.runOrder(empty.order,Date.now(),new Map(),empty.report)).kind).toBe('stuck');
    expect(empty.calls()).toBe(3);
    const reach=executor(['loss','reach']);
    const result=await reach.agent.runOrder(reach.order,Date.now(),new Map(),reach.report);
    expect(result.kind).toBe('blocked');expect(result.why).toContain('reach failure');
});
test('ore exhausted by confirmed impurity losses is reported as partial rather than a broken furnace', async () => {
    const e=executor(['loss']);e.state.inventory=e.state.inventory.slice(0,1);
    const result=await e.agent.runOrder(e.order,Date.now(),new Map(),e.report);
    expect(result.kind).toBe('partial');expect(result.why).toContain('impurity losses consumed ore');
    expect(e.calls()).toBe(1);expect(e.report.report.barsProduced).toEqual({});
});
test('a real level requirement still blocks even if an earlier impurity loss was observed', async () => {
    const e=executor([]);e.report.observe([message(impurity,1)]);e.state.skills[0].baseLevel=1;
    const result=await e.agent.runOrder(e.order,Date.now(),new Map(),e.report);
    expect(result.kind).toBe('blocked');expect(result.why).toContain('Smithing 15');
    expect(e.calls()).toBe(0);
});
test('execution publishes observed loss counts, preserves zero XP, and releases the observer', async () => {
    const e=executor([]);const listeners=new Set<(s:BotWorldState)=>void>();
    Object.assign(e.agent,{memory:{},xp:()=>({}),xpGainedSince:()=>({}),packCounts:()=>new Map(),knownBlock:()=>null,
        runOrder:async(_:unknown,_start:number,g:Map<string,number>)=>{
            e.state.gameMessages=[message(impurity,1),message(impurity,2),message('You retrieve a bar of iron.',3)];
            for(const listener of listeners)listener(e.state);
            g.set('Iron bar',1);return {kind:'done',why:''};
        }});
    e.agent.sdk.onStateUpdate=(listener:(s:BotWorldState)=>void)=>{listeners.add(listener);return()=>listeners.delete(listener)};
    let event:any;
    const stop=subscribe(value=>{if(value.bot==='smelting-report-test' && value.type==='order_end')event=value});
    try {
        const result=await e.agent.execute({...e.order,label:'smelt iron'});
        expect(result.summary).toContain('1 iron bar; used 3 iron ore; 2 normal iron impurity losses');
        expect((result.summary.match(/1 iron bar/gi)??[]).length).toBe(1);
        expect(result.summary.length).toBeLessThan(250);
        expect(event.smelting.resolvedAttempts).toBe(3);expect(event.smelting.impurityFailures).toBe(2);
        expect(event.xp).toEqual({});expect(listeners.size).toBe(0);
    } finally {stop();}
});
