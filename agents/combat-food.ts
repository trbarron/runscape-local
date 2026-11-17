import { readFileSync } from 'fs';
import { join } from 'path';
import type { BotWorldState } from '../rs-sdk/sdk/types';
import type { PlannedStep, Readiness } from './readiness';
import type { BankView } from './banks';
import { COOKED_FISH } from './food-reserve';
import { BANKS } from './world';
import { SPOTS } from './world-index/index';
import { FISHING } from './fishing';
import { cookingLevel } from './game-requirements';

type Stack={name:string;count:number;optionsWithIndex?:{text:string}[]};
const edible=(i:Stack)=>i.optionsWithIndex===undefined||i.optionsWithIndex.some(o=>/^eat$/i.test(o.text));
const heals=new Map<string,number>();
const text=readFileSync(join(import.meta.dir,'../rs-sdk/server/content/scripts/player/configs/consumption/consume_normal.dbrow'),'utf8');
for(const block of text.split(/^\[/m)) {
    const heal=Number(block.match(/^data=stat_heal,hitpoints,(\d+),0$/m)?.[1]);
    if(!heal)continue;
    for(const m of block.matchAll(/^data=consumable,([^\n]+)$/gm)) {
        const name=m[1]==='shrimp'?'shrimps':m[1].replace(/_/g,' ');
        if(COOKED_FISH.test(name))heals.set(name,heal);
    }
}
export const foodHealing=(name:string):number=>heals.get(name.trim().toLowerCase().replace(/^cooked /,'').replace(/ \(cooked\)$/,''))??0;
export const carriedHealing=(items:Stack[]):number=>items.reduce((sum,i)=>sum+(edible(i)?foodHealing(i.name):0)*Math.max(0,i.count),0);
/** Best one-action recovery, breaking ties toward less overhealing. */
export function bestHealingFood(s:BotWorldState) {
    const missing=Math.max(0,(s.player?.maxHp??0)-(s.player?.hp??0));
    return s.inventory.filter(i=>edible(i)&&foodHealing(i.name)>0).sort((a,b)=>
        Math.min(foodHealing(b.name),missing)-Math.min(foodHealing(a.name),missing)||foodHealing(a.name)-foodHealing(b.name))[0];
}
export function combatFoodBudget(s:BotWorldState,step:PlannedStep):number {
    if(!/^(fight|assist|invite_assist|pickpocket)$/.test(step.action))return 0;
    const p=s.player;if(!p||!Number.isFinite(p.maxHp)||p.maxHp<=0)return Infinity;
    let strong=/^(assist|invite_assist)$/.test(step.action);
    if(step.action==='pickpocket') {
        const minutes=step.until.type==='minutes'?Math.max(2,Math.min(10,step.until.value)):10;
        return Math.ceil(p.maxHp*.5*minutes/10);
    }
    if(!strong) {
        const target=(step.args.target??'cow').toLowerCase().trim().replace(/s$/,'');
        const spots=SPOTS.filter(x=>x.kind==='monster'&&x.type.toLowerCase().replace(/s$/,'')===target);
        if(!spots.length)return Infinity;
        if(spots.every(x=>(x.level??Infinity)<=3))return 0;
        strong=spots.some(x=>(x.hp??Infinity)>=p.maxHp/2||(x.level??Infinity)>=p.combatLevel/2)
            ||spots.every(x=>x.z>=3520);
    }
    const minutes=step.action==='invite_assist'?10:step.until.type==='minutes'?Math.max(2,Math.min(10,step.until.value)):10;
    return Math.ceil(p.maxHp*(strong?2:.5)*minutes/10);
}
interface Load { withdrawals:Stack[]; deposits:Stack[] }
/** A complete, bounded plan before any side effect. Never fetch another character's bank. */
export function foodLoad(inventory:Stack[],bank:Record<string,number>,need:number):Load|null {
    const tryLoad=(pack:Stack[],stock:Record<string,number>):Stack[]|null=>{
        let missing=need-carriedHealing(pack),slots=28-pack.length;
        const loads:Stack[]=[];
        for(const [name,count] of Object.entries(stock).filter(([n,c])=>foodHealing(n)>0&&c>0).sort((a,b)=>foodHealing(b[0])-foodHealing(a[0]))) {
            if(missing<=0)return loads;
            if(loads.length>=3||slots<=0)break;
            const amount=Math.min(count,slots,Math.ceil(missing/foodHealing(name)));
            if(amount>0){loads.push({name,count:amount});slots-=amount;missing-=amount*foodHealing(name);}
        }
        return missing<=0?loads:null;
    };
    if(!Number.isFinite(need))return null;
    const direct=tryLoad(inventory,bank);if(direct)return {withdrawals:direct,deposits:[]};
    const weak=[...new Set(inventory.filter(i=>edible(i)&&foodHealing(i.name)>0).map(i=>i.name))].sort((a,b)=>foodHealing(a)-foodHealing(b));
    let pack=[...inventory];const stock={...bank},deposits:Stack[]=[];
    for(const name of weak.slice(0,6)) {
        const amount=pack.filter(i=>i.name===name).reduce((n,i)=>n+i.count,0);
        pack=pack.filter(i=>i.name!==name);stock[name]=(stock[name]??0)+amount;deposits.push({name,count:amount});
        const loads=tryLoad(pack,stock);if(loads)return {withdrawals:loads,deposits};
    }
    return null;
}
export function combatFoodPreparation(s:BotWorldState,bank:Record<string,number>,step:PlannedStep):Readiness {
    const need=combatFoodBudget(s,step),held=carriedHealing(s.inventory);
    if(held>=need)return {};
    if(!Number.isFinite(need))return {blocker:'combat preparation needs a known target and maximum HP to size carried healing'};
    const plan=foodLoad(s.inventory,bank,need);
    if(!plan)return {blocker:`combat food: carry at least ${need} nominal healing HP; currently ${held}. Prepare stronger cooked food, arrange a confirmed handoff, bank surplus or shorten the outing; own known stock/pack space cannot meet this entry budget`};
    if(plan.deposits.length)return {preparation:{action:'bank_resources',args:{target:`cooked ${plan.deposits[0].name}`},reason:`replace weak food with a complete stronger load for ${need} nominal healing HP`}};
    const next=plan.withdrawals[0];
    return next?{preparation:{action:'withdraw_from_bank',args:{target:`cooked ${next.name}`,amount:next.count},reason:`combat provisions: ${held}/${need} nominal healing HP; ${next.name} heals ${foodHealing(next.name)} per slot`}}:{};
}
export function foodNotes(s:BotWorldState,bank?:BankView,teammates:{name:string;state:BotWorldState|null;bank?:BankView}[]=[]):string {
    const held=carriedHealing(s.inventory),max=s.player?.maxHp??0;
    const format=(items:Record<string,number>)=>Object.entries(items).filter(([n,c])=>foodHealing(n)>0&&c>0).sort((a,b)=>foodHealing(b[0])-foodHealing(a[0])).slice(0,3).map(([n,c])=>`${c} ${n} (${foodHealing(n)} HP each)`).join(', ');
    const lines=[`COMBAT FOOD: ${held} nominal healing HP carried (${max?(held/max).toFixed(1):'?'} times maximum HP). Only supported cooked fish are valued; raw/noted/other foods are not credited by this budget. Nominal capacity can be wasted by overhealing.`,
        `Food values: ${[...heals].filter(([n])=>['shrimps','trout','salmon','swordfish'].includes(n)).map(([n,v])=>`${n} ${v} HP/slot`).join('; ')}.`,
        `Your bank (${bank?Math.max(0,Math.round((Date.now()-bank.t)/60000))+' min old':'unknown'}): ${format(bank?.items??{})||'no cooked fish observed'}.`];
    for(const mate of teammates) {
        const cooked=format(mate.bank?.items??{});
        const cook=mate.state?.skills.find(k=>k.name==='Cooking')?.baseLevel??1;
        const raw=Object.entries(mate.bank?.items??{}).filter(([n,c])=>c>0&&/^raw /i.test(n)&&foodHealing(n.replace(/^raw /i,''))>0&&cook>=cookingLevel(n)).sort((a,b)=>foodHealing(b[0].replace(/^raw /i,''))-foodHealing(a[0].replace(/^raw /i,''))).slice(0,2).map(([n,c])=>`${c} ${n}`).join(', ');
        const fishing=mate.state?.skills.find(k=>k.name==='Fishing')?.baseLevel??1;
        const methods=['swordfish','lobster','salmon','trout'].filter(n=>fishing>=(FISHING[n]?.level??Infinity)&&cook>=cookingLevel('raw '+n)).slice(0,2);
        if(methods.length)lines.push(`${mate.name} could fish and cook ${methods.join(' or ')} by current levels; verify tools, route, funding and actual output before promising supplies.`);
        if(cooked||raw)lines.push(`${mate.name}'s observed bank (${mate.bank?Math.round((Date.now()-mate.bank.t)/60000):'?'} min old): ${cooked}${raw?`; can cook at current level: ${raw}`:''}. Ask for agreement and confirmed delivery; you cannot withdraw their bank.`);
    }
    lines.push(`A 10-minute tougher fight uses an initial preparation budget of about ${max*2} nominal healing HP (two max-HP equivalents), scaled down for shorter outings; easier non-starter fights use half an equivalent. Invite/assist use the larger budget. This is a starting heuristic, not guaranteed survival or a per-bite restocking quota. Food must be carried at entry; stronger per-slot food can reduce supply trips. Consider a bounded shared food-production order and confirmed delivery, with roles chosen by the party.`);
    return lines.join('\n');
}

/** Acquire known edible food while already at a bank; never waive safety while under attack. */
export function safeFoodRecovery(s:BotWorldState|null,action:string,target:string|null):boolean {
    const p=s?.player;
    return !!p&&p.hp>0&&!p.isDead&&p.combat?.inCombat===false&&p.level===0&&action==='withdraw_from_bank'
        &&/^cooked /i.test(target??'')&&foodHealing(target??'')>0
        &&BANKS.some(b=>Math.hypot(b.x-p.worldX,b.z-p.worldZ)<=4);
}
