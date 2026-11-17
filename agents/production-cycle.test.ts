import {expect,test} from 'bun:test';
import type {BotWorldState} from '../rs-sdk/sdk/types';
import type {PlannedStep} from './readiness';
import {automaticProductionCycle,ownedProduction,productionBatchText,productionInputs} from './production-cycle';
import {routineBankOutputs} from './production-batch';
const s=(items:{name:string;count:number}[]=[])=>({inventory:items.map((i,slot)=>({...i,slot,id:slot+1,optionsWithIndex:[]})),equipment:[],skills:[{name:'Smithing',baseLevel:99},{name:'Cooking',baseLevel:90},{name:'Crafting',baseLevel:99}]} as unknown as BotWorldState);
const step=(action:string,target:string|null,type='exhausted'):PlannedStep=>({action,args:{target},until:{type,skill:null,value:10}});
const pipeline=[step('withdraw_from_bank','adamantite ore','gathered'),step('smelt','adamant'),step('smith','adamant dagger'),step('bank_resources',null)];
const now=10000;
test('only complete own-stock exhausted production pipelines auto-cycle, preserving explicit quotas',()=>{
 expect(automaticProductionCycle(pipeline)).toBe(true);
 for(const type of ['gathered','minutes','skill_level'])expect(automaticProductionCycle([...pipeline.slice(0,2),step('smith','adamant dagger',type),pipeline[3]])).toBe(false);
 expect(automaticProductionCycle(pipeline.slice(0,-1))).toBe(false);
 expect(automaticProductionCycle([...pipeline,step('travel','Varrock')])).toBe(false);
 expect(automaticProductionCycle([...pipeline, {...step('give',null),give:{to:'other',item:'dagger',amount:1}}])).toBe(false);
 expect(automaticProductionCycle([step('fletch','invented product'),step('bank_resources',null)])).toBe(false);
});
test('owned bank supply distinguishes another load from an external shortage and stale views',()=>{
 const bank={t:now,items:{'Coal':468,'Adamantite ore':337}};
 const facts=ownedProduction(s(),bank,pipeline,now);
 expect(facts.units).toBe(78);expect(productionBatchText(facts)).toContain('withdraw next batch');
 expect(ownedProduction(s(),{...bank,items:{'Coal':5,'Adamantite ore':337}},pipeline,now).units).toBe(0);
 expect(ownedProduction(s(),{...bank,t:now-1800001},pipeline,now).known).toBe(false);
 expect(productionBatchText(ownedProduction(s(),undefined,pipeline,now))).toContain('verify');
});
test('multi-bar downstream recipes propagate ratios and credit observed intermediate bank stock',()=>{
 const plan=[step('smelt','steel'),step('smith','steel platebody'),step('bank_resources',null)];
 const inputs=productionInputs(s(),plan)!;
 expect(inputs.find(n=>n.name==='coal')!.count).toBe(10);
 expect(ownedProduction(s(),{t:now,items:{Coal:2,'Iron ore':1}},plan,now).units).toBe(0);
 expect(ownedProduction(s(),{t:now,items:{Coal:2,'Iron ore':1,'Steel bar':4}},plan,now).units).toBe(1);
 expect(ownedProduction(s(),{t:now,items:{'Steel bar':10}},plan,now).units).toBe(0);
 expect(ownedProduction(s(),{t:now,items:{'Steel bar':10}},[step('smith','steel platebody'),step('bank_resources',null)],now).units).toBe(2);
});
test('single same-name carried notes cannot authorize another cycle without bank proof',()=>{
 expect(ownedProduction(s([{name:'Coal',count:6},{name:'Adamantite ore',count:1}]),{t:now,items:{}},pipeline,now).units).toBe(0);
});
test('named crafting and fletching outputs are included without adding unrelated gear',()=>{
 expect(routineBankOutputs([step('craft','gold ring'),step('fletch','arrow shafts'),step('equip','steel sword')])).toEqual(['gold ring','arrow shaft']);
});
