import type {BotWorldState} from '../rs-sdk/sdk/types';
import type {AgentEvent} from './events';
import {freshPosition} from './learning-pilot';
import {validWorldObservation} from './world-observation';
export interface Region {name:string;x:number;z:number;radius:number}
export const REGIONS:Region[]=[
 {name:'Varrock',x:3220,z:3410,radius:155},{name:'Lumbridge',x:3230,z:3230,radius:145},
 {name:'Western Coast',x:3015,z:3250,radius:155},{name:'Falador',x:2970,z:3355,radius:155},
 {name:'Northern Roads',x:3090,z:3455,radius:150},{name:'Al Kharid',x:3280,z:3200,radius:150},
];
export interface FieldProof {leader?:string;assistant?:string;routineId?:number;npcIndex?:number;npcId?:number;kind:'survey'|'trial';run:string;t:number;bot:string;action:string;target:string;x:number;z:number;plane:number;xp?:number;dialogue?:string}
export interface ExpeditionCheck {kind:'expedition';region:Region;participants:string[];member?:string;minMethods?:number;since:number;proofs?:FieldProof[]}
export const FIELD_ACTIONS=new Set(['mine','fish','chop_trees','fight','cast','pickpocket','cook','craft','fletch','firemake']);
export const STARTER=/^(cow|chicken|goblin|giant rat|rat|imp)s?$/i;
export const inRegion=(p:{x:number;z:number;plane?:number},r:Region)=>p.plane===0&&Math.hypot(p.x-r.x,p.z-r.z)<=r.radius;
export interface FieldSample {t:number;x:number;z:number;plane:number;xp:number}
/** Samples XP where it is observed, not where the order begins/ends or intends to go. */
export class FieldObservation {
    private previous=new Map<string,number>();private life?:number;private baseline=false;readonly samples:FieldSample[]=[];
    constructor(readonly startedAt:number){}
    observe(s:BotWorldState|null,receivedAt:number|undefined,now=Date.now()):void {
        const p=freshPosition(s?.player,receivedAt,now);
        if(!s?.player||!p||!Number.isFinite(receivedAt)||receivedAt!<this.startedAt) {this.baseline=false;this.previous.clear();this.life=undefined;return;}
        const current=new Map(s.skills.map(k=>[k.name,k.experience]));
        const gain=this.baseline&&this.life===s.player.lifeId?[...current].reduce((sum,[name,xp])=>sum+Math.max(0,xp-(this.previous.get(name)??xp)),0):0;
        this.previous=current;this.life=s.player.lifeId;this.baseline=true;
        if(!Number.isFinite(gain)||gain<=0)return;
        // Eight recent productive tiles bound event size. Missing earlier evidence cannot create success.
        const last=this.samples.at(-1);
        if(last&&last.x===p.x&&last.z===p.z&&last.plane===p.plane){last.xp+=gain;last.t=now;}
        else {this.samples.push({t:now,x:p.x,z:p.z,plane:p.plane,xp:gain});if(this.samples.length>8)this.samples.shift();}
    }
}
function proofFor(c:ExpeditionCheck,e:AgentEvent,run:string):FieldProof|undefined {
    if(e.type!=='order_end'||!run||!Number.isFinite(c.since)||c.since<=0||!Number.isFinite(e.t)||e.t<c.since
        ||!c.participants.includes(e.bot)||(c.member&&c.member!==e.bot)
        ||typeof e.orderStartedAt!=='number'||!Number.isFinite(e.orderStartedAt)||e.orderStartedAt<c.since||e.orderStartedAt>e.t)return;
    const startedAt=e.orderStartedAt as number;
    const action=String(e.action??''),target=String(e.target??'').slice(0,80);
    const base={run:run.slice(0,100),t:e.t,bot:e.bot,action,target};
    const world=validWorldObservation(e.worldObservation)?e.worldObservation:undefined;
    if(world&&world.at>=c.since&&world.at<=e.t&&e.t-world.at<=10000&&inRegion(world.position,c.region)) {
        if(action==='look'&&e.outcome==='done')return {...base,...world.position,kind:'survey'};
        if(action==='interact'&&/:\s*talk-to\s*$/i.test(target)&&world.dispatch?.success&&world.dialogue)
            return {...base,...world.position,kind:'trial',action:'conversation',dialogue:world.dialogue.slice(0,240)};
    }
    if(!FIELD_ACTIONS.has(action)||((action==='fight'||action==='cast')&&STARTER.test(target)))return;
    if(action==='fight'&&!(Number((e.fight as any)?.engagements)>=1))return;
    const field=e.fieldWork as {startedAt?:number;samples?:FieldSample[]}|undefined;
    if(field?.startedAt!==e.orderStartedAt||!Array.isArray(field.samples)||field.samples.length>8)return;
    const sample=field.samples.find(p=>Number.isFinite(p.t)&&p.t>=c.since&&p.t>=startedAt&&p.t<=e.t
        &&Number.isFinite(p.xp)&&p.xp>0&&[p.x,p.z,p.plane].every(Number.isFinite)&&inRegion(p,c.region));
    return sample?{...base,kind:'trial',x:sample.x,z:sample.z,plane:sample.plane,xp:sample.xp}:undefined;
}
export function addFieldProof(c:ExpeditionCheck,e:AgentEvent,run:string):ExpeditionCheck|undefined {
    const p=proofFor(c,e,run);if(!p)return;
    const proofs=c.proofs??[];
    if(proofs.some(o=>o.bot===p.bot&&o.kind===p.kind&&(p.kind==='survey'||o.action===p.action)))return;
    if(p.kind==='trial'&&proofs.filter(o=>o.bot===p.bot&&o.kind==='trial').length>=3||proofs.length>=16)return;
    return {...c,proofs:[...proofs,p]};
}
export function fieldReading(c:ExpeditionCheck):{met:boolean;known:boolean;progress:string} {
    const proofs=(c.proofs??[]).filter(p=>c.participants.includes(p.bot)&&p.t>=c.since&&p.run&&inRegion(p,c.region));
    const surveyed=new Set(proofs.filter(p=>p.kind==='survey').map(p=>p.bot));
    const trials=proofs.filter(p=>p.kind==='trial'&&surveyed.has(p.bot));
    if(c.member) {
        const seen=surveyed.has(c.member),worked=trials.some(p=>p.bot===c.member);
        return {met:seen&&worked,known:true,progress:`${c.member} at ${c.region.name}: survey ${seen?'observed':'pending'}, practical test ${worked?'observed':'pending'}`};
    }
    const methods=new Set(trials.map(p=>p.action));
    return {met:methods.size>=(c.minMethods??3),known:true,progress:`${methods.size}/${c.minMethods??3} distinct field activities (${[...methods].join(', ')||'none'}); only surveyed participants count`};
}
interface Goal {key?:string;set:number;milestones:{id:number;auto?:{check?:unknown};done:boolean;doneAt?:number}[]}
/** Merge event progress after awaited council turns, never into another mission or new acceptance. */
export function mergeFieldProgress<T extends Goal>(draft:T,live:Goal|undefined):T {
    if(!live||draft.key!==live.key||draft.set!==live.set)return draft;
    for(const m of draft.milestones) {
        const c=m.auto?.check as ExpeditionCheck|undefined;if(!c||!['expedition','hunt'].includes(c.kind))continue;
        const current=live.milestones.find(o=>o.id===m.id)?.auto?.check as ExpeditionCheck|undefined;
        if(current?.kind!==c.kind||current.since!==c.since)continue;
        if(c.kind as string==='hunt') {
            Object.assign(c,current);const latest=live.milestones.find(o=>o.id===m.id)!;
            if(latest.done){m.done=true;m.doneAt=latest.doneAt;}continue;
        }
        const proofs=[...(current.proofs??[]),...(c.proofs??[])];
        const seen=new Set<string>();
        c.proofs=proofs.filter(p=>{const key=JSON.stringify([p.bot,p.kind,p.kind==='survey'?'':p.action]);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,16);
        const latest=live.milestones.find(o=>o.id===m.id)!;
        if(latest.done){m.done=true;m.doneAt=latest.doneAt;}
    }
    return draft;
}
export function bindExpedition<T extends {kind:string}>(check:T,at:number):T {
    return ['expedition','hunt'].includes(check.kind)?{...check,since:at,proofs:[]}:check;
}
export function recordFieldGoal<T extends Goal>(goal:T|undefined,e:AgentEvent,run:string):T|undefined {
    if(!goal)return;
    let changed=false;
    const milestones=goal.milestones.map(m=>{
        const c=m.auto?.check as ExpeditionCheck|undefined;
        if(m.done||c?.kind!=='expedition')return m;
        const next=addFieldProof(c,e,run);if(!next)return m;
        changed=true;return {...m,auto:{...m.auto,check:next}};
    });
    return changed?{...goal,milestones}:undefined;
}
/** Reject a known non-qualifying production loop while this participant still owes fieldwork. */
export function expeditionRoutineProblem(goal:Goal|undefined,name:string,steps:{action:string;args:{target:string|null}}[]):string|null {
    const own=goal?.milestones.find(m=>!m.done&&(m.auto?.check as ExpeditionCheck|undefined)?.kind==='expedition'&&(m.auto!.check as ExpeditionCheck).member===name);
    if(!own||!steps.some(s=>s.action==='smith'||s.action==='smelt'))return null;
    const trial=steps.some(s=>FIELD_ACTIONS.has(s.action)&&!((s.action==='fight'||s.action==='cast')&&STARTER.test(s.args.target??''))
        ||s.action==='interact'&&/:\s*talk-to\s*$/i.test(s.args.target??''));
    return trial?null:'Your expedition practical test is still pending. Smithing/smelting is personal work and cannot satisfy it. Choose an in-region resource, fishing, non-starter combat or real NPC conversation test; survey and prepare first. Resume personal production after your contribution, or explicitly renegotiate the shared obligation.';
}
