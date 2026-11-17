import {expect,test} from 'bun:test';
import type {BotWorldState} from '../rs-sdk/sdk/types';
import {REGIONS,expeditionRoutineProblem,addFieldProof,fieldReading,FieldObservation,recordFieldGoal,mergeFieldProgress,bindExpedition,type ExpeditionCheck} from './expedition';
import {expeditionOffer,opportunityMenu,evaluate,refreshMissionWork,type Ctx,type Member} from './missions';
import {toGoal} from './council';
import {renderGoal} from './memory';
import {assignCoverage} from './mission-coordination';
import {missionSelectionReason} from './opportunities';
const region=REGIONS[0],at=1_000_000,people=['bram','wren','mike','trish'];
const check=(member?:string):ExpeditionCheck=>({kind:'expedition',region,participants:people,since:at,...(member?{member}:{minMethods:3})});
const sample={t:at+100,x:region.x,z:region.z,plane:0,xp:10};
const event=(bot='bram',action='mine')=>({t:at+200,bot,type:'order_end' as const,orderStartedAt:at+10,action,target:'iron',outcome:'done',xp:{Mining:10},fieldWork:{startedAt:at+10,samples:[sample]}});
const survey=(bot='bram')=>({...event(bot,'look'),xp:{},fieldWork:undefined,worldObservation:{at:at+150,position:{x:region.x,z:region.z,plane:0},npcs:[],objects:[],items:[]}});
const contribute=(c:ExpeditionCheck,bot:string,action:string)=>addFieldProof(addFieldProof(c,survey(bot),'live')!,event(bot,action),'live')!;

test('all four own contributions plus three activity types are required, not one character or old skill levels',()=>{
 let party=check();for(const n of people)party=contribute(party,n,'mine');
 expect(fieldReading(party).met).toBe(false);
 party=addFieldProof(party,event('wren','fish'),'live')!;party=addFieldProof(party,event('trish','chop_trees'),'live')!;
 expect(fieldReading(party).met).toBe(true);
 for(const n of people)expect(fieldReading(contribute(check(n),n,'mine')).met).toBe(true);
 expect(fieldReading(contribute(check('bram'),'bram','mine')).progress).toContain('observed');
 expect(addFieldProof(check('mike'),event('bram'),'live')).toBeUndefined();
});
test('source age, actor, region, productive location and actual XP sampling are enforced',()=>{
 const variants=[{...event(),orderStartedAt:at-1},{...event(),bot:'outsider'},{...event(),fieldWork:undefined},
 {...event(),fieldWork:{startedAt:at+10,samples:[{...sample,x:0,z:0}]}},
 {...event(),fieldWork:{startedAt:at+10,samples:[{...sample,xp:0}]}},
 {...event(),fieldWork:{startedAt:at+10,samples:[{...sample,plane:1}]}},
 {...event(),action:'smelt'}, {...event(),action:'fight',target:'cow',fight:{engagements:10}}];
 for(const e of variants)expect(addFieldProof(check(),e,'live')).toBeUndefined();
 const fakeEndpoints={...event(),observedStartPosition:{x:region.x,z:region.z,plane:0},observedPosition:{x:region.x,z:region.z,plane:0},fieldWork:{startedAt:at+10,samples:[{...sample,x:0,z:0}]}};
 expect(addFieldProof(check(),fakeEndpoints,'live')).toBeUndefined();
 expect(addFieldProof(check(),{...survey(),worldObservation:{...survey().worldObservation,at:at-1}},'live')).toBeUndefined();
 expect(addFieldProof(check(),survey(),'')).toBeUndefined();
});
test('dispatch success and actual conversation are separate from a claimed successful interaction',()=>{
 const e={...survey(),action:'interact',target:'Doric: Talk-to',worldObservation:{...survey().worldObservation,dialogue:'Bring ores',dispatch:{success:false,message:'rejected'}}};
 expect(addFieldProof(check(),e,'live')).toBeUndefined();
 e.worldObservation.dispatch.success=true;
 expect(addFieldProof(check(),e,'live')!.proofs![0]).toMatchObject({kind:'trial',action:'conversation',dialogue:'Bring ores'});
});
test('field sampler observes XP at actual fresh tiles, suppresses stale and across-death deltas, bounds size',()=>{
 const s={player:{worldX:region.x,worldZ:region.z,level:0,lifeId:1},skills:[{name:'Mining',experience:0}]} as BotWorldState;
 const f=new FieldObservation(at);f.observe(s,at,at);
 s.skills[0].experience=10;s.player!.worldX=0;f.observe(s,at+100,at+100);
 expect(f.samples[0]).toMatchObject({x:0,xp:10});
 s.skills[0].experience=20;s.player!.worldX=region.x;f.observe(s,at+100,at+6000);expect(f.samples).toHaveLength(1);
 s.player!.lifeId=2;s.skills[0].experience=30;f.observe(s,at+7000,at+7000);expect(f.samples).toHaveLength(1);
 for(let i=0;i<12;i++){s.skills[0].experience++;s.player!.worldX++;f.observe(s,at+8000+i,at+8000+i);}
 expect(f.samples).toHaveLength(8);
});
test('proofs survive council awaits/restart, deduplicate and cannot merge into a replaced mission',async()=>{
 const base={key:'regional-project',set:at,milestones:[{id:1,done:false,auto:{check:check('bram')}}]};
 const councilDraft=structuredClone(base);let disk=structuredClone(base);
 await Promise.resolve().then(()=>{disk=recordFieldGoal(disk,survey(),'run')!;disk=recordFieldGoal(disk,event(),'run')!;});
 const merged=mergeFieldProgress(councilDraft,JSON.parse(JSON.stringify(disk)));
 expect(fieldReading(merged.milestones[0].auto.check).met).toBe(true);
 expect(recordFieldGoal(merged,event(),'run')).toBeUndefined();
 expect(mergeFieldProgress({...base,set:at+1},disk).milestones[0].auto.check.proofs).toBeUndefined();
 let c=check();for(const n of people){c=contribute(c,n,'mine');for(const a of ['fish','chop_trees','craft'])c=addFieldProof(c,event(n,a),'run')??c;}
 expect(c.proofs).toHaveLength(16);
});
const members:Member[]=people.map(name=>({name,combat:80,skills:{Mining:75,Fishing:75,Woodcutting:75,Cooking:75,Smithing:75,Defence:50},carried:{coins:1000,'bronze axe':1,'bronze pickaxe':1,shrimps:20},bank:{},worn:[]}));
const ctx:Ctx={members,size:4,has:()=>false,sharedProjects:true};
test('live policy offers shared region projects and excludes solo skill/stock ladders with an honest reason',()=>{
 const pool=opportunityMenu(ctx);
 expect(pool.menu).toHaveLength(1);expect(pool.menu[0].template).toBe('combat-challenge');
 expect(pool.why.find(d=>d.template==='Smithing Workshop')?.why).toContain('personal training');
 expect(pool.menu[0].work.map(w=>w.owner)).toEqual(expect.arrayContaining(people));
 expect(opportunityMenu({...ctx,members:members.slice(0,3)}).menu).toEqual([]);
 const unavailable=expeditionOffer({...ctx,spots:[]},region);expect(typeof unavailable).toBe('string');
});
test('accepted expedition binds fresh timestamp, keeps armour and does not append another achievement grind',()=>{
 const offer=expeditionOffer(ctx,region);expect(typeof offer).not.toBe('string');if(typeof offer==='string')return;
 const goal=toGoal(offer,999,false);
 expect(renderGoal(goal)).toContain('Contribute in parallel');expect(renderGoal(goal)).toContain('FIELDWORK OPTIONS');
 expect(goal.milestones.some(m=>m.auto?.armour)).toBe(true);expect(goal.milestones.some(m=>m.auto?.achievements)).toBe(false);
 for(const m of goal.milestones)if(m.auto?.check?.kind==='expedition')expect(m.auto.check.since).toBe(goal.set);
 const oldKey=goal.key,first=goal.milestones[0].auto!.check as ExpeditionCheck;
 first.proofs=contribute(check('bram'),'bram','mine').proofs!.map(p=>({...p,t:goal.set+100}));const proofs=JSON.stringify(first.proofs);
 refreshMissionWork(goal,ctx);expect(goal.key).toBe(oldKey);expect(JSON.stringify((goal.milestones[0].auto!.check as ExpeditionCheck).proofs)).toBe(proofs);
 expect(bindExpedition(check(),at+10).since).toBe(at+10);expect(evaluate(first,ctx).met).toBe(true);
});

test('a participant contribution stays with that participant even if another character claims the milestone',()=>{
 const offer=expeditionOffer(ctx,region);if(typeof offer==='string')throw Error(offer);
 const goal=toGoal(offer,999,false);
 const bram=goal.milestones.find(m=>m.auto?.check?.kind==='expedition'&&m.auto.check.member==='bram')!;
 const coverage=assignCoverage(goal,new Map([['trish',{commitment:'I will do it',milestone_ids:[bram.id]}]]),people);
 expect(coverage.find(m=>m.milestone===bram.id)?.owner).toBe('bram');
});

test('sampler rejects pre-start and stale baselines instead of assigning old XP to a new location',()=>{
 const s={player:{worldX:region.x,worldZ:region.z,level:0,lifeId:1},skills:[{name:'Mining',experience:0}]} as BotWorldState;
 const f=new FieldObservation(at);f.observe(s,at-10,at);
 s.skills[0].experience=100;f.observe(s,at+10,at+10);expect(f.samples).toHaveLength(0);
 s.skills[0].experience=101;f.observe(s,at+20,at+20);expect(f.samples[0].xp).toBe(1);
 f.observe(null,at+30,at+30);s.skills[0].experience=200;f.observe(s,at+40,at+40);expect(f.samples[0].xp).toBe(1);
 s.skills[0].experience=201;f.observe(s,at+50,at+50);expect(f.samples[0].xp).toBe(2);
 f.observe(s,at+50,at+6000);s.skills[0].experience=500;f.observe(s,at+7000,at+7000);expect(f.samples[0].xp).toBe(2);
});
test('accepted expedition survives temporary tool, funding and food loss without losing evidence',()=>{
 const offer=expeditionOffer(ctx,region);if(typeof offer==='string')throw Error(offer);
 const goal=toGoal(offer,999,false),c=goal.milestones[0].auto!.check as ExpeditionCheck;
 c.proofs=[{kind:'survey',run:'real',t:goal.set+1,bot:'bram',action:'look',target:'',x:region.x,z:region.z,plane:0}];
 const before=JSON.stringify(goal);
 const empty={...ctx,members:members.map(m=>({...m,carried:{},bank:{}}))};
 expect(missionSelectionReason(goal,empty)).toBeNull();expect(JSON.stringify(goal)).toBe(before);
});
test('unsuccessful replacement keeps evidence recorded during the awaited vote before saving retained goal',async()=>{
 const old={key:'region',set:at,milestones:[{id:1,done:false,auto:{check:check('bram')}}]};
 let live=structuredClone(old);const retained=structuredClone(old);
 const chosen=await Promise.resolve().then(()=>{live=recordFieldGoal(live,survey(),'run')!;return null;});
 if(!chosen)mergeFieldProgress(retained,live);
 const saved=JSON.parse(JSON.stringify(retained));expect(saved.milestones[0].auto.check.proofs).toHaveLength(1);
});

test('unsupported production does not masquerade as an owed field contribution; preparation and personal work after completion stay available',()=>{
 const goal={set:at,milestones:[{id:1,done:false,auto:{check:check('mike')}}]};
 const step=(action:string,target:string|null=null)=>({action,args:{target}});
 expect(expeditionRoutineProblem(goal,'mike',[step('look'),step('smith','iron dagger')])).toContain('still pending');
 expect(expeditionRoutineProblem(goal,'mike',[step('smith','iron dagger'),step('mine','iron')])).toBeNull();
 expect(expeditionRoutineProblem(goal,'mike',[step('bank_resources')])).toBeNull();
 expect(expeditionRoutineProblem(goal,'mike',[step('interact','Aubury: Talk-to')])).toBeNull();
 goal.milestones[0].done=true;
 expect(expeditionRoutineProblem(goal,'mike',[step('smith','iron dagger')])).toBeNull();
});
