import type {BotWorldState} from '../rs-sdk/sdk/types';
import type {BankView} from './banks';
import type {PlannedStep} from './readiness';
import {workRequirements,type ItemNeed} from './skills';
import {smithRecipe} from './game-requirements';
import {cleanLookupText} from './lookup-text';
const production=/^(smelt|smith|cook|craft|fletch|firemake)$/;
const reusable=/^(hammer|tinderbox|knife|chisel|.+ mould)$/i;
export const isProduction=(action:string)=>production.test(action);
/** A known output name, never a claim that the action has happened. */
export function productionOutput(action:string,target:string|null):string|undefined {
    const t=cleanLookupText(target??'').toLowerCase();
    if(!t)return;
    if(action==='smelt'&&/^(bronze|iron|steel|silver|gold|mithril|adamant|rune)$/.test(t))return `${t==='adamant'?'adamantite':t} bar`;
    if(action==='smith'&&smithRecipe(t))return t;
    if(action==='fletch'&&/^(arrow shafts?|shortbow)$/.test(t))return /^arrow/.test(t)?'arrow shaft':'shortbow';
    if(action==='cook')return t.replace(/^raw /,'');
    if(action==='craft'&&/^(gold ring|gold necklace|gold amulet)$/.test(t))return t;
    if(action==='craft'&&/^cut (opal|jade|red topaz|sapphire|emerald|ruby|diamond)$/.test(t))return t.replace(/^cut /,'');
}
export function pipelineProduces(step:{action:string;args:{target:string|null}},need:ItemNeed):boolean {
    const output=productionOutput(step.action,step.args.target);
    return !!output&&need.match.test(output)
        ||step.action==='fish'&&!!step.args.target&&need.match.test(`Raw ${step.args.target}`)
        ||step.action==='chop_trees'&&need.match.test(/^(logs|normal|tree)$/i.test(step.args.target??'logs')?'Logs':`${step.args.target} logs`);
}
export function productionInputs(s:BotWorldState,steps:PlannedStep[]):ItemNeed[]|undefined {
    const inputs=new Map<string,ItemNeed>(),runs=new Map<number,number>();
    for(let i=steps.length-1;i>=0;i--) {
        const step=steps[i];if(!isProduction(step.action))continue;
        const req=workRequirements(s,step.action,step.args);if(req.blocker)return;
        const multiplier=Math.max(1,runs.get(i)??0);
        for(const n of req.items) {
            if(n.tool||reusable.test(n.name))continue;
            if(/you can| or /.test(n.name))return;
            const producer=steps.findLastIndex((p,j)=>j<i&&pipelineProduces(p,n));
            if(producer>=0){runs.set(producer,(runs.get(producer)??0)+n.count*multiplier);continue;}
            const old=inputs.get(n.name);inputs.set(n.name,{...n,count:(old?.count??0)+n.count*multiplier});
        }
    }
    return inputs.size?[...inputs.values()]:undefined;
}
export function automaticProductionCycle(steps:PlannedStep[]):boolean {
    const work=steps.filter(s=>isProduction(s.action));
    return work.length>0&&steps.at(-1)?.action==='bank_resources'
        &&steps.every(s=>!s.give&&(isProduction(s.action)||/^(withdraw_from_bank|bank_resources|equip)$/.test(s.action)))
        &&work.every(s=>s.until.type==='exhausted'&&(s.action==='firemake'||!!s.args.target&&!!productionOutput(s.action,s.args.target)));
}
export function ownedProduction(s:BotWorldState,bank:BankView|undefined,steps:PlannedStep[],now=Date.now()) {
    const inputs=productionInputs(s,steps);
    const known=!!bank&&now-bank.t>=0&&now-bank.t<=30*60_000;
    if(!inputs)return {known:false,units:0,inputs:[] as {name:string;carried:number;banked:number;perUnit:number}[]};
    const facts=inputs.map(n=>({name:n.name,perUnit:n.count,carried:s.inventory.filter(i=>n.match.test(i.name)).reduce((v,i)=>v+i.count,0),banked:known?Object.entries(bank!.items).filter(([name])=>n.match.test(name)).reduce((v,[,count])=>v+count,0):0}));
    // Bank deposits canonicalize notes. Carried same-name singles cannot prove item form,
    // so continuation capacity conservatively credits bank stock only (including intermediates).
    const recipes=steps.map(step=>isProduction(step.action)?workRequirements(s,step.action,step.args).items.filter(n=>!n.tool&&!reusable.test(n.name)):[]);
    for(let i=0;i<recipes.length;i++)for(const n of recipes[i])if(!facts.some(f=>f.name===n.name)&&steps.slice(0,i).some(p=>pipelineProduces(p,n)))
        facts.push({name:n.name,perUnit:n.count,carried:s.inventory.filter(item=>n.match.test(item.name)).reduce((v,item)=>v+item.count,0),banked:known?Object.entries(bank!.items).filter(([name])=>n.match.test(name)).reduce((v,[,count])=>v+count,0):0});
    const canMake=(units:number)=>{
        const pool=Object.entries(known?bank!.items:{}).map(([name,count])=>({name,count}));
        const credit=pool.map(x=>({...x})),runs=steps.map((step,i)=>isProduction(step.action)?units:0),needed=new Map<number,number>();
        for(let i=steps.length-1;i>=0;i--)for(const n of recipes[i]) {
            const producer=steps.findLastIndex((p,j)=>j<i&&pipelineProduces(p,n));if(producer<0)continue;
            let count=n.count*runs[i];
            for(const item of credit){if(!n.match.test(item.name))continue;const used=Math.min(item.count,count);item.count-=used;count-=used;}
            needed.set(producer,(needed.get(producer)??0)+count);
            runs[producer]=Math.max(units,needed.get(producer)!);
        }
        // Simulate the actual preserved order: every chosen upstream step must run too.
        for(let i=0;i<steps.length;i++) {
            for(const n of recipes[i]) {
                let count=n.count*runs[i];
                for(const item of pool){if(!n.match.test(item.name))continue;const used=Math.min(item.count,count);item.count-=used;count-=used;}
                if(count>0)return false;
            }
            const output=productionOutput(steps[i].action,steps[i].args.target);
            if(output&&isProduction(steps[i].action))pool.push({name:output,count:runs[i]});
        }
        return true;
    };
    let low=0,high=2001;
    if(known)while(high-low>1){const mid=Math.floor((low+high)/2);if(canMake(mid))low=mid;else high=mid;}
    return {known,bankAt:known?bank!.t:undefined,units:low,inputs:facts};
}
export function productionBatchText(facts:ReturnType<typeof ownedProduction>):string {
    if(!facts.known)return 'Batch finished; verify own-bank inputs.';
    const bank=facts.inputs.filter(n=>n.banked>0).map(n=>`${n.banked} ${n.name}`).join(', ');
    return facts.units>0?`Batch finished; bank: ${bank} (${facts.units===2000?'>=':'~'}${facts.units} more recipe units); withdraw next batch.`
        :'Batch finished; no complete banked recipe; check carried inputs before sourcing.';
}
