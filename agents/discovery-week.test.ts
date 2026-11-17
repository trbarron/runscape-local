import {test,expect} from 'bun:test';
import type {BotWorldState} from '../rs-sdk/sdk/types';
import type {Spot} from './world-index/index';
import {observeWorld,validWorldObservation} from './world-observation';
import {newPilot,extendDiscoveryWeek,validLearningState,captureObservation,applyLearning,learningContext} from './learning-pilot';
import {LearningPilotStore} from './learning';
import {discoveryOptions} from './discovery-options';
const scene=()=>({player:{name:'trish',worldX:3200,worldZ:3300,level:0,hp:70,maxHp:70,combatLevel:80},
 nearbyNpcs:[{name:'Doric',distance:2,reachable:true,optionsWithIndex:[{text:'Talk-to'}]}],
 nearbyLocs:[{name:'Rock',optionsWithIndex:[{text:'Mine'}]}],groundItems:[{name:'Bones'}]} as unknown as BotWorldState);
const epoch=100_000_000,extended=()=>extendDiscoveryWeek(newPilot(1000),epoch);
const event=(t=epoch+1000,action='look')=>({t,bot:'trish',type:'order_end' as const,action,target:'',outcome:'done',summary:'Observed scene',xp:{},worldObservation:observeWorld(scene(),t,t)});

test('week renewal is explicit, once-only, preserves ids/content and survives ordinary startup',()=>{
 const old=newPilot(1000);old.nextId=42;
 const next=extendDiscoveryWeek(old,epoch);
 expect(old.extension).toBeUndefined();expect(next.nextId).toBe(42);expect(next.startedAt).toBe(old.startedAt);
 expect(next.expiresAt).toBe(epoch+7*86400_000);expect(validLearningState(next)).toBe(true);
 expect(extendDiscoveryWeek(next,epoch+60000)).toEqual(next);
 let disk=next,writes=0;
 const store=new LearningPilotStore({exists:()=>true,read:()=>disk,write:s=>{disk=s;writes++;}});
 store.initialize(epoch+50000);expect(writes).toBe(0);expect(store.snapshot()?.expiresAt).toBe(next.expiresAt);
 for(const extension of [{...next.extension!,previousExpiresAt:123},{...next.extension!,startedAt:0},{...next.extension!,expiresAt:Infinity}]) {
  const bad={...next,extension};expect(validLearningState(bad)).toBe(false);expect(()=>extendDiscoveryWeek(bad,epoch+1)).toThrow();
 }
});
test('world observations need fresh real coordinates and bound arbitrary scene/dialogue payloads',()=>{
 expect(observeWorld(scene(),epoch-5001,epoch)).toBeUndefined();expect(observeWorld(scene(),epoch+1,epoch)).toBeUndefined();
 expect(observeWorld(scene(),undefined,epoch)).toBeUndefined();
 const s=scene();s.nearbyNpcs=Array.from({length:100},(_,i)=>({name:'NPC'+i+'x'.repeat(200),optionsWithIndex:[{text:'Talk-to'+'x'.repeat(200)}]} as any));
 const w=observeWorld(s,epoch,epoch,'actual dialogue '.repeat(100),{success:false,message:'dispatch rejected'})!;
 expect(JSON.stringify(w).length).toBeLessThanOrEqual(1400);expect(validWorldObservation(w)).toBe(true);
 expect(validWorldObservation(observeWorld(s,epoch,epoch,'"'.repeat(500),{success:false,message:'"'.repeat(120)}))).toBe(true);
 expect(w.position).toEqual({x:3200,z:3300,plane:0});expect(w.dialogue!.length).toBeLessThanOrEqual(500);expect(w.dispatch?.success).toBe(false);
});
test('successful look and dialogue enter extended guide; repeated scene sampled, different place retained',()=>{
 const first=captureObservation(extended(),event(),'run',epoch+1000)!;
 expect(first.observations[0].world?.npcs).toContain('Doric:Talk-to');
 expect(captureObservation(first,event(epoch+2000),'run',epoch+2000)).toBeUndefined();
 const e=event(epoch+3000);e.worldObservation!.position.x++;
 expect(captureObservation(first,e,'run',e.t)).toBeDefined();
 expect(captureObservation(first,{...event(),worldObservation:undefined},'run',epoch+1000)).toBeUndefined();
 const context=learningContext(first,'trish','Doric',epoch+1001);expect(context).toContain('Doric:Talk-to');expect(context.length).toBeLessThanOrEqual(3500);
});
test('world evidence retention survives ordinary production flood without dangling source or result notes',()=>{
 let s=extended();
 for(let i=0;i<30;i++) {const e=event(epoch+1000+i);e.worldObservation!.position.x+=i;s=captureObservation(s,e,'run',e.t)!;}
 for(let i=0;i<150;i++)s=captureObservation(s,{t:epoch+2000+i,bot:'mike',type:'order_end',action:'mine',target:'ore'+i,outcome:'done',xp:{Mining:5}},'run',epoch+2000+i)!;
 expect(s.observations.length).toBe(128);expect(s.observations.filter(o=>o.world).length).toBeGreaterThanOrEqual(24);expect(validLearningState(s)).toBe(true);
});
test('experiment closure requires a hypothesis and later result; both citations remain visible and unverified',()=>{
 let s=captureObservation(extended(),event(),'run',epoch+1000)!;
 const note={evidence_id:s.observations[0].id,interpretation:'Doric may offer a task',next_test:'Talk to Doric',status:'open' as const};
 s=applyLearning(s,'trish',null,note,epoch+2000).next!;
 const e=event(epoch+3000,'interact');e.worldObservation!.dialogue='Bring these ores';s=captureObservation(s,e,'run',e.t)!;
 const result=s.observations[1].id;
 expect(applyLearning(s,'trish',null,{...note,status:'supported',result_evidence_id:note.evidence_id},epoch+4000).next).toBeUndefined();
 s=applyLearning(s,'trish',null,{...note,status:'supported',result_evidence_id:result},epoch+4000).next!;
 expect(s.interpretations[0].createdAt).toBe(epoch+2000);expect(validLearningState(s)).toBe(true);
 const context=learningContext(s,'trish','Doric',epoch+5000);expect(context).toContain('UNVERIFIED');expect(context).toContain('later result '+result);expect(context).toContain('Bring these ores');
 const bad=structuredClone(s);bad.interpretations[0].createdAt=epoch+3500;expect(validLearningState(bad)).toBe(false);
});
test('old failures are labelled historical and extended expiry remains read-only',()=>{
 const s=captureObservation(extended(),{...event(),outcome:'blocked',reason:'route blocked'},'run',epoch+1000)!;
 expect(learningContext(s,'trish','look',epoch+7*3600_000)).toContain('HISTORICAL');
 expect(captureObservation(s,event(s.expiresAt),'run',s.expiresAt)).toBeUndefined();
});
const spots:Spot[]=[{kind:'rock',type:'coal',x:3250,z:3300,near:'Mine',count:3},
 {kind:'monster',type:'guard',x:3260,z:3300,near:'Town',count:3,level:21,hp:22},
 {kind:'fishing',type:'cage/harpoon',x:3200,z:3350,near:'Island',count:3,via:'Karamja'}];
test('discovery candidates are optional, varied, fresh, bounded and avoid ferry, deep wilderness and recent visits',()=>{
 const s=scene(),g=extended();const text=discoveryOptions(s,0,spots,g,epoch+1000);
 expect(text).toContain('Doric: Talk-to');expect(text).toContain('3250,3300');expect(text).toContain('guard');expect(text).not.toContain('Island');expect(text.length).toBeLessThanOrEqual(1000);
 expect(discoveryOptions(s,6000,spots,g,epoch+1000)).toBe('');expect(discoveryOptions(s,0,spots,g,g.expiresAt)).toBe('');
 const learned=captureObservation(g,{...event(),worldObservation:{...event().worldObservation!,position:{x:3250,z:3300,plane:0}}},'run',epoch+1000)!;
 expect(discoveryOptions(s,0,spots,learned,epoch+2000)).not.toContain('Survey:');
 expect(discoveryOptions(s,0,spots.map(x=>({...x,z:3600})),g,epoch+1000)).not.toContain('Survey:');
});

test('result older than the hypothesis and closure without a hypothesis are rejected',()=>{
 let s=captureObservation(extended(),event(),'run',epoch+1000)!;
 const e=event(epoch+1500,'interact');e.worldObservation!.dialogue='a real new reply';s=captureObservation(s,e,'run',e.t)!;
 const note={evidence_id:s.observations[0].id,interpretation:'Maybe a route',next_test:'Check it',status:'supported' as const,result_evidence_id:s.observations[1].id};
 expect(applyLearning(s,'trish',null,note,epoch+3000).next).toBeUndefined();
 s=applyLearning(s,'trish',null,{...note,status:'open',result_evidence_id:null},epoch+2000).next!;
 expect(applyLearning(s,'trish',null,note,epoch+3000).next).toBeUndefined();
});
test('facts remain parseable when one event has oversized numeric detail',()=>{
 const e={...event(),xp:{},fight:{extra:'x'.repeat(4000)}};
 const s=captureObservation(extended(),e,'run',e.t)!;
 const facts=JSON.parse(s.observations[0].facts);expect(facts.omitted).toContain('fight');
});

test('world sampling ignores requested labels, action and dispatch metadata for identical observed scenes',()=>{
 const first=captureObservation(extended(),event(),'run',epoch+1000)!;
 const e={...event(epoch+2000,'choose'),target:'some arbitrary label'};
 e.worldObservation!.dispatch={success:false,message:'different dispatch'};
 expect(captureObservation(first,e,'run',e.t)).toBeUndefined();
 expect(captureObservation(first,{...e,outcome:'blocked',reason:'dispatch failed'},'run',e.t)).toBeDefined();
});
test('result excerpt reserves space for decisive dialogue and historical date even when only source matches',()=>{
 let s=captureObservation(extended(),{...event(),action:'mine',target:'cobalt',worldObservation:undefined,xp:{Mining:1}},'run',epoch+1000)!;
 const note={evidence_id:s.observations[0].id,interpretation:'Maybe a supply task',next_test:'Ask a local',status:'open' as const};
 s=applyLearning(s,'trish',null,note,epoch+2000).next!;
 const e=event(epoch+3000,'interact');
 e.worldObservation!.npcs=Array.from({length:6},(_,i)=>'NPC'+i+'x'.repeat(55));
 e.worldObservation!.objects=Array.from({length:6},(_,i)=>'Obj'+i+'y'.repeat(55));
 e.worldObservation!.dialogue='UNIQUE_TASK_REPLY';
 s=captureObservation(s,e,'run',e.t)!;
 s=applyLearning(s,'trish',null,{...note,status:'supported',result_evidence_id:s.observations[1].id},epoch+4000).next!;
 const rendered=learningContext(s,'mike','cobalt',epoch+7*3600_000);
 expect(rendered).toContain('UNIQUE_TASK_REPLY');expect(rendered).toContain('later result obs-2 @');expect(rendered).toContain('HISTORICAL');
});
test('retention protects both citation endpoints through world and production churn',()=>{
 let s=extended();
 for(let i=0;i<128;i++)s=captureObservation(s,{...event(epoch+1000+i),action:'mine',target:'ore'+i,worldObservation:undefined,xp:{Mining:1}},'run',epoch+1000+i)!;
 //32notes protect64ordinary endpoints, alongside64uncited world observations.
 for(let i=0;i<64;i++)s.observations[i].world=event().worldObservation;
 s.interpretations=Array.from({length:32},(_,i)=>({author:'trish',evidence_id:s.observations[64+i*2].id,result_evidence_id:s.observations[65+i*2].id,interpretation:'Check',next_test:'Retest',status:'supported' as const,createdAt:epoch,t:epoch+5000}));
 expect(validLearningState(s)).toBe(true);
 //Retained notes must keep both endpoints through mixed-class eviction and production flood.
 for(let i=0;i<70;i++)s=captureObservation(s,{...event(epoch+6000+i),action:'mine',target:'new'+i,worldObservation:undefined,xp:{Mining:1}},'run',epoch+6000+i)!;
 expect(validLearningState(s)).toBe(true);
 expect(s.interpretations).toHaveLength(32);
 expect(s.interpretations.every(n=>s.observations.some(o=>o.id===n.evidence_id)&&s.observations.some(o=>o.id===n.result_evidence_id))).toBe(true);
});
