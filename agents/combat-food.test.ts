import { expect,test } from 'bun:test';
import type { BotWorldState } from '../rs-sdk/sdk/types';
import { safeFoodRecovery,bestHealingFood, foodHealing,carriedHealing,foodLoad,combatFoodBudget,combatFoodPreparation,foodNotes } from './combat-food';
const pack=(name:string,n:number)=>Array.from({length:n},()=>({name,count:1,optionsWithIndex:[{text:'Eat',opIndex:1}]}));
const state=(inventory:any[]=[],hp=70,combat=80)=>({inventory,skills:[],player:{maxHp:hp,hp,combatLevel:combat}} as unknown as BotWorldState);
const fight=(target='white knight',minutes=10)=>({action:'fight',args:{target},until:{type:'minutes',skill:null,value:minutes}});
test('fixed fish healing comes from server configs; raw and banknotes are not carried food',()=>{
    expect(['Shrimps','Trout','Salmon','Swordfish'].map(foodHealing)).toEqual([3,7,9,14]);
    expect(foodHealing('Raw swordfish')).toBe(0);expect(foodHealing('Swordfish (noted)')).toBe(0);
    expect(carriedHealing([{name:'Swordfish',count:20,optionsWithIndex:[{text:'Drop'}]}])).toBe(0);
    expect(carriedHealing(pack('Trout',5))).toBe(35);
});
test('entry budgets distinguish starter, harder target and shorter outing; not a fish-count quota',()=>{
    const s=state();expect(combatFoodBudget(s,fight('cow'))).toBe(0);
    expect(combatFoodBudget(s,fight())).toBe(140);expect(combatFoodBudget(s,fight('white knight',5))).toBe(70);
    expect(combatFoodBudget(s,{...fight(),action:'assist'})).toBe(140);
    expect(combatFoodBudget(s,{...fight(),action:'invite_assist',until:{type:'minutes',skill:null,value:1}})).toBe(140);
    expect(combatFoodBudget(s,fight('unindexed boss'))).toBe(Infinity);
});
test('a complete stronger own-bank load is preferred to a plentiful weak reserve',()=>{
    expect(foodLoad([],{'Shrimps':500,'Swordfish':20},140)).toEqual({deposits:[],withdrawals:[{name:'Swordfish',count:10}]});
    expect(combatFoodPreparation(state(),{'Swordfish':20},fight())).toMatchObject({preparation:{action:'withdraw_from_bank',args:{target:'cooked Swordfish',amount:10}}});
    expect(combatFoodPreparation(state(pack('Swordfish',10)),{},fight())).toEqual({});
});
test('banked fish and promises alone do not satisfy combat entry',()=>{
    expect(combatFoodPreparation(state(),{},fight()).blocker).toContain('carry at least 140');
    expect(combatFoodPreparation(state(pack('Shrimps',5)),{},fight()).blocker).toContain('currently 15');
});
test('weak food is replaced only when the complete load fits both slots and preparation budget',()=>{
    const full=[...pack('Shrimps',20),...Array.from({length:8},(_,i)=>({name:`tool${i}`,count:1}))];
    const plan=foodLoad(full,{'Swordfish':10},140);
    expect(plan).toEqual({deposits:[{name:'Shrimps',count:20}],withdrawals:[{name:'Swordfish',count:10}]});
    expect(foodLoad(full,{},140)).toBeNull();
    const ore=Array.from({length:28},()=>({name:'Coal',count:1}));
    expect(foodLoad(ore,{'Swordfish':20},140)).toBeNull(); // no partial gear/ore deposit cascade
});
test('mixed load feasibility accounts for all materials and never acquires an insufficient first batch',()=>{
    expect(foodLoad([],{'Swordfish':5,'Trout':10},140)?.withdrawals).toEqual([{name:'Swordfish',count:5},{name:'Trout',count:10}]);
    expect(foodLoad([],{'Trout':3},140)).toBeNull();
    expect(foodLoad([],{'Swordfish':1,'Lobster':1,'Tuna':1,'Salmon':100},140)).toBeNull(); // at most3 kinds
});
test('eating chooses useful healing per action while avoiding unnecessary overheal',()=>{
    const s=state([...pack('Shrimps',1),...pack('Swordfish',1)],70);s.player!.hp=45;
    expect(bestHealingFood(s)?.name).toBe('Swordfish');s.player!.hp=67;
    expect(bestHealingFood(s)?.name).toBe('Shrimps');
});
test('notes distinguish observed bank supplies from confirmed delivery and show healing value',()=>{
    const text=foodNotes(state(pack('Shrimps',5)),{t:Date.now(),items:{'Swordfish':20}},[
        {name:'cook',state:{skills:[{name:'Cooking',baseLevel:90}]} as BotWorldState,bank:{t:Date.now(),items:{'Raw salmon':40}}}]);
    expect(text).toContain('15 nominal healing HP');expect(text).toContain('swordfish 14 HP/slot');
    expect(text).toContain('Raw salmon');expect(text).toContain('confirmed delivery');
});

test('pickpocketing requires actual carried healing, scaled for short sessions',()=>{
    const s=state();const step={...fight(),action:'pickpocket'};
    expect(combatFoodBudget(s,step)).toBe(35);
    expect(combatFoodBudget(s,{...step,until:{type:'minutes',skill:null,value:5}})).toBe(18);
    expect(combatFoodPreparation(s,{},step).blocker).toContain('carry');
});

test('low-HP food recovery is limited to an already-reached bank and never combat or raw supplies',()=>{
    const s=state();Object.assign(s.player!,{hp:10,level:0,worldX:3094,worldZ:3492,combat:{inCombat:false}});
    expect(safeFoodRecovery(s,'withdraw_from_bank','cooked trout')).toBe(true);
    expect(safeFoodRecovery(s,'withdraw_from_bank','raw trout')).toBe(false);
    s.player!.combat.inCombat=true;expect(safeFoodRecovery(s,'withdraw_from_bank','cooked trout')).toBe(false);
    s.player!.combat.inCombat=false;s.player!.worldX+=10;
    expect(safeFoodRecovery(s,'withdraw_from_bank','cooked trout')).toBe(false);
});
