import {expect,test} from 'bun:test';
import type {AgentEvent} from './events';
import {newPilot,captureObservation,applyLearning,learningContext,relevantObservations,validLearningState,freshPosition,ambitionInvitationDue,compactLearningFacts} from './learning-pilot';
import {LearningPilotStore,type LearningIO} from './learning';
const ambition={title:'Map a useful route',why:'I like exploring',nextStep:'Make a bounded scout',reconsiderWhen:'If unsafe or no useful discovery',status:'pursue'} as const;
const event=(t=Date.now(),target='coal'):AgentEvent=>({t,bot:'mike',type:'order_end',action:'mine',target,outcome:'done',xp:{Mining:20},durationMs:60000,summary:`mine (${target}) done`});
test('immutable observations preserve executor provenance; no-change/proposed destinations are not discoveries',()=>{
    const s=newPilot(1000);const n=captureObservation(s,event(2000),'real-run',2000)!;
    expect(s.observations).toEqual([]);expect(n.observations[0]).toMatchObject({id:'obs-1',run:'real-run',target:'coal'});
    expect(captureObservation(n,event(3000),'real-run',3000)).toBeUndefined();
    expect(captureObservation(n,{...event(4000),action:'travel',xp:{},target:'unvisited town'},'real-run',4000)).toBeUndefined();
    expect(captureObservation(n,{...event(4000),action:'travel',xp:{},observedStartPosition:{x:0,z:2,plane:0},observedPosition:{x:1,z:2,plane:0}},'real-run',4000)).toBeDefined();
    expect(captureObservation(n,event(1000),'real-run',n.expiresAt)).toBeUndefined();
});
test('own ambitions persist, pause/retire and leave bounded history; interpretation needs actual evidence',()=>{
    let s=captureObservation(newPilot(1000),event(2000),'real',2000)!;
    s=applyLearning(s,'bram',ambition,null,3000).next!;
    expect(s.ambitions.bram.why).toBe(ambition.why);expect(s.ambitions.mike).toBeUndefined();
    expect(applyLearning(s,'bram',null,{evidence_id:'invented',interpretation:'Wrong',next_test:'Try'},4000).warning).toContain('rejected');
    s=applyLearning(s,'bram',{...ambition,status:'pause'},{evidence_id:'obs-1',interpretation:'Coal may be contested',next_test:'Compare another spot'},4000).next!;
    expect(s.interpretations[0].author).toBe('bram');expect(s.ambitionHistory).toHaveLength(1);
    s=applyLearning(s,'bram',{...ambition,status:'retire'},null,5000).next!;
    expect(s.ambitions.bram).toBeUndefined();expect(s.ambitionHistory).toHaveLength(2);expect(s.ambitionHistory[1].transition).toMatchObject({status:'retire',t:5000});expect(validLearningState(s)).toBe(true);
});
test('topic retrieval separates facts/hypotheses and expiry is read-only',()=>{
    let s=captureObservation(newPilot(1000),event(2000),'run',2000)!;
    s=captureObservation(s,{...event(3000,'white knight'),action:'fight',outcome:'blocked',reason:'no food'},'run',3000)!;
    s=applyLearning(s,'mike',ambition,{evidence_id:'obs-1',interpretation:'Maybe use another mine',next_test:'Compare'},4000).next!;
    expect(relevantObservations(s,'mike','coal')[0].target).toBe('coal');
    const context=learningContext(s,'mike','coal',s.expiresAt+1);
    expect(context).toContain('expired; read-only');expect(context).toContain('UNVERIFIED INTERPRETATION');expect(context).toContain('run/events.jsonl');
    expect(context.length).toBeLessThanOrEqual(3500);expect(applyLearning(s,'mike',ambition,null,s.expiresAt+1).next).toBeUndefined();
});
test('bounded retention protects cited evidence, ids and history remain valid',()=>{
    let s=captureObservation(newPilot(1000),event(2000),'run',2000)!;
    s=applyLearning(s,'mike',null,{evidence_id:'obs-1',interpretation:'Maybe useful',next_test:'Check'},3000).next!;
    for(let i=0;i<140;i++)s=captureObservation(s,event(4000+i,`resource${i}`),'run',4000+i)!;
    expect(s.observations).toHaveLength(128);expect(s.observations.some(o=>o.id==='obs-1')).toBe(true);
    for(let i=0;i<20;i++)s=applyLearning(s,'mike',{...ambition,title:`Route ${i}`},null,5000+i).next!;
    expect(s.ambitionHistory).toHaveLength(16);expect(validLearningState(s)).toBe(true);
    const broken=structuredClone(s);broken.nextId=1;expect(validLearningState(broken)).toBe(false);
});
function storeFixture(initial:unknown=undefined) {
    let disk=initial,writes=0,fail=false;
    const io:LearningIO={exists:()=>disk!==undefined,read:()=>structuredClone(disk),write:s=>{if(fail)throw Error('disk full');disk=structuredClone(s);writes++;}};
    return {store:new LearningPilotStore(io),io,get writes(){return writes;},disk:()=>disk,setFail:()=>{fail=true;}};
}
test('imports/constructor do not initialize; explicit startup preserves expiry across restart',()=>{
    const h=storeFixture();expect(h.writes).toBe(0);expect(h.store.context('mike','coal')).toBe('');expect(h.writes).toBe(0);
    h.store.initialize(1000);expect(h.writes).toBe(1);
    const restart=new LearningPilotStore(h.io);restart.initialize(5000);expect(restart.snapshot()?.expiresAt).toBe(86401000);expect(h.writes).toBe(1);
});
test('invalid existing state is preserved and disabled, never reinitialized',()=>{
    const h=storeFixture({version:999});let warnings=0;h.store.setReporter(()=>{warnings++;});h.store.initialize();
    h.store.initialize();h.store.handle(event(),'run');expect(h.writes).toBe(0);expect(h.disk()).toEqual({version:999});expect(warnings).toBe(1);
});
test('failed subscriber/save/reporter cannot escape, mutate memory or cause a stale later save',()=>{
    const h=storeFixture();h.store.initialize();const original=h.store.snapshot();h.setFail();h.store.setReporter(()=>{throw Error('reporter down');});
    expect(()=>h.store.handle(event(),'run')).not.toThrow();expect(h.store.snapshot()).toEqual(original);
    expect(h.store.accept('mike',ambition,null).changed).toBe(false);expect(h.store.snapshot()).toEqual(original);
});
test('lookup and preflight-rejected proposals cannot update learning; accepted proposal can',()=>{
    const h=storeFixture();h.store.initialize();
    expect(h.store.acceptDecision('mike',{ambition,lookup:'coal'},true).changed).toBe(false);
    expect(h.store.acceptDecision('mike',{ambition,lookup:null},false).changed).toBe(false);
    expect(h.writes).toBe(1);expect(h.store.acceptDecision('mike',{ambition,lookup:null},true).changed).toBe(true);
});

test('already-there travel and stale/future positions are not movement evidence',()=>{
    const s=newPilot(1000),position={x:1,z:2,plane:0};
    expect(captureObservation(s,{...event(2000),action:'travel',xp:{},observedStartPosition:position,observedPosition:position},'run',2000)).toBeUndefined();
    const p={worldX:1,worldZ:2,level:0} as any;
    expect(freshPosition(p,3000,2000)).toBeUndefined();expect(freshPosition(p,1000,8000)).toBeUndefined();
    expect(freshPosition(p,1000,2000)).toMatchObject({x:1,z:2});
});
test('unrelated latest failure cannot displace four matching observations',()=>{
    let s=newPilot(1000);
    for(let i=0;i<4;i++)s=captureObservation(s,{...event(2000+i,`coal site${i}`),bot:'trish'},'run',2000+i)!;
    s=captureObservation(s,{...event(3000,'chicken'),outcome:'blocked',reason:'unrelated fence'},'run',3000)!;
    expect(relevantObservations(s,'mike','coal')).toHaveLength(4);
    expect(relevantObservations(s,'mike','coal').every(o=>o.target.includes('coal'))).toBe(true);
});

test('ambition invitation is optional, once per pilot, and respects existing or retired projects and expiry',()=>{
    let s=newPilot(1000);
    expect(ambitionInvitationDue(s,'mike',undefined,2000)).toBe(true);
    expect(ambitionInvitationDue(s,'mike',2500,3000)).toBe(false);
    expect(ambitionInvitationDue(s,'mike',500,2000)).toBe(true);
    s=applyLearning(s,'wren',ambition,null,2000).next!;
    expect(ambitionInvitationDue(s,'wren',undefined,3000)).toBe(false);
    s=applyLearning(s,'wren',{...ambition,status:'retire'},null,3000).next!;
    expect(ambitionInvitationDue(s,'wren',undefined,4000)).toBe(false);
    expect(ambitionInvitationDue(s,'mike',undefined,s.expiresAt)).toBe(false);
});
test('parentheses in a blocker reason never become a proposed target',()=>{
    const s=newPilot(1000),e={...event(2000),action:'give',target:undefined,outcome:'blocked',summary:'giving coal to mike: nothing gained -> blocked (pack full)'};
    expect(captureObservation(s,e,'run',2000)!.observations[0].target).toBe('');
});

test('batch evidence preserves dated own-bank capacity separately from prose exhaustion',()=>{
 const s=newPilot(1000),e={...event(2000),productionBatch:{known:true,bankAt:1900,units:78,inputs:[{name:'coal',carried:0,banked:468,perUnit:6}]}};
 expect(captureObservation(s,e,'run',2000)!.observations[0].facts).toContain('"banked":468');
});

test('model facts remove repeated zero/position detail while retaining measured inputs and bank evidence',()=>{
 const raw=JSON.stringify({xp:{Smithing:75},durationMs:30000,productionBatch:{known:true,bankAt:1900,units:10,inputs:[{name:'coal',carried:0,banked:60,perUnit:6},{name:'adamantite ore',carried:0,banked:249,perUnit:1}]},smelting:{resolvedAttempts:2,barsProduced:{adamantite:2},confirmedInputsConsumed:{'adamantite ore':2,coal:12},impurityFailures:0,reachFailures:0,consecutiveImpurityFailures:0},observedPosition:{x:1,z:2,plane:0,ageMs:2},observedStartPosition:{x:0,z:2,plane:0,ageMs:2}});
 const compact=compactLearningFacts(raw),facts=JSON.parse(compact);
 expect(facts.smelt.used.coal).toBe(12);expect(facts.batch.bank.coal).toBe(60);expect(facts.batch.bankAt).toBe(1900);expect(facts.batch.recipeUnits).toBe(10);
 expect(compact.length).toBeLessThan(raw.length*.65);
 const losses=JSON.parse(compactLearningFacts(JSON.stringify({smelting:{barsProduced:{iron:1},confirmedInputsConsumed:{'iron ore':3},impurityFailures:2,reachFailures:1}})));
 expect(losses.smelt.ironLosses).toBe(2);expect(losses.smelt.reachFailures).toBe(1);
 expect(compactLearningFacts('not-json')).toBe('not-json');expect(compactLearningFacts('{"newEvidence":42}')).toBe('{"newEvidence":42}');
});
