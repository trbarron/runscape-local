import {expect,test} from 'bun:test';
import {Agent} from './agent';
const decision=(over:any={})=>({thought:'bounded project',lookup:null,resume:false,routine:'test',repeat:false,
    steps:[{action:'travel',target:'Falador east bank',until_type:'minutes',until_value:2}],
    goal:null,commit:[],resolve:[],wants:[],drop_wants:[],messages:[],tactics:null,call_council:false,
    ambition:null,field_note:null,...over});
function harness(proposals:any[],reject:()=>string|null) {
    const a:any=Object.create(Agent.prototype),learned:any[]=[];let saves=0;
    Object.assign(a,{name:'learning-acceptance-test',notices:[],decisions:[],paused:null,order:null,history:[],
        memory:{decisions:0,lastReflection:0,commitments:[],notes:'',goal:''},routineRejection:reject,
        planningIO:{now:()=>Date.now(),bank:()=>undefined,unread:()=>new Set<number>(),budget:()=>1,lookup:()=> 'index result',decide:async()=>{const d=proposals.shift();if(!d)throw Error('unexpected model call');return d;},
            learn:(d:any)=>{learned.push(d);return {changed:false};},save:()=>{saves++;}}});
    return {a,learned,saves:()=>saves};
}
test('real planning loop applies learning only after lookup retry and successful preflight',async()=>{
    let checks=0;
    const lookup=decision({lookup:'coal'}),rejected=decision({thought:'rejected'}),accepted=decision({thought:'accepted'});
    const h=harness([lookup,rejected,accepted],()=>++checks===1?'unavailable supplies':null);
    await h.a.decideRoutine('test');
    expect(h.learned).toEqual([accepted]);expect(h.saves()).toBe(1);
});
test('real repeated preflight rejection never applies or saves learning',async()=>{
    const h=harness([decision(),decision()],()=> 'unavailable');await h.a.decideRoutine('test');
    expect(h.learned).toEqual([]);expect(h.saves()).toBe(0);
});
test('accepted resume updates intentions once without inventing a new executed project',async()=>{
    const d=decision({resume:true});const h=harness([d],()=>null);
    h.a.paused={name:'old actual routine',repeat:false,from:{step:0,loops:0},steps:[{action:'travel',args:{target:'Falador east bank'},until:{type:'minutes',value:2,skill:null,item:null},label:'travel'}]};
    const r=await h.a.decideRoutine('resume');expect(r.name).toBe('old actual routine');expect(h.learned).toEqual([d]);
});
test('real repeating production routine stops after a lap that only shuffles supplies',async()=>{
    const h=harness([],()=>null);let calls=0;
    Object.assign(h.a,{sdk:{getState:()=>({})},stopped:false,
        execute:async(o:any)=>{calls++;return {progress:o.action==='withdraw_from_bank',ended:{kind:'done',why:''},summary:o.label};}});
    const steps=['bank_resources','equip','withdraw_from_bank','smelt'].map(action=>({action,args:{target:null},until:{type:'minutes',value:1,skill:null},label:action}));
    const result=await h.a.runRoutine({name:'empty production',repeat:true,steps});
    expect(calls).toBe(4);expect(result).toContain('no productive progress');expect(h.a.memory.routine).toBeUndefined();
});
test('real routine carries its named smith output into broad cleanup without changing an explicit target',async()=>{
    const h=harness([],()=>null),seen:any[]=[];
    Object.assign(h.a,{sdk:{getState:()=>({})},stopped:false,
        execute:async(o:any)=>{seen.push(o);return {progress:false,ended:{kind:'done',why:''},summary:o.label};}});
    const steps=[['bank_resources',null],['smith','iron dagger'],['bank_resources','coal']].map(([action,target])=>({action,args:{target},until:{type:'minutes',value:1,skill:null},label:action}));
    await h.a.runRoutine({name:'dagger cleanup',repeat:false,steps});
    expect(seen[0].args.bankOutputs).toEqual(['iron dagger']);expect(seen[2].args.target).toBe('coal');
});
const cycleSteps=()=>['smelt','smith','bank_resources'].map((action,i)=>({action,args:{target:['adamant','adamant dagger',null][i]},until:{type:'exhausted',value:0,skill:null},label:action}));
test('real nonrepeat exhausted pipeline continues from its own bank and stops at actual depletion',async()=>{
 const h=harness([],()=>null);let laps=0;const bank={t:Date.now(),items:{Coal:12,'Adamantite ore':2}};
 Object.assign(h.a,{sdk:{getState:()=>({inventory:[],equipment:[],skills:[{name:'Smithing',baseLevel:77}]}),getStateAge:()=>0},stopped:false,pending:null});
 h.a.planningIO.bank=()=>bank;
 h.a.execute=async(o:any)=>{if(o.action==='bank_resources'){laps++;bank.items.Coal-=6;bank.items['Adamantite ore']--;}
 return {progress:o.action==='smith',ended:{kind:'done',why:''},summary:o.label};};
 const result=await h.a.runRoutine({name:'chosen adamant chain',repeat:false,steps:cycleSteps()});
 expect(laps).toBe(2);expect(result).toContain('production cycle ended');expect(h.a.memory.routine).toBeUndefined();
});
test('automatic cycles stop on stale state, interruption and the invocation time budget',async()=>{
 for(const mode of ['stale','interrupt','budget']) {
  const h=harness([],()=>null);let laps=0,time=100000;
  Object.assign(h.a,{sdk:{getState:()=>({inventory:[],equipment:[],skills:[{name:'Smithing',baseLevel:77}]}),getStateAge:()=>mode==='stale'?31000:0},stopped:false,pending:null});
  h.a.planningIO.now=()=>time;h.a.planningIO.bank=()=>({t:time,items:{Coal:100,'Adamantite ore':20}});
  h.a.execute=async(o:any)=>{if(o.action==='bank_resources'){laps++;if(mode==='budget')time+=1800000;if(mode==='interrupt')h.a.pending='council changed the plan';}return {progress:true,ended:{kind:'done',why:''},summary:o.label};};
  const result=await h.a.runRoutine({name:'bounded chosen chain',repeat:false,steps:cycleSteps()});
  expect(laps).toBe(1);expect(result).toContain(mode==='stale'?'fresh state':mode==='interrupt'?'council changed':'time limit');
 }
});
test('explicit model repeat retains its own semantics without automatic bank/freshness gates',async()=>{
 const h=harness([],()=>null);let laps=0;
 Object.assign(h.a,{sdk:{getState:()=>({})},stopped:false,pending:null});
 h.a.execute=async(o:any)=>{if(o.action==='bank_resources')laps++;return {progress:laps===0,ended:{kind:'done',why:''},summary:o.label};};
 const result=await h.a.runRoutine({name:'explicit repeated production',repeat:true,steps:cycleSteps()});
 expect(laps).toBe(2);expect(result).toContain('no productive progress');
});
