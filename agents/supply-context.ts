import {pipelineProduces,ownedProduction} from './production-cycle';
import type {BotWorldState} from '../rs-sdk/sdk/types';
import type {AgentEvent} from './events';
import type {PartyPlan} from './memory';
import type {BankView} from './banks';
import {workRequirements,type Args} from './skills';
import {missionSupplyWork,memberFrom,type Ctx} from './missions';
import {foodHealing} from './combat-food';
import {supplyCoverage,SUPPLY_BANK_MAX_AGE,type SupplyDemand,type SupplyStock} from './supply-coverage';
interface Work {action:string;args:Args;give?:unknown}
export interface SupplyActor {name:string;sdk:{getState:()=>BotWorldState|null;getStateAge?:()=>number};routine?:{steps:Work[];repeat?:boolean}|null;routineStep?:number}
const FOOD='cooked food (nominal healing HP)';
const reusable=/^(hammer|tinderbox|knife|chisel|.+ mould)$/i;
const lower=(a:{name:string;count:number}[])=>{const v:Record<string,number>={};for(const i of a)v[i.name.toLowerCase()==='feathers'?'feather':i.name.toLowerCase()]=(v[i.name.toLowerCase()==='feathers'?'feather':i.name.toLowerCase()]??0)+i.count;return v;};
/** Evidence uses whole-order time, including preparation/travel; it is not a station speed claim. */
export function supplyRate(events:AgentEvent[],name:string,action:string,target:string,now:number):{rate:number;basis:string} {
    const rates=events.filter(e=>e.bot===name&&e.action===action&&String(e.target??'').toLowerCase()===target.toLowerCase()&&e.type==='order_end'&&now-e.t>=0&&now-e.t<=2*3600_000)
        .slice(-6).flatMap(e=>{
            const units=action==='smelt'?Number((e.smelting as any)?.resolvedAttempts):0;
            const minutes=Number(e.durationMs)/60_000;
            return Number.isFinite(units)&&Number.isFinite(minutes)&&units>0&&minutes>=.33?[units/minutes]:[];
        }).sort((a,b)=>a-b);
    return rates.length?{rate:Math.max(.1,Math.min(60,rates[Math.floor(rates.length/2)])),basis:`measured whole-order attempt rate (${rates.length} samples)`}
        :{rate:action==='fish'?4:2,basis:'planning prior, not measured throughput'};
}
export function partySupplyCoverage(actors:Iterable<SupplyActor>,plan:PartyPlan,bankOf:(name:string)=>BankView|undefined,events:AgentEvent[],now=Date.now()) {
    const all=[...actors];
    const live=all.flatMap(a=>{const s=a.sdk.getState();return s?.inGame&&(a.sdk.getStateAge?.()??Infinity)<=30_000?[{a,s}]:[];});
    const stocks:SupplyStock[]=live.map(({a,s})=>{const b=bankOf(a.name);return {name:a.name,carried:lower(s.inventory),bank:b?lower(Object.entries(b.items).map(([name,count])=>({name,count}))):undefined,bankAt:b?.t};});
    for(const stock of stocks)for(const collection of [stock.carried,stock.bank])if(collection)
        collection[FOOD]=Object.entries(collection).reduce((n,[name,count])=>n+foodHealing(name)*count,0);
    for(const stock of stocks) {
        const names=new Set([...Object.keys(stock.carried),...Object.keys(stock.bank??{})]);
        stock.foods=[...names].filter(n=>foodHealing(n)>0).map(name=>({name,heals:foodHealing(name),count:(stock.carried[name]??0)+((stock.bankAt!==undefined&&now-stock.bankAt>=0&&now-stock.bankAt<=SUPPLY_BANK_MAX_AGE)?stock.bank?.[name]??0:0)}));
    }
    const ctx:Ctx={size:all.length,members:live.map(({a,s})=>{
        const stock=stocks.find(x=>x.name===a.name)!;
        return memberFrom(a.name,s,stock.bankAt!==undefined&&now-stock.bankAt>=0&&now-stock.bankAt<=SUPPLY_BANK_MAX_AGE?stock.bank:{});
    }),has:()=>false};
    const missionWork=missionSupplyWork(plan.teamGoal,ctx);
    const demands:SupplyDemand[]=[];
    for(const {a,s} of live) {
        const owner=stocks.find(x=>x.name===a.name)!;
        const own=(name:string)=>(owner.carried[name]??0)+((owner.bankAt!==undefined&&now-owner.bankAt>=0&&now-owner.bankAt<=SUPPLY_BANK_MAX_AGE)?owner.bank?.[name]??0:0);
        const primary=missionWork.filter(w=>w.owner===a.name).map((w,index)=>({action:w.action,args:{target:w.target},primary:true,supplyUnitsCap:w.supplyUnitsCap,sourceIndex:index}));
        const full=(a.routine?.steps??[]).map((w,index)=>({...w,primary:false,supplyUnitsCap:undefined as number|undefined,sourceIndex:index}));
        const current=full.filter((w,index)=>!w.give&&(a.routine?.repeat||index>=(a.routineStep??0)));
        const provenance=[...primary,...full];
        for(const w of [...primary,...current]) {
            if(w.action!=='smith')continue;
            for(const n of workRequirements(s,w.action,w.args).items) {
                const metal=n.name.replace(/ bar$/,'').replace(/^adamantite$/,'adamant');
                if(!/^(bronze|iron|steel|silver|gold|mithril|adamant|rune)$/.test(metal)||own(n.name)>=n.count*20)continue;
                const upstream={action:'smelt',args:{target:metal},primary:w.primary,supplyUnitsCap:undefined as number|undefined,sourceIndex:w.sourceIndex-.5};
                const planned=provenance.some(p=>p.primary===w.primary&&p.sourceIndex<w.sourceIndex&&pipelineProduces(p,n));
                const raw=ownedProduction(s,bankOf(a.name),[{...upstream,until:{type:'exhausted',skill:null,value:0}}],now);
                if(!planned&&raw.known&&raw.units>0) {
                    provenance.push(upstream);if(w.primary)primary.push(upstream);else current.push(upstream);
                }
            }
        }
        const work=[...primary.sort((a,b)=>a.sourceIndex-b.sourceIndex),...current.sort((a,b)=>a.sourceIndex-b.sourceIndex)].slice(0,18);
        for(let i=0;i<work.length;i++) {
            const w=work[i];
            if(/^(fight|assist|pickpocket)$/.test(w.action)) {
                const samples=events.filter(e=>e.bot===a.name&&e.type==='order_end'&&e.action===w.action&&String(e.target??'').toLowerCase()===(w.args.target??'').toLowerCase()&&now-e.t>=0&&now-e.t<=2*3600_000&&Number.isFinite(e.durationMs)&&Number(e.durationMs)>=20_000&&Number.isFinite((e.fight as any)?.nominalHealingConsumed)&&Number((e.fight as any)?.nominalHealingConsumed)>0).slice(-6);
                const measured=samples.reduce((n,e)=>n+Number((e.fight as any).nominalHealingConsumed),0)/Math.max(1,samples.reduce((n,e)=>n+Number(e.durationMs)/60_000,0));
                const rate=samples.length?measured:Math.max(1,(s.player?.maxHp??10)*.1);
                demands.push({receiver:a.name,action:w.action,target:w.args.target??'',item:FOOD,perUnit:1,unitsPerMinute:rate,basis:samples.length?'measured healing HP use, whole-order time':'healing HP planning prior, not measured consumption',primary:w.primary});
                continue;
            }
            if(!/^(smelt|smith|cook|craft|fletch|firemake|fish|cast)$/.test(w.action))continue;
            const req=workRequirements(s,w.action,w.args);if(req.blocker)continue;
            const inputs=req.items.filter(n=>!n.tool&&!reusable.test(n.name));
            for(const input of inputs) {
                const name=input.name.toLowerCase()==='feathers'?'feather':input.name.toLowerCase();
                // Generic alternative-material requirements are not an exact supply request.
                if(/you can| or /.test(name))continue;
                const internal=provenance.some(p=>p.primary===w.primary&&p.sourceIndex<w.sourceIndex&&pipelineProduces(p,input));
                if(internal)continue;
                const perUnit=w.action==='fish'&&/bait|feather/.test(name)?1:input.count;
                const caps=[...(w.supplyUnitsCap!==undefined?[w.supplyUnitsCap]:[]),...inputs.filter(n=>n!==input&&own(n.name.toLowerCase())>0).map(n=>Math.floor(own(n.name.toLowerCase())/(w.action==='fish'&&/bait|feather/.test(n.name)?1:n.count)))];
                const r=supplyRate(events,a.name,w.action,w.args.target??'',now);
                demands.push({receiver:a.name,action:w.action,target:w.args.target??'',item:name,perUnit,unitsPerMinute:r.rate,basis:r.basis,primary:w.primary,...(caps.length?{unitsCap:Math.min(...caps)}:{})});
            }
        }
    }
    return supplyCoverage(stocks,demands,now);
}
