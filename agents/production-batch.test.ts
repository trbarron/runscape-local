import { expect, test } from 'bun:test';
import type { BotWorldState } from '../rs-sdk/sdk/types';
import type { PlannedStep } from './readiness';
import { productionWithdrawal, productiveLoopProgress, routineBankOutputs, measuredWorkProgress } from './production-batch';
const state = (names: string[]): BotWorldState => ({ inventory: names.map((name,slot)=>({name,slot,count:1,id:slot+1,optionsWithIndex:[]})), equipment:[], skills:[{name:'Smithing',baseLevel:64}] } as unknown as BotWorldState);
const step = (action: string, target: string | null = null, amount: number = 1): PlannedStep => ({ action, args:{target,amount}, until:{type:'gathered',skill:null,value:amount} });

test('tool acquisition cannot establish production progress, but outputs and XP can', () => {
    expect(measuredWorkProgress('fletch', new Map([['Knife', 1]]), {})).toBe(false);
    expect(measuredWorkProgress('smith', new Map([['Hammer', 1]]), {})).toBe(false);
    expect(measuredWorkProgress('fletch', new Map([['Knife', 1], ['Arrow shaft', 15]]), {})).toBe(true);
    expect(measuredWorkProgress('firemake', new Map(), { Firemaking: 40 })).toBe(true);
    expect(measuredWorkProgress('pick_up', new Map([['Knife', 1]]), {})).toBe(true);
});

test('steel ingredient withdrawals reserve space at the two-coal-to-one-iron ratio', () => {
    const plan=[step('withdraw_from_bank','coal',22),step('withdraw_from_bank','iron ore',11),step('smelt','steel',11)];
    const carried=['Hammer','Bronze pickaxe','Bronze axe','Tinderbox','Chisel','Knife'];
    expect(productionWithdrawal(state(carried),plan,0)).toBe(14);
    expect(productionWithdrawal(state([...carried,...Array(14).fill('Coal')]),plan,1)).toBe(7);
    expect(plan[2].until.value).toBe(11); // original production goal survives batching
});
test('multibar recipes reserve their hammer and cap inputs without shrinking the final goal', () => {
    const plan=[step('withdraw_from_bank','bronze bar',50),step('smith','bronze platebody',10)];
    expect(productionWithdrawal(state(['Hammer']),plan,0)).toBe(25);
    expect(productionWithdrawal(state(['Hammer',...Array(25).fill('Bronze bar')]),plan,0)).toBe(0);
    expect(plan[1].until.value).toBe(10);
    expect(productionWithdrawal(state([]),[step('withdraw_from_bank','steel bar noted',12),step('smith','steel med helm',12)],0)).toBeNull();
});

const carried = (...names: string[]) => state(names);
test('only the supported production actions bound a withdrawal', () => {
    expect(productionWithdrawal(carried(), [step('withdraw_from_bank', 'bronze bar', 5), step('give', 'bronze bar', 5)], 0)).toBeNull();
    expect(productionWithdrawal(carried(), [step('mine', 'copper', 5)], 0)).toBeNull();
    expect(productionWithdrawal(carried(), [step('withdraw_from_bank', 'bronze bar', 5)], 0)).toBeNull();
});
test('a step that is not a bank withdrawal is not bounded', () => {
    expect(productionWithdrawal(carried(), [step('smelt', 'bronze', 5)], 0)).toBeNull();
});
test('the batch never exceeds the amount the step asked for', () => {
    const plan = [step('withdraw_from_bank', 'bronze bar', 3), step('smith', 'bronze platebody', 1)];
    expect(productionWithdrawal(carried('Hammer'), plan, 0)).toBe(3);
});
test('a withdrawal that cannot fit one recipe returns null rather than a zero-sized batch', () => {
    const plan = [step('withdraw_from_bank', 'bronze bar', 5), step('smith', 'bronze platebody', 1)];
    const full = ['Hammer', ...Array(27).fill('Logs')];
    expect(productionWithdrawal(carried(...full), plan, 0)).toBeNull();
});
test('reusable tools the character lacks reserve a slot, and held ones do not', () => {
    const plan = [step('withdraw_from_bank', 'bronze bar', 50), step('smith', 'bronze dagger', 50)];
    const withHammer = productionWithdrawal(carried('Hammer'), plan, 0) ?? 0;
    const withoutHammer = productionWithdrawal(carried(), plan, 0) ?? 0;
    expect(withHammer).toBe(27);
    expect(withoutHammer).toBe(27);
    // Inputs already held fill the pack exactly: nothing further is withdrawn.
    const full = [...Array(27).fill('Bronze bar'), 'Hammer'];
    expect(productionWithdrawal(carried(...full), plan, 0)).toBe(0);
});
test('consecutive withdrawals for one production step are all bounded by the same recipe', () => {
    const plan = [step('withdraw_from_bank', 'coal', 22), step('withdraw_from_bank', 'iron ore', 11), step('smelt', 'steel', 11)];
    const a = productionWithdrawal(carried(), plan, 0) ?? 0;
    const b = productionWithdrawal(carried(), plan, 1) ?? 0;
    expect(a).toBe(2 * b);
    expect(a + b).toBeLessThanOrEqual(28);
});
test('a withdrawal for an item the recipe does not use is left alone', () => {
    const plan = [step('withdraw_from_bank', 'lobster', 5), step('smelt', 'steel', 5)];
    expect(productionWithdrawal(carried(), plan, 0)).toBeNull();
});
test('a cook batch fills the pack with raw fish the character is able to cook', () => {
    const plan = [step('withdraw_from_bank', 'raw shrimps', 40), step('cook', 'raw shrimps', 40)];
    expect(productionWithdrawal(carried(), plan, 0)).toBe(28);
    // An unqualified cook is left to ordinary readiness blockers.
    const trout = [step('withdraw_from_bank', 'raw trout', 40), step('cook', 'raw trout', 40)];
    expect(productionWithdrawal(carried(), trout, 0)).toBeNull();
});

test('supply shuffling cannot keep a production loop alive; actual production and handoffs can', () => {
    const plan=[step('bank_resources'),step('withdraw_from_bank','iron ore'),step('smelt','iron')];
    expect(productiveLoopProgress(plan,'withdraw_from_bank',true)).toBe(false);
    expect(productiveLoopProgress(plan,'equip',true)).toBe(false);
    expect(productiveLoopProgress(plan,'smelt',false)).toBe(false);
    expect(productiveLoopProgress(plan,'smelt',true)).toBe(true);
    expect(productiveLoopProgress(plan,'give',true)).toBe(true);
    expect(productiveLoopProgress([step('withdraw_from_bank','coal')],'withdraw_from_bank',true)).toBe(true);
    expect(routineBankOutputs([...plan,step('smith','iron dagger'),step('equip','iron med helm')])).toEqual(['iron dagger']);
});
