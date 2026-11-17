import { FightObservation } from './fight-report';
import { subscribe } from './events';
import { assistPairs } from './assist';
import { agents } from './party';
import { expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem } from '../rs-sdk/sdk/types';
import { nextPreparation, preflightRoutine, satisfiedStep, type PlannedStep } from './readiness';
import { equipmentBlocker, isStackable, smithRecipe, withdrawAmount } from './game-requirements';
import { shopSelling } from './shops';
import { SKILLS, workRequirements, bankDepositNeeded } from './skills';
import { Agent } from './agent';

const item = (name: string, count = 1, slot = 0): InventoryItem => ({ name, count, slot, id: slot + 1, optionsWithIndex: [] });
const state = (inventory: InventoryItem[] = [], levels: Record<string, number> = {}, equipment: InventoryItem[] = []) => ({
    inventory, equipment, skills: Object.entries({ Mining: 1, Smithing: 1, Defence: 1, Ranged: 1, ...levels }).map(([name, baseLevel]) => ({ name, baseLevel, level: baseLevel, experience: 0 })),
    player: { name: 'readiness-test', worldX: 3229, worldZ: 3437, hp: 10, maxHp: 10, combatLevel: 3 }
} as BotWorldState);
const step = (action: string, target: string | null = null, amount?: number): PlannedStep => ({ action, args: { target, amount }, until: { type: 'minutes', skill: null, value: 10 } });

test('shortbow level blocks before supply preparation; beginner shafts remain available', () => {
    const s=state([], {Fletching:1});
    expect(nextPreparation(s, {Logs:100}, step('fletch','shortbow')).blocker).toContain('Fletching 5');
    expect(preflightRoutine(s, {Logs:100}, [step('fletch','shortbow')])).toContain('Fletching 5');
    expect(workRequirements(s,'fletch',{target:'arrow shaft'}).blocker).toBeNull();
    s.skills.find(k=>k.name==='Fletching')!.baseLevel=5;
    expect(workRequirements(s,'fletch',{target:'shortbow'}).blocker).toBeNull();
});

test('real exhausted production execution keeps a tool-only failed pass blocked without a batch-success report', async () => {
    const s=state([item('Logs')],{Fletching:5});
    s.player!.combat={inCombat:false,targetType:'none',targetIndex:-1,lastDamageTick:-1};
    const agent:any=Object.create(Agent.prototype),original=SKILLS.fletch.run;
    Object.assign(agent,{name:'production-tool-test',stopped:false,pending:null,inbox:[],memory:{},
        sdk:{getState:()=>s,getInventory:()=>s.inventory},bot:{},
        xp:()=>({}),xpGainedSince:()=>({}),knownBlock:()=>null,rememberBlock:()=>{},
        checkDeath:()=>null,waitAlive:async()=>true,planningIO:{bank:()=>({t:Date.now(),items:{Logs:100}})}});
    SKILLS.fletch.run=async()=>{s.inventory.push(item('Knife'));return 'could not fletch a shortbow';};
    try {
        const order={...step('fletch','shortbow'),until:{type:'exhausted',value:0,skill:null},label:'fletch shortbow'};
        const result=await agent.execute(order);
        expect(result.ended.kind).toBe('blocked');expect(result.progress).toBe(false);
        expect(result.summary).toContain('+1 Knife');
        expect(result.summary).not.toContain('Batch finished');
    } finally {SKILLS.fletch.run=original;}
});

test('useful output short of a count target is partial when its remaining materials are unavailable', async () => {
    for (const target of [1,2]) {
        const s=state([item('Hammer'),item('Steel bar')],{Smithing:64});
        const agent:any=Object.create(Agent.prototype);
        Object.assign(agent,{name:'production-recovery-test',stopped:false,pending:null,inbox:[],stepNotes:[],
            sdk:{getState:()=>s,getInventory:()=>s.inventory},checkDeath:()=>null,waitAlive:async()=>true,
            untilMet:(_:unknown,g:Map<string,number>)=>(g.get('Steel med helm')??0)>=target,
            runPass:async()=>{s.inventory=[item('Hammer'),item('Steel med helm')];return {gained:new Map([['Steel med helm',1]]),progress:true,aborted:false,blocker:'No steel bars in inventory'};}
        });
        const order=step('smith','steel med helm');order.until={type:'gathered',skill:null,value:target};
        const result=await agent.runOrder(order,Date.now(),new Map());
        expect(result.kind).toBe(target===1?'done':'partial');
        if(target===2)expect(result.why).toContain('unfinished');
    }
});

test('get a usable banked pickaxe before mining; do not equip it unnecessarily', () => {
    const ready = nextPreparation(state(), { 'Rune pickaxe': 1, 'Bronze pickaxe': 1 }, step('mine', 'copper'));
    expect(ready.preparation).toMatchObject({ action: 'withdraw_from_bank', args: { target: 'Bronze pickaxe', amount: 1 } });
    expect(nextPreparation(state([item('Bronze pickaxe')]), {}, step('mine', 'copper'))).toEqual({});
});

test('fund and buy a missing tool when none is banked', () => {
    const ready = nextPreparation(state(), { Coins: 500 }, step('mine', 'copper'));
    expect(ready.preparation?.action).toBe('withdraw_from_bank');
    expect(ready.preparation?.args.target).toBe('Coins');
    expect(nextPreparation(state([item('Coins', 500)]), {}, step('mine', 'copper')).preparation).toMatchObject({ action: 'buy', args: { target: 'Bronze pickaxe', amount: 1 } });
});

test('bank surplus to reserve room for all ingredients, while keeping required tools', () => {
    const inv = [item('Hammer'), ...Array.from({ length: 27 }, (_, i) => item('Logs', 1, i + 1))];
    expect(nextPreparation(state(inv, { Smithing: 18 }), { 'Bronze bar': 5 }, step('smith', 'bronze platebody')).preparation).toMatchObject({ action: 'bank_resources', args: { target: 'Logs' } });
});

test('do not acquire a hammer or travel for a recipe with missing materials', () => {
    expect(nextPreparation(state([item('Coins', 100)]), { 'Iron bar': 10 }, step('smith', 'bronze dagger')).blocker).toContain('bronze bar');
    expect(nextPreparation(state([], { Smithing: 50 }), { 'Mithril ore': 1, Coal: 3 }, step('smelt', 'mithril')).blocker).toContain('4 coal');
});

test('read exact equipment and smithing requirements from game data', () => {
    expect(equipmentBlocker(state(), 'Studded body')).toContain('Ranged 20');
    expect(equipmentBlocker(state([], { Defence: 20, Ranged: 20 }), 'Studded body')).toBeNull();
    expect(smithRecipe('iron dagger')).toEqual({ level: 15, bar: 'iron bar', count: 1 });
    expect(workRequirements(state([], { Smithing: 15 }), 'smith', { target: 'iron dagger' }).blocker).toBeNull();
});

test('reject an unwearable buy-and-equip plan before buying', () => {
    const s = state([item('Coins', 5000)]);
    expect(preflightRoutine(s, {}, [step('buy', 'studded body'), step('equip', 'studded body')])).toContain('buying to equip would fail');
    expect(preflightRoutine(s, {}, [step('buy', 'studded body')])).toBeNull(); // a purchase may be a gift
});

test('validate whole-routine budgets and allow earlier training to satisfy later wear levels', () => {
    expect(preflightRoutine(state([item('Coins', 100)]), {}, [step('buy', 'iron platelegs')])).toContain('coins');
    const train = step('fight', 'cow'); train.until = { type: 'skill_level', skill: 'Defence', value: 5 };
    expect(preflightRoutine(state([item('Coins', 500)]), {}, [train, step('buy', 'steel med helm'), step('equip', 'steel med helm')])).toBeNull();
});

test('already-worn equipment succeeds even without a copy in inventory', async () => {
    const s = state([], {}, [item('Iron platelegs')]);
    const order = step('equip', 'Iron platelegs');
    expect(satisfiedStep(s, order)).toContain('already wearing');
    expect(SKILLS.equip.requires?.(s, order.args)).toBeNull();
    let calls = 0;
    await SKILLS.equip.run({ sdk: { getEquipment: () => s.equipment }, bot: { equipItem: () => { calls++; } } } as any, order.args);
    expect(calls).toBe(0);
});

test('an already-met skill target succeeds without its old tools', () => {
    const order = step('mine', 'copper'); order.until = { type: 'skill_level', skill: 'Mining', value: 20 };
    expect(preflightRoutine(state([], { Mining: 20 }), {}, [order])).toBeNull();
    expect(satisfiedStep(state([], { Mining: 20 }), order)).toContain('target 20 satisfied');
});

test('the executor prepares then continues the original work without a planner call', async () => {
    const s = state([item('Coins', 500)]);
    const calls: string[] = [];
    const agent: any = Object.create(Agent.prototype);
    Object.assign(agent, { name: 'readiness-test', stopped: false, pending: null, inbox: [], stepNotes: [],
        sdk: { getState: () => s, getInventory: () => s.inventory },
        checkDeath: () => null, waitAlive: async () => true, untilMet: () => calls.includes('mine'),
        runPass: async (action: string) => {
            calls.push(action);
            if (action === 'buy') s.inventory.push(item('Bronze pickaxe', 1, 1));
            return { blocker: undefined, aborted: false, gained: new Map(), progress: true };
        }
    });
    const result = await agent.runOrder(step('mine', 'copper'), Date.now(), new Map());
    expect(result.kind).toBe('done');
    expect(calls).toEqual(['buy', 'mine']);
});

test('preparation that changes nothing is blocked instead of looping', async () => {
    const s = state([item('Coins', 500)]);
    const agent: any = Object.create(Agent.prototype);
    let calls = 0;
    Object.assign(agent, { name: 'readiness-test', stopped: false, pending: null, inbox: [], stepNotes: [],
        sdk: { getState: () => s, getInventory: () => s.inventory }, checkDeath: () => null,
        waitAlive: async () => true, untilMet: () => false,
        runPass: async () => { calls++; return { aborted: false, gained: new Map(), progress: false }; }
    });
    expect((await agent.runOrder(step('mine', 'copper'), Date.now(), new Map())).why).toContain('changed no inventory');
    expect(calls).toBe(1);
});

test('fulfilled equip and bank cleanup return done and allow the following step', async () => {
    const s = state([], {}, [item('Iron platelegs')]);
    const agent: any = Object.create(Agent.prototype);
    let work = 0;
    Object.assign(agent, { name: 'readiness-test', sdk: { getState: () => s }, xp: () => ({}), xpGainedSince: () => ({}), packCounts: () => new Map(),
        runOrder: async () => { work++; return { kind: 'done', why: '' }; }
    });
    for (const order of [step('equip', 'Iron platelegs'), step('bank_resources', 'adamantite ore'), step('travel', 'Lumbridge')]) {
        expect((await agent.execute({ ...order, label: order.action })).ended.kind).toBe('done');
    }
    expect(work).toBe(1); // only the travel step needed work
});

test('preparation only fetches gems and fish the character can process', () => {
    expect(nextPreparation(state(), { 'Uncut ruby': 10 }, step('craft', 'cut gems')).blocker).toContain('uncut gems');
    expect(nextPreparation(state(), { 'Raw swordfish': 10 }, step('cook')).blocker).toContain('raw fish');
    expect(nextPreparation(state(), { 'Raw shrimps': 10 }, step('cook')).preparation?.args.target).toBe('Raw shrimps');
});

test('an SDK exception is a blocker rather than a successful one-shot', async () => {
    const s = state(); (s.player as any).combat = { inCombat: false };
    const agent: any = Object.create(Agent.prototype);
    Object.assign(agent, { name: 'readiness-test', memory: {}, stepNotes: [], sdk: { getState: () => s, getInventory: () => [], waitForTicks: async () => { throw new Error('lost game connection'); } },
        xp: () => ({}), xpGainedSince: () => ({}), inventoryCounts: () => new Map() });
    const result = await agent.runPass('rest', { target: null }, Date.now() + 1000);
    expect(result.blocker).toContain('lost game connection');
});

test('partial banked supplies reduce the purchase budget rather than being ignored', () => {
    const price = shopSelling('fire rune')!.item.price;
    const ready = nextPreparation(state([item('Coins', price)], { Magic: 13 }, [item('Staff of air')]), { 'Fire rune': 2, 'Mind rune': 1 }, step('cast', 'fire strike on chicken'));
    expect(ready.blocker).toBeUndefined();
    expect(ready.preparation).toMatchObject({ action: 'withdraw_from_bank', args: { target: 'Fire rune', amount: 2 } });
});

test('reject explicitly withdrawing absent known stock before making the trip', () => {
    expect(preflightRoutine(state(), { 'Bronze med helm': 3 }, [step('withdraw_from_bank', 'Bronze chainbody', 1), step('equip', 'Bronze chainbody')])).toContain('known bank has no Bronze chainbody');
    expect(nextPreparation(state(), { 'Raw shrimps': 10 }, step('withdraw_from_bank', 'cooked shrimps')).blocker).toContain('known bank has no');
    expect(nextPreparation(state(), { Shrimps: 10 }, step('withdraw_from_bank', 'Shrimps (cooked)')).blocker).toBeUndefined();
    expect(preflightRoutine(state([item('Bronze chainbody')]), { Coins: 10 }, [step('bank_resources', 'Bronze chainbody'), step('withdraw_from_bank', 'Bronze chainbody', 1)])).toBeNull();
});

test('reject missing purchase targets and retain stackable equipment support', () => {
    expect(preflightRoutine(state([item('Coins', 500)]), {}, [step('buy')])).toContain('name the item');
    expect(nextPreparation(state([item('Bronze arrow', 50)]), {}, step('equip', 'Bronze arrow'))).toEqual({});
});

test('a stack is not limited by free slots, a slot-per-item withdrawal is', () => {
    expect(isStackable('Coins')).toBe(true);
    expect(isStackable('Fishing bait')).toBe(true);
    expect(isStackable('Iron ore')).toBe(false);
    // 300 coins with 5 slots free: all 300 (this used to fetch 5, and a purchase looped until it gave up).
    expect(withdrawAmount({ want: 300, free: 5, stackable: true, inBank: 7279, noted: false })).toBe(300);
    expect(withdrawAmount({ want: 300, free: 5, stackable: true, inBank: 120, noted: false })).toBe(120);
    expect(withdrawAmount({ want: -1, free: 5, stackable: true, inBank: 7279, noted: false })).toBe(7279);
    expect(withdrawAmount({ want: 28, free: 5, stackable: false, inBank: 900, noted: false })).toBe(5);
    expect(withdrawAmount({ want: -1, free: 5, stackable: false, inBank: 900, noted: false })).toBe(5);
    expect(withdrawAmount({ want: 500, free: 5, stackable: false, inBank: 900, noted: true })).toBe(500);
});

test('cached impossibility blocks before execution, but delivered stock enables the same action', async () => {
    const { rememberBlockedOption } = await import('./blocked-options');
    const s = state();
    const order = { ...step('withdraw_from_bank', 'Bronze med helm'), label: 'withdraw helmet' };
    const options: import('./blocked-options').BlockedOption[] = [];
    rememberBlockedOption(options, order, 'your known bank has no Bronze med helm; choose available stock, buy it or arrange a handoff', { inventory: s.inventory, skills: s.skills });
    let runs = 0;
    const agent: any = Object.create(Agent.prototype);
    Object.assign(agent, { name: 'readiness-test', memory: { blockedOptions: options }, sdk: { getState: () => s },
        xp: () => ({}), xpGainedSince: () => ({}), packCounts: () => new Map(), stepNotes: [],
        runOrder: async () => { runs++; return { kind: 'done', why: '' }; }
    });
    expect((await agent.execute(order)).ended.kind).toBe('blocked');
    expect(runs).toBe(0);
    s.inventory.push(item('Bronze med helm'));
    expect((await agent.execute(order)).ended.kind).toBe('done');
    expect(runs).toBe(1);
});

test('a cached later step can be preceded by acquisition; resumed steps are still checked', async () => {
    const { rememberBlockedOption } = await import('./blocked-options');
    const s = state([item('Coins', 1000)]);
    const equip = step('equip', 'Bronze med helm');
    const options: import('./blocked-options').BlockedOption[] = [];
    rememberBlockedOption(options, equip, 'preparation: needs 1 bronze med helm; not enough usable stock in your own bank and no automatic purchase available', { inventory: s.inventory, skills: s.skills });
    const agent: any = Object.create(Agent.prototype);
    Object.assign(agent, { name: 'readiness-test', memory: { blockedOptions: options }, sdk: { getState: () => s } });
    expect(agent.routineRejection([step('buy', 'Bronze med helm'), equip])).toBeNull();
    expect(agent.routineRejection([equip])).toContain('temporarily excluded');
});

test('aggregate routine overspending does not blacklist an affordable individual purchase', () => {
    const s = state([item('Coins', shopSelling('Bronze med helm')!.item.price * 2)]);
    const agent: any = Object.create(Agent.prototype);
    Object.assign(agent, { name: 'readiness-test', memory: { blockedOptions: [] }, sdk: { getState: () => s } });
    const buy = step('buy', 'Bronze med helm', 1);
    // Target amount is carried in args for one-shot purchases.
    const repeated = Array.from({ length: 6 }, () => buy);
    const rejection = agent.routineRejection(repeated);
    expect(rejection).toContain('purchases exceed');
    expect(agent.memory.blockedOptions).toHaveLength(0);
    expect(agent.routineRejection([buy])).toBeNull();
});

test('lure fishing gets a usable supply batch rather than one feather', () => {
    const s = state([item('Fly fishing rod'), item('Coins', 1000)], { Fishing: 30 });
    const ready = nextPreparation(s, {}, step('fish', 'lure'));
    expect(ready.preparation).toMatchObject({ action: 'buy', args: { target: 'Feather', amount: 30 } });
});

test('a long fishing order replenishes exhausted supplies without another planner call', async () => {
    const s = state([item('Fly fishing rod'), item('Feather', 30, 1), item('Coins', 1000, 2)], { Fishing: 30 });
    let fishPasses = 0;
    let purchases = 0;
    const agent: any = Object.create(Agent.prototype);
    Object.assign(agent, {
        name: 'readiness-test',
        stopped: false,
        pending: null,
        inbox: [],
        stepNotes: [],
        sdk: { getState: () => s, getInventory: () => s.inventory },
        checkDeath: () => null,
        waitAlive: async () => true,
        untilMet: () => fishPasses >= 2,
        runPass: async (action: string) => {
            if (action === 'fish') {
                fishPasses++;
                s.inventory = s.inventory.filter((i) => i.name !== 'Feather');
            }
            if (action === 'buy') {
                purchases++;
                s.inventory.push(item('Feather', 30, 1));
            }
            return { aborted: false, gained: new Map(), progress: true };
        },
    });
    const result = await agent.runOrder(step('fish', 'lure'), Date.now(), new Map());
    expect(result.kind).toBe('done');
    expect(fishPasses).toBe(2);
    expect(purchases).toBe(1);
});

test('a named cooking link fetches the actual recipe instead of a different usable fish',()=>{
    const s=state([],{Cooking:30});
    expect(nextPreparation(s,{'Raw shrimps':50},step('cook','raw trout')).blocker).toContain('raw trout');
    expect(nextPreparation(s,{'Raw trout':50},step('cook','raw trout')).preparation).toMatchObject({action:'withdraw_from_bank',args:{target:'Raw trout'}});
});

test('Combat targets use fresh player combat level in readiness and execution', () => {
    const s = state([], { Defence: 50 });
    const order = step('fight', 'cow');
    order.until = { type: 'skill_level', skill: 'Combat', value: 40 };
    const agent: any = Object.create(Agent.prototype);
    agent.sdk = { getState: () => s };
    s.player!.combatLevel = 39;
    expect(satisfiedStep(s, order)).toBeNull();
    expect(agent.untilMet(order, new Map())).toBe(false);
    s.player!.combatLevel = 40;
    expect(satisfiedStep(s, order)).toContain('target 40 satisfied');
    expect(agent.untilMet(order, new Map())).toBe(true);
    order.until.skill = ' defence ';
    order.until.value = 50;
    expect(agent.untilMet(order, new Map())).toBe(true);
    order.until.skill = 'Nonexistent';
    expect(agent.untilMet(order, new Map())).toBe(false);
    agent.sdk.getState = () => null;
    expect(agent.untilMet(order, new Map())).toBe(false);
});

test('legitimate assist waiting bypasses generic no-XP idle passes and keeps its own bounded outcome', async () => {
    const s=state([{...item('Swordfish',1,0),optionsWithIndex:[{text:'Eat',opIndex:1}]},{...item('Swordfish',1,1),optionsWithIndex:[{text:'Eat',opIndex:1}]}]);const agent:any=Object.create(Agent.prototype);let passes=0;
    Object.assign(agent,{name:'assist-idle-test',stopped:false,pending:null,inbox:[],
        sdk:{getState:()=>s},checkDeath:()=>null,waitAlive:async()=>true,untilMet:()=>false,
        runPass:async()=>({gained:new Map(),progress:false,aborted:false,blocker:++passes===4?'leader ended agreed activity':undefined})});
    const order=step('assist','trish');
    const previous=agents.get('trish');agents.set('trish',{} as Agent);
    const p=assistPairs.offer('trish','readiness-test',1,1);
    try {
        const result=await agent.runOrder(order,Date.now(),new Map());
        expect(result.why).toContain('leader ended');expect(passes).toBe(4);expect(result.kind).toBe('blocked');
    } finally {
        if(typeof p!=='string')assistPairs.end(p.id);
        if(previous)agents.set('trish',previous);else agents.delete('trish');
    }
});

test('fight order_end publishes the whole-order accumulator even when the final pass is interrupted',async()=>{
    const s=state();let listener:((s:BotWorldState)=>void)|undefined;
    const agent:any=Object.create(Agent.prototype);let event:any;
    const off=subscribe(e=>{if(e.bot==='fight-report-test'&&e.type==='order_end')event=e;});
    Object.assign(agent,{name:'fight-report-test',sdk:{getState:()=>s,onStateUpdate:(fn:any)=>{listener=fn;return()=>{listener=undefined;};}},
        knownBlock:()=>null,xp:()=>new Map(),xpGainedSince:()=>({Attack:96}),packCounts:()=>new Map(),
        runOrder:async()=>{
            for(let i=0;i<3;i++) {
                const n={index:7+i,id:12,hp:8,healthPercent:100} as any;
                agent.fightObservation.select(n);s.nearbyNpcs=[n];
                s.player!.combat={inCombat:true,targetType:'npc',targetIndex:n.index,lastDamageTick:-1};listener!(s);
                s.nearbyNpcs=[{...n,hp:0,healthPercent:0}];listener!(s);
            }
            agent.stepNotes.push('last pass only: 1 cow killed');
            return {kind:'interrupted',why:'test cancellation'};
        }});
    try {
        const result=await agent.execute({...step('fight','cow'),label:'fight cow'});
        expect(result.summary).toContain('3 target defeats observed');
        expect(result.summary).not.toContain('last pass only');
        expect(event.fight).toMatchObject({scope:'order',engagements:3,observedTargetDefeats:3});
        expect(event.outcome).toBe('interrupted');expect(listener).toBeUndefined();
    } finally {off();}
});

test('real fight pass holds its exact live target through zero-XP, no-food ticks and pass rollover',async()=>{
    const npc={kind:'npc',index:7,id:12,name:'White knight',distance:2,x:2959,z:3338,tileX:2959,tileZ:3338,
        hp:52,healthPercent:100,reachable:true,optionsWithIndex:[{text:'Attack',opIndex:2}]} as any;
    const s=state();Object.assign(s.player!,{hp:60,maxHp:100,worldX:3000,worldZ:3300,combatLevel:89,combat:{inCombat:true,targetType:'npc',targetIndex:7}});
    s.nearbyNpcs=[npc,{...npc,index:8,distance:1}];
    let controller=new AbortController(),ticks=0,attacks:number[]=[],walks=0;
    const sdk:any={getState:()=>s,getInventory:()=>[],waitForCondition:async(fn:any)=>{expect(fn(s)).toBe(true);return s;},
        waitForTicks:async()=>{if(++ticks===8)controller.abort();return s;}};
    const bot:any={eatFood:async()=>({success:false}),walkTo:async()=>{walks++;throw Error('no navigation during active fight');},
        attack:async(n:any)=>{attacks.push(n.index);s.player!.combat.inCombat=true;return {success:true,message:'engaged'};}};
    const report=new FightObservation();
    const ctx:any={name:'fight-continuity-test',sdk,bot,signal:controller.signal,deadline:Date.now()+5000,fightReport:report,
        tactics:{eat_below:75,retreat_below:35,style:'keep',loot:'none'}};
    await SKILLS.fight.run(ctx,{target:'white knight'});
    expect(ticks).toBe(8);expect(attacks).toEqual([]);expect(walks).toBe(0);
    // A transient loss of the combat flag must re-attack the tracked NPC, not the nearer new one.
    s.player!.combat.inCombat=false;controller=new AbortController();ticks=0;ctx.signal=controller.signal;
    await SKILLS.fight.run(ctx,{target:'white knight'});
    expect(attacks).toEqual([7]);expect(walks).toBe(0);
});

const afterKill=(clearsAfter:number)=>{
    const npc={kind:'npc',index:9,id:12,name:'White knight',distance:2,x:2959,z:3338,tileX:2959,tileZ:3338,
        hp:52,healthPercent:100,reachable:true,optionsWithIndex:[{text:'Attack',opIndex:2}]} as any;
    const s=state();Object.assign(s.player!,{hp:100,maxHp:100,worldX:2959,worldZ:3338,combatLevel:89,combat:{inCombat:true,targetType:'none',targetIndex:-1}});
    s.nearbyNpcs=[npc];
    const controller=new AbortController();let ticks=0;const attacks:number[]=[];
    const sdk:any={getState:()=>s,getInventory:()=>[],waitForCondition:async()=>s,
        waitForTicks:async()=>{ticks++;if(ticks===clearsAfter)s.player!.combat.inCombat=false;if(ticks>=clearsAfter+8)controller.abort();return s;}};
    const bot:any={eatFood:async()=>({success:false}),walkTo:async()=>({success:true}),
        attack:async(n:any)=>{attacks.push(n.index);Object.assign(s.player!.combat,{inCombat:true,targetType:'npc',targetIndex:n.index});return {success:true,message:'engaged'};}};
    const ctx:any={name:'after-kill-test',sdk,bot,signal:controller.signal,deadline:Date.now()+5000,fightReport:new FightObservation(),
        tactics:{eat_below:75,retreat_below:35,style:'keep',loot:'none'}};
    return {ctx,attacks};
};
test('a kill leaves the combat flag set briefly with no target: the next cow is attacked, not fled from',async()=>{
    // Forty accelerated server ticks cover the client's ~8s recent-hit window.
    const {ctx,attacks}=afterKill(40);
    const result=await SKILLS.fight.run(ctx,{target:'white knight'});
    expect(result).toBeUndefined();expect(attacks).toEqual([9]);
});
test('combat that never settles and has no target is still treated as another attacker',async()=>{
    const {ctx,attacks}=afterKill(10_000);
    const result=await SKILLS.fight.run(ctx,{target:'white knight'});
    expect(String(result)).toContain('another fight interrupted');expect(attacks).toEqual([]);
});

test('fight pass ending during post-defeat wind-down returns without fleeing or reporting a blocker',async()=>{
    for(const stop of ['cancel','deadline']) {
        const {ctx,attacks}=afterKill(10000);
        const s=ctx.sdk.getState();
        Object.assign(s.player.combat,{targetType:'npc',targetIndex:9});
        let ticks=0,walks=0;
        const controller=new AbortController();ctx.signal=controller.signal;
        ctx.sdk.waitForTicks=async()=>{
            ticks++;
            if(ticks===1) {
                s.nearbyNpcs[0].hp=0;s.nearbyNpcs[0].healthPercent=0;
                Object.assign(s.player.combat,{targetType:'none',targetIndex:-1});
            } else if(stop==='cancel')controller.abort();
            else ctx.deadline=Date.now()-1;
            return s;
        };
        ctx.bot.walkTo=async()=>{walks++;return {success:true};};
        const result=await SKILLS.fight.run(ctx,{target:'white knight'});
        expect(result).toBeUndefined();expect(walks).toBe(0);expect(attacks).toEqual([]);
        expect(ticks).toBe(2);
    }
});

test('pickpocket records why its attempts produce nothing, and clears it on a success',async()=>{
    const {PLACES}=await import('./world');
    const man={kind:'npc',index:3,id:1,name:'Man',distance:1,x:PLACES.lumbridge_men.x,z:PLACES.lumbridge_men.z,hp:7,healthPercent:100,reachable:true,
        optionsWithIndex:[{text:'Pickpocket',opIndex:3}]} as any;
    const s=state();Object.assign(s.player!,{hp:100,maxHp:100,worldX:PLACES.lumbridge_men.x,worldZ:PLACES.lumbridge_men.z,combat:{inCombat:false,targetType:'none',targetIndex:-1}});
    s.nearbyNpcs=[man];
    const controller=new AbortController();let ticks=0,calls=0;const stall:{why?:string}={};
    const sdk:any={getState:()=>s,getInventory:()=>[],waitForTicks:async()=>{ticks++;if(ticks>=3)controller.abort();return s;}};
    const bot:any={eatFood:async()=>({success:false}),walkTo:async()=>({success:true}),
        pickpocketNpc:async()=>({success:false,message:'Pickpocket dispatch failed on Man: client stalled',reason:'dispatch_failed'})};
    const ctx:any={name:'pickpocket-stall-test',sdk,bot,signal:controller.signal,deadline:Date.now()+5000,stall};
    await SKILLS.pickpocket.run(ctx,{target:null});
    expect(stall.why).toBe('Pickpocket dispatch failed on Man: client stalled [dispatch_failed]');
    bot.pickpocketNpc=async()=>{calls++;if(calls>=2)again.abort();return {success:true,message:'ok'};};
    ticks=0;const again=new AbortController();ctx.signal=again.signal;sdk.waitForTicks=async()=>{if(++ticks>=2)again.abort();return s;};
    await SKILLS.pickpocket.run(ctx,{target:null});
    expect(calls).toBeGreaterThan(0);expect(stall.why).toBeUndefined();
});

test('automatic combat food uses cooked matching even when raw fish precedes it in the bank',async()=>{
    const s=state();Object.assign(s.player!,{maxHp:70,hp:70,combatLevel:89,worldX:3013,worldZ:3355});
    const bank=[{name:'Raw swordfish',count:100},{name:'Swordfish',count:20}];
    const preparation=nextPreparation(s,{'Raw swordfish':100,Swordfish:20},step('fight','white knight')).preparation!;
    let captured:RegExp|undefined,quantity=0;
    const ctx:any={name:'cooked-food-regression',sdk:{getState:()=>s,getInventory:()=>[],getBankItems:()=>bank},
        bot:{openBank:async()=>({success:true}),withdrawItem:async(pattern:RegExp,amount:number)=>{captured=pattern;quantity=amount;throw Error('stop before test persistence');}},
        signal:new AbortController().signal,deadline:Date.now()+1000};
    await expect(SKILLS.withdraw_from_bank.run(ctx,preparation.args)).rejects.toThrow('stop before test persistence');
    expect(captured!.test('Raw swordfish')).toBe(false);expect(captured!.test('Swordfish')).toBe(true);expect(quantity).toBe(10);
});

test('routine banking clears smithing outputs but preserves unrelated gear, tools and food reserve', () => {
    const s=state([item('Iron dagger'),item('Hammer'),item('Steel sword'),item('Trout',5)]);
    expect(bankDepositNeeded(s,{target:null})).toBe(false);
    expect(bankDepositNeeded(s,{target:null,bankOutputs:['iron dagger']})).toBe(true);
    expect(bankDepositNeeded(state(s.inventory.slice(1)),{target:null,bankOutputs:['iron dagger']})).toBe(false);
    expect(bankDepositNeeded(s,{target:'coal',bankOutputs:['iron dagger']})).toBe(false);
    expect(satisfiedStep(s, {...step('bank_resources'),args:{target:null,bankOutputs:['iron dagger']}})).toBeNull();
});
test('explicit note-qualified bank targets match actual pack names', () => {
    expect(bankDepositNeeded(state([item('Coal',71)]),{target:'coal noted'})).toBe(true);
    expect(bankDepositNeeded(state([item('Coal',71)]),{target:'coal (noted)'})).toBe(true);
    expect(bankDepositNeeded(state([item('Raw trout')]),{target:'cooked trout noted'})).toBe(false);
});
test('ambiguous noted and unnoted trade stock is rejected before opening a trade', async () => {
    const original=agents.get('form-receiver-test');
    agents.set('form-receiver-test',{name:'form-receiver-test'} as Agent);
    try {
        const a:any=Object.create(Agent.prototype);
        Object.assign(a,{name:'form-giver-test',sdk:{getInventory:()=>[item('Coal',1,0),item('Coal',71,1)]}});
        expect(await a.give({to:'form-receiver-test',item:'coal noted',amount:71})).toContain('different item forms');
    } finally {if(original)agents.set('form-receiver-test',original);else agents.delete('form-receiver-test');}
});


test('full-pack island fishing preparation returns by ferry before mainland banking', async () => {
    const s=state([item('Coins',100),item('Harpoon'),...Array.from({length:26},(_,i)=>item('Raw swordfish',1,i+2))],{Fishing:60});
    Object.assign(s.player!,{worldX:2925,worldZ:3180,hp:48,maxHp:48,level:0});
    const prep=nextPreparation(s,{},step('fish','swordfish')).preparation!;
    expect(prep.action).toBe('bank_resources');
    const calls:string[]=[];let dialog:any={isOpen:false,options:[]};
    const ctx:any={name:'rascaltest',deadline:Date.now()+60000,signal:new AbortController().signal,
        sdk:{getState:()=>({...s,dialog}),getInventory:()=>s.inventory,
            countInventoryItems:(re:RegExp)=>s.inventory.filter(i=>re.test(i.name)).reduce((n,i)=>n+i.count,0),
            waitForTicks:async()=>{},waitForCondition:async()=>{},
            clickDialogByText:async(re:RegExp)=>{calls.push('choice');const choices=['Can I journey on this ship?','Search away, I have nothing to hide.','Ok.'];
                const index=choices.findIndex(x=>re.test(x));expect(index).toBeGreaterThanOrEqual(0);
                dialog=index<2?{isOpen:true,options:[{text:choices[index+1]}]}:{isOpen:false,options:[]};
                if(index===2)Object.assign(s.player!,{worldX:3013,worldZ:3355});return {success:true};}},
        bot:{walkTo:async(x:number,z:number)=>{calls.push(`walk:${x},${z}`);Object.assign(s.player!,{worldX:x,worldZ:z});return {success:true};},
            interactNpc:async(name:string)=>{calls.push(name);dialog={isOpen:true,options:[{text:'Can I journey on this ship?'}]};return {success:true};},
            openBank:async()=>{calls.push('bank');throw Error('stop before test persistence');}}};
    await expect(SKILLS.bank_resources.run(ctx,prep.args)).rejects.toThrow('stop before test persistence');
    expect(calls[0]).toBe('walk:2953,3147');expect(calls).toContain('Customs officer');
    expect(calls.at(-1)).toBe('bank');expect(calls.filter(x=>x==='choice')).toHaveLength(3);
    expect(s.inventory).toHaveLength(28);
});

test('island bank access preserves rum and refuses unfunded or cancelled ferry returns', async () => {
    for(const mode of ['rum','unfunded','cancelled']) {
        const s=state([item('Coins',mode==='unfunded'?29:100),...(mode==='rum'?[item('Karamjan rum')]:[])]);
        Object.assign(s.player!,{worldX:2925,worldZ:3180,level:0});
        const controller=new AbortController();if(mode==='cancelled')controller.abort();
        const ctx:any={name:'rascaltest',deadline:Date.now()+60000,signal:controller.signal,
            sdk:{getState:()=>s,getInventory:()=>s.inventory,countInventoryItems:()=>mode==='unfunded'?29:100},bot:{}};
        for(const action of ['bank_resources','withdraw_from_bank']) {
            const result=await SKILLS[action].run(ctx,{target:action==='bank_resources'?'Coins':'Shrimps'});
            expect(result).toContain(mode==='rum'?'confiscate':mode==='unfunded'?'30 carried coins':'cancelled');
        }
    }
});


test('mainland bank preparation resumes on the ferry deck and waits for arrival locations', async () => {
    const s=state([item('Raw tuna')]);Object.assign(s.player!,{worldX:3033,worldZ:3224,level:1});
    s.nearbyLocs=[];const calls:string[]=[];
    const ctx:any={name:'rascaltest',deadline:Date.now()+60000,signal:new AbortController().signal,
        sdk:{getState:()=>s,getInventory:()=>s.inventory,waitForCondition:async(check:any)=>{
            calls.push('arrival');if(!check(s))s.nearbyLocs=[{name:'Gangplank',distance:8,reachable:true,optionsWithIndex:[{text:'Cross',opIndex:1}]}] as any;
            expect(check(s)).toBe(true);}},
        bot:{interactLoc:async()=>{expect(s.nearbyLocs).toHaveLength(1);calls.push('cross');Object.assign(s.player!,{worldX:3013,worldZ:3355,level:0});return {success:true};},
            openBank:async()=>{calls.push('bank');throw Error('stop before test persistence');}}};
    await expect(SKILLS.bank_resources.run(ctx,{target:'Raw tuna'})).rejects.toThrow('stop before test persistence');
    expect(calls).toEqual(['arrival','cross','arrival','bank']);
    s.player!.level=1;s.player!.worldX=3032;s.player!.worldZ=3217;s.nearbyLocs=[];
    ctx.sdk.waitForCondition=async()=>{throw Error('arrival timed out');};
    expect(await SKILLS.bank_resources.run(ctx,{target:'Raw tuna'})).toContain('did not appear');
    expect(calls.filter(x=>x==='cross')).toHaveLength(1);
});

test('look and dialogue actions emit observed evidence, with failed dispatch distinguished from dialogue',async()=>{
    const s=state([item('Clay')]);s.groundItems=[];s.nearbyNpcs=[{name:'Doric',optionsWithIndex:[{text:'Talk-to'}]} as any];s.nearbyLocs=[];
    s.dialog={isOpen:false,options:[]} as any;
    const observed:any[]=[];
    const ctx:any={sdk:{getState:()=>s,getInventory:()=>s.inventory,waitForTicks:async()=>s,
        waitForCondition:async()=>s,sendClickDialog:async()=>{}},bot:{interactNpc:async()=>({success:true,message:'talked'}),
        useItemOnNpc:async()=>({success:false,message:'rejected'})},notes:[],observeWorld:(...args:any[])=>observed.push(args)};
    await SKILLS.look.run(ctx,{target:null});expect(observed).toHaveLength(1);
    await SKILLS.interact.run(ctx,{target:'Doric: Talk-to'});expect(observed[1][1]).toEqual({success:true,message:'talked'});
    const failed=await SKILLS.use.run(ctx,{target:'Clay on Doric'});
    expect(failed).toContain('rejected');expect(observed[2][1].success).toBe(false);
    // Existing dialogue is evidence, but does not turn a rejected dispatch into success.
    s.dialog={isOpen:true,options:[{text:'Task',index:0},{text:'Goodbye',index:1}],text:'Bring ores'} as any;
    await SKILLS.look.run(ctx,{target:null});expect(observed.pop()[0]).toContain('Bring ores');
    ctx.bot.interactNpc=async()=>({success:false,message:'dispatch failed'});
    await SKILLS.interact.run(ctx,{target:'Doric: Talk-to'});
    expect(observed[3][0]).toContain('Bring ores');expect(observed[3][1].success).toBe(false);
    await SKILLS.choose.run(ctx,{target:'Task'});expect(observed[4][0]).toContain('Bring ores');
});

test('real execute/runPass attaches only fresh SDK world evidence to order_end',async()=>{
    const s=state();s.player!.level=0;s.player!.combat={inCombat:false,targetType:'none',targetIndex:-1,lastDamageTick:-1};
    s.nearbyNpcs=[{name:'Doric',optionsWithIndex:[{text:'Talk-to'}]} as any];s.nearbyLocs=[];s.groundItems=[];
    const agent:any=Object.create(Agent.prototype);let event:any;
    const off=subscribe(e=>{if(e.bot==='world-evidence-test'&&e.type==='order_end')event=e;});
    Object.assign(agent,{name:'world-evidence-test',sdk:{getState:()=>s,getInventory:()=>[],getStateReceivedAt:()=>Date.now()},bot:{},memory:{},
        knownBlock:()=>null,rememberBlock:()=>{},xp:()=>new Map(),xpGainedSince:()=>({}),packCounts:()=>new Map(),inventoryCounts:()=>new Map(),
        runOrder:async()=>{const pass=await agent.runPass('look',{target:null},Date.now()+5000);return {kind:pass.blocker?'blocked':'done',why:pass.blocker??''};}});
    try {
        await agent.execute({...step('look'),label:'look around'});
        expect(event.worldObservation.position).toMatchObject({x:3229,z:3437,plane:0});expect(event.worldObservation.npcs).toContain('Doric:Talk-to');
        agent.sdk.getStateReceivedAt=()=>Date.now()-6000;
        await agent.execute({...step('look'),label:'look around'});expect(event.worldObservation).toBeUndefined();
    }finally{off();}
});

test('actual execute subscribes field XP observations only for an active expedition',async()=>{
 const s=state([],{Mining:30});s.player!.level=0;s.player!.lifeId=1;
 const agent:any=Object.create(Agent.prototype);let listener:any,event:any;
 const off=subscribe(e=>{if(e.bot==='field-xp-test'&&e.type==='order_end')event=e;});
 Object.assign(agent,{name:'field-xp-test',sdk:{getState:()=>s,getInventory:()=>[],getStateReceivedAt:()=>Date.now(),onStateUpdate:(fn:any)=>{listener=fn;return()=>{listener=undefined;};}},
  knownBlock:()=>null,rememberBlock:()=>{},xp:()=>new Map(),xpGainedSince:()=>({Mining:10}),packCounts:()=>new Map(),
  planningIO:{fieldMission:()=>true},runOrder:async()=>{s.skills.find(k=>k.name==='Mining')!.experience+=10;listener(s);return {kind:'done',why:''};}});
 try {
  await agent.execute({...step('mine','iron'),label:'field mining'});
  expect(event.fieldWork.samples[0]).toMatchObject({x:3229,z:3437,xp:10});expect(event.fieldWork.startedAt).toBe(event.orderStartedAt);expect(listener).toBeUndefined();
  agent.planningIO.fieldMission=()=>false;
  agent.runOrder=async()=>({kind:'done',why:''});await agent.execute({...step('mine','iron'),label:'personal mining'});expect(event.fieldWork).toBeUndefined();
 }finally{off();}
});
