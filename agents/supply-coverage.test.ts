import {expect,test} from 'bun:test';
import {supplyCoverage,renderSupplyCoverage,createSupplyMonitor,currentSupply,type SupplyStock,type SupplyDemand} from './supply-coverage';
import {partySupplyCoverage,supplyRate,type SupplyActor} from './supply-context';
import type {PartyPlan} from './memory';
import type {AgentEvent} from './events';
import type {BotWorldState} from '../rs-sdk/sdk/types';
const now=10_000_000;
const stock=(name:string,bank:Record<string,number>,t=now):SupplyStock=>({name,bank,bankAt:t,carried:{}});
const demand=(over:Partial<SupplyDemand>={}):SupplyDemand=>({receiver:'smith',action:'smelt',target:'adamant',item:'coal',perUnit:6,unitsPerMinute:2,basis:'prior',primary:true,...over});
test('working supplies use a bulk horizon, not a single recipe, and preserve a proposed donor reserve',()=>{
 const rows=supplyCoverage([stock('smith',{coal:0}),stock('supplier',{coal:4000})],[demand()],now);
 expect(rows[0]).toMatchObject({held:0,target:540,short:540,low:true});
 expect(rows[0].suppliers).toEqual([{name:'supplier',available:3000,reserve:1000,offer:540}]);
 expect(renderSupplyCoverage(rows)).toContain('unaccepted suggestion');
 expect(renderSupplyCoverage(rows)).toContain('historical deliveries');
});
test('stock above low threshold is covered; depletion reopens despite prior delivery',()=>{
 const ss=[stock('smith',{coal:540}),stock('supplier',{coal:3000})];
 expect(supplyCoverage(ss,[demand()],now)[0].low).toBe(false);
 ss[0].bank!.coal=119;expect(supplyCoverage(ss,[demand()],now)[0].low).toBe(true);
 ss[0].bank!.coal=120;expect(supplyCoverage(ss,[demand()],now)[0].low).toBe(false);
});
test('unknown and stale banks are not confirmed zero or spendable supplier stock',()=>{
 const unknown:SupplyStock={name:'smith',carried:{}};
 const rows=supplyCoverage([unknown,stock('supplier',{coal:5000},now-1800_001)],[demand()],now);
 expect(rows[0]).toMatchObject({bankKnown:false,low:false,suppliers:[]});
 expect(renderSupplyCoverage(rows)).toContain('VERIFY BANK');
 expect(currentSupply(stock('x',{coal:12},now+1),'coal',now).held).toBe(0);
});
test('primary requirements override fallback; alternative demand is not summed; provider work is protected',()=>{
 const rows=supplyCoverage([stock('smith',{coal:0}),stock('supplier',{coal:500})],
 [demand(),demand({perUnit:100,primary:false}),demand({receiver:'supplier',unitsPerMinute:1})],now);
 const row=rows.find(r=>r.demand.receiver==='smith')!;
 expect(row.target).toBe(540);expect(row.suppliers[0]).toMatchObject({reserve:270,offer:230});
});
test('co-input limit and hard caps bound working targets without disappearing on missing co-inputs',()=>{
 expect(supplyCoverage([stock('smith',{coal:0})],[demand({unitsCap:10})],now)[0].target).toBe(60);
 expect(supplyCoverage([stock('smith',{coal:0})],[demand({unitsPerMinute:60})],now)[0].target).toBe(2000);
 expect(supplyCoverage([stock('smith',{})],[demand()],now)[0].low).toBe(true);
 expect(supplyCoverage([stock('smith',{})],[demand({unitsPerMinute:NaN})],now)).toEqual([]);
});
test('minute hook defers startup, uses current facts, throttles15min, and reopens depleted stock',()=>{
 let ready=false,time=now,calls=0;const messages:string[]=[];let coal=0;
 const tick=createSupplyMonitor({ready:()=>ready,now:()=>time,
 rows:()=>supplyCoverage([stock('smith',{coal},time),stock('supplier',{coal:4000},time)],[demand()],time),
 notice:m=>messages.push(m),council:()=>{calls++;}});
 tick();expect(calls).toBe(0);ready=true;tick();tick();expect(calls).toBe(1);
 coal=540;time+=900_000;tick();expect(calls).toBe(1);
 coal=0;tick();expect(calls).toBe(2);expect(messages[1]).toContain('Historical delivery');
});
const state=(items:Record<string,number>={},skills:Record<string,number>={}):BotWorldState=>({inGame:true,
 inventory:Object.entries(items).map(([name,count],slot)=>({name,count,slot,id:slot+1,optionsWithIndex:[]})),equipment:[],
 skills:Object.entries({Smithing:77,Mining:88,Woodcutting:80,Fishing:30,Cooking:90,Hitpoints:30,...skills}).map(([name,level])=>({name,level,baseLevel:level,experience:0})),
 player:{worldX:3253,worldZ:3420,level:0,hp:30,maxHp:30,combatLevel:40}} as unknown as BotWorldState);
const actor=(name:string,steps:{action:string;args:{target:string|null}}[]=[],s=state()):SupplyActor=>({name,sdk:{getState:()=>s,getStateAge:()=>0},routine:{steps},routineStep:0});
const plan=(done=false):PartyPlan=>({teamGoal:{work:[{owner:'smith',action:'smelt',target:'adamant',amount:12},{owner:'smith',action:'smith',target:'adamant dagger',amount:12},{owner:'smith',action:'cook',target:'invented stale fish'}],milestones:[
 {id:1,owner:'smith',done,auto:{check:{kind:'skill',skill:'Smithing',level:80,who:'any',member:'smith'}}},
 {id:2,owner:'smith',done:true,auto:{check:{kind:'skill',skill:'Cooking',level:90,who:'any',member:'smith'}}}]}} as PartyPlan);
test('fresh per-milestone chains keep adamant input visible during bronze fallback and discard completed/stale work',()=>{
 const actors=[actor('smith',[{action:'smelt',args:{target:'bronze'}}]),actor('supplier')];
 const banks=(name:string):{t:number;items:Record<string,number>}=>({t:now,items:name==='smith'?{'Adamantite ore':347,'Hammer':1,'Coins':1000,'Bronze pickaxe':1}:{'Coal':4000}});
 const rows=partySupplyCoverage(actors,plan(),banks,[],now);
 expect(rows.some(r=>r.demand.receiver==='smith'&&r.demand.item==='coal'&&r.demand.primary)).toBe(true);
 expect(rows.some(r=>r.demand.item.includes('invented'))).toBe(false);
 expect(partySupplyCoverage(actors,plan(true),banks,[],now).some(r=>r.demand.primary)).toBe(false);
 // Intermediate bars aren't external requirements when the same chain produces them.
 expect(rows.some(r=>r.demand.primary&&r.demand.item==='adamantite bar')).toBe(false);
});
test('feathers are one per estimated catch, not the30-feather readiness buffer per catch',()=>{
 const actors=[actor('angler',[{action:'fish',args:{target:'trout'}}])];
 const rows=partySupplyCoverage(actors,{} as PartyPlan,()=>({t:now,items:{}}),[],now);
 const feather=rows.find(r=>r.demand.item==='feather'||r.demand.item==='feathers')!;
 expect(feather).toBeDefined();expect(feather.demand.perUnit).toBe(1);expect(feather.target).toBe(180);
});
test('food estimates use healing units and omit stale supplier-only food choices',()=>{
 const actors=[actor('fighter',[{action:'fight',args:{target:'white knight'}}])];
 const rows=partySupplyCoverage(actors,{} as PartyPlan,()=>({t:now,items:{'Swordfish':100}}),[],now);
 expect(rows[0].demand.item).toBe('cooked food (nominal healing HP)');expect(rows[0].target).toBeGreaterThan(0);
 expect(partySupplyCoverage(actors,{} as PartyPlan,()=>({t:now-1800_001,items:{'Swordfish':100}}),[],now)[0]).toMatchObject({held:0,low:false,bankKnown:false});
 const depleted=partySupplyCoverage(actors,{} as PartyPlan,()=>({t:now,items:{}}),[],now)[0];expect(depleted.low).toBe(true);expect(depleted.suppliers).toEqual([]);
});
test('smelting estimates require observed attempts and matching recipe; duration includes preparation',()=>{
 const e={bot:'smith',type:'order_end',action:'smelt',target:'adamant',t:now-1000,durationMs:60_000,smelting:{resolvedAttempts:3}} as AgentEvent;
 expect(supplyRate([e],'smith','smelt','adamant',now).rate).toBe(3);
 expect(supplyRate([e],'smith','smelt','bronze',now).basis).toContain('prior');
 expect(supplyRate([{...e,durationMs:1}],'smith','smelt','adamant',now).basis).toContain('prior');
});

test('actual singular Feather stock covers fishing demand, including donor surplus',()=>{
 const actors=[actor('angler',[{action:'fish',args:{target:'trout'}}]),actor('supplier')];
 const banks=(name:string):{t:number;items:Record<string,number>}=>({t:now,items:name==='angler'?{'Feather':200}:{'Feather':500}});
 let rows=partySupplyCoverage(actors,{} as PartyPlan,banks,[],now);
 expect(rows.find(r=>r.demand.item==='feather')).toMatchObject({held:200,low:false});
 rows=partySupplyCoverage(actors,{} as PartyPlan,n=>n==='angler'?{t:now,items:{}}:banks(n),[],now);
 expect(rows.find(r=>r.demand.item==='feather')!.suppliers[0].offer).toBe(180);
});
test('mission intent remains visible with existing intermediate bars, missing funding and an unrelated stale peer',()=>{
 const actors=[actor('smith',[{action:'smelt',args:{target:'bronze'}}]),{...actor('stale'),sdk:{getState:()=>state(),getStateAge:()=>31_000}}];
 const rows=partySupplyCoverage(actors,plan(),()=>({t:now,items:{'Adamantite ore':347,'Adamantite bar':20}}),[],now);
 expect(rows.find(r=>r.demand.item==='coal')).toMatchObject({low:true,demand:{primary:true,target:'adamant'}});
});
test('supported own fish-to-cook and chop-to-firemake pipelines do not request intermediate stock',()=>{
 const actors=[actor('chef',[{action:'fish',args:{target:'trout'}},{action:'cook',args:{target:'trout'}}]),
 actor('logger',[{action:'chop_trees',args:{target:'logs'}},{action:'firemake',args:{target:null}}])];
 const rows=partySupplyCoverage(actors,{} as PartyPlan,()=>({t:now,items:{}}),[],now);
 expect(rows.some(r=>r.demand.item==='raw trout'||r.demand.item==='logs')).toBe(false);
 expect(rows.some(r=>r.demand.item==='feather')).toBe(true);
});
test('equal capped targets retain the faster consumption rate for refill decisions',()=>{
 const rows=supplyCoverage([stock('smith',{coal:1900})],[demand({unitsPerMinute:30}),demand({unitsPerMinute:60})],now);
 expect(rows[0].target).toBe(2000);expect(rows[0].low).toBe(true);
});
test('food suggestions are whole fish and retain a physical food reserve',()=>{
 const food='cooked food (nominal healing HP)',d=demand({item:food,perUnit:1,unitsPerMinute:3});
 const small={...stock('supplier',{[food]:14}),foods:[{name:'swordfish',count:1,heals:14}]};
 expect(supplyCoverage([stock('smith',{[food]:0}),small],[d],now)[0].suppliers).toEqual([]);
 const mixed={...stock('supplier',{[food]:206}),foods:[{name:'swordfish',count:1,heals:14},{name:'shrimps',count:64,heals:3}]};
 const candidate=supplyCoverage([stock('smith',{[food]:0}),mixed],[d],now)[0].suppliers[0];
 const given=candidate.items!.reduce((n,i)=>n+i.count*(i.name==='swordfish'?14:3),0);
 expect(given).toBe(candidate.offer);expect(206-given).toBeGreaterThanOrEqual(candidate.reserve);
 expect(candidate.items!.every(i=>Number.isInteger(i.count))).toBe(true);
});
test('jewellery intent retains its upstream gold smelting during fallback',()=>{
 const p={teamGoal:{work:[{owner:'crafter',action:'smelt',target:'gold'},{owner:'crafter',action:'craft',target:'gold ring'}],milestones:[{done:false,owner:'crafter',auto:{check:{kind:'skill',skill:'Crafting',level:50,member:'crafter',who:'any'}}}]}} as unknown as PartyPlan;
 const rows=partySupplyCoverage([actor('crafter',[],state({}, {Crafting:40}))],p,()=>({t:now,items:{}}),[],now);
 expect(rows.some(r=>r.demand.item==='gold ore'&&r.demand.primary)).toBe(true);
 expect(rows.some(r=>r.demand.item==='gold bar')).toBe(false);
});

test('resumed nonrepeat pipeline and verified own raw inputs suppress false external bar shortages',()=>{
 const work=[{action:'smelt',args:{target:'adamant'}},{action:'smith',args:{target:'adamant dagger'}},{action:'bank_resources',args:{target:null}}];
 const a={...actor('smith',work),routineStep:1};
 const p=plan();p.teamGoal!.work=p.teamGoal!.work!.filter(w=>w.action==='smith');
 const rows=partySupplyCoverage([a],p,()=>({t:now,items:{'Coal':468,'Adamantite ore':337}}),[],now);
 expect(rows.some(r=>r.demand.item==='adamantite bar')).toBe(false);
 expect(rows.find(r=>r.demand.item==='coal')).toMatchObject({held:468,low:false});
 expect(rows.some(r=>r.demand.item==='adamantite ore')).toBe(true);
});
test('existing bars alone do not invent smelting demands; later smelting cannot supply an earlier smith step',()=>{
 const bars=()=>({t:now,items:{'Steel bar':100}});
 const rows=partySupplyCoverage([actor('smith',[{action:'smith',args:{target:'steel dagger'}}])],{} as PartyPlan,bars,[],now);
 expect(rows.map(r=>r.demand.item)).toEqual(['steel bar']);expect(rows[0].low).toBe(false);
 const reversed=[{action:'smith',args:{target:'steel dagger'}},{action:'smelt',args:{target:'steel'}}];
 const bad=partySupplyCoverage([actor('smith',reversed)],{} as PartyPlan,()=>({t:now,items:{}}),[],now);
 expect(bad.some(r=>r.demand.item==='steel bar')).toBe(true);
});
