import { foodHealing } from './combat-food';
import type { BotWorldState, NearbyNpc } from '../rs-sdk/sdk/types';

export type FightPhase = 'combat' | 'moving' | 'looting' | 'other';
export interface FightReport {
    scope: 'order'; engagements: number; observedTargetDefeats: number; unresolvedEnds: number;
    observedHpLost: number; foodEaten: number; nominalHealingConsumed: number; foodByName: Record<string,number>; elapsedMs: number; xpPerHour: Record<string,number>; phaseMs: Record<FightPhase,number>;
}
interface Target { index:number; id:number; engaged:boolean; closed:boolean }
/** Order-local telemetry. Target disappearance is uncertainty, not proof of a kill or its owner. */
export class FightObservation {
    readonly defeats:{t:number;index:number;id:number;name:string;x:number;z:number;plane:number}[]=[];
    readonly report: FightReport = {scope:'order',engagements:0,observedTargetDefeats:0,unresolvedEnds:0,
        observedHpLost:0,foodEaten:0,nominalHealingConsumed:0,foodByName:{},elapsedMs:0,xpPerHour:{},phaseMs:{combat:0,moving:0,looting:0,other:0}};
    private target?: Target;
    private hp?: number;
    private life?: number;
    private phase:FightPhase='other';
    private finished=false;
    private since:number;
    private readonly started:number;
    constructor(private now=Date.now){this.started=this.since=now();}
    setPhase(phase:FightPhase):void {
        if(this.finished)return;
        const t=this.now();this.report.phaseMs[this.phase]+=Math.max(0,t-this.since);this.since=t;this.phase=phase;
    }
    async during<T>(phase:FightPhase, work:()=>Promise<T>):Promise<T> {
        const before=this.phase;this.setPhase(phase);
        try{return await work();}finally{this.setPhase(before);}
    }
    select(npc:NearbyNpc):void {
        if(this.finished)return;
        if(this.target&&!this.target.closed&&this.target.index===npc.index&&this.target.id===npc.id)return;
        this.closeUnknown();
        this.target={index:npc.index,id:npc.id,engaged:false,closed:false};
    }
    trackedTarget(s:BotWorldState|null):NearbyNpc|undefined {
        const t=this.target;if(!t||t.closed||!t.engaged||this.finished)return;
        return s?.nearbyNpcs.find(n=>n.index===t.index&&n.id===t.id&&n.hp!==0&&n.healthPercent!==0);
    }
    observe(s:BotWorldState|null|undefined,receivedAt?:number):void {
        if(this.finished||!s)return;
        const p=s.player;
        if(p && this.life===p.lifeId && this.hp!=null && Number.isFinite(p.hp))this.report.observedHpLost+=Math.max(0,this.hp-p.hp);
        this.hp=p?.hp;this.life=p?.lifeId;
        const t=this.target;if(!t||t.closed)return;
        const npc=(s.nearbyNpcs??[]).find(n=>n.index===t.index&&n.id===t.id);
        if(!npc){this.closeUnknown();return;}
        if(!t.engaged&&p?.combat.inCombat&&p.combat.targetType==='npc'&&p.combat.targetIndex===t.index){t.engaged=true;this.report.engagements++;}
        if(npc.hp===0||npc.healthPercent===0){
            if(t.engaged){this.report.observedTargetDefeats++;if(receivedAt!==undefined&&Number.isFinite(receivedAt)&&this.now()-receivedAt>=0&&this.now()-receivedAt<=5000)this.defeats.push({t:this.now(),index:npc.index,id:npc.id,name:npc.name,x:npc.tileX??npc.x,z:npc.tileZ??npc.z,plane:p?.level??-1});if(this.defeats.length>8)this.defeats.shift();}
            t.closed=true;
        }
    }
    food(before:BotWorldState|null,after:BotWorldState|null,success:boolean):void {
        if(this.finished||!success||!before?.player||!after?.player||before.player.lifeId!==after.player.lifeId||after.player.hp<=0)return;
        const amounts=(s:BotWorldState)=>{
            const counts:Record<string,number>={};
            for(const i of s.inventory)if(/^(shrimps|anchovies|sardine|herring|trout|pike|salmon|tuna|lobster|swordfish|bread|cake|meat|cooked )/i.test(i.name))counts[i.name]=(counts[i.name]??0)+i.count;
            return counts;
        };
        const b=amounts(before),a=amounts(after);
        for(const [name,n] of Object.entries(b)) {
            const eaten=Math.max(0,n-(a[name]??0));
            this.report.foodEaten+=eaten;
            if(eaten)this.report.foodByName[name]=(this.report.foodByName[name]??0)+eaten;
            this.report.nominalHealingConsumed+=eaten*foodHealing(name);
        }
    }
    finish(xp:Record<string,number>={}):FightReport {
        if(this.finished)return this.report;
        this.setPhase(this.phase);this.report.elapsedMs=Math.max(0,this.since-this.started);
        this.closeUnknown();
        if(this.report.elapsedMs>0)this.report.xpPerHour=Object.fromEntries(Object.entries(xp).filter(([,n])=>n>0&&Number.isFinite(n)).map(([skill,n])=>[skill,Math.round(n*3600_000/this.report.elapsedMs)]));
        this.finished=true;return this.report;
    }
    summary():string {
        const r=this.report, seconds=(ms:number)=>`${Math.round(ms/1000)}s`;
        return `fight report (whole order): ${r.engagements} exact-target engagements; ${r.observedTargetDefeats} target defeats observed, ${r.unresolvedEnds} unresolved ends (not counted as kills); ${r.observedHpLost} observed HP lost, ${r.foodEaten} food eaten (${r.nominalHealingConsumed} nominal healing HP); time combat/attack ${seconds(r.phaseMs.combat)}, navigation ${seconds(r.phaseMs.moving)}, loot/bury ${seconds(r.phaseMs.looting)}, other ${seconds(r.phaseMs.other)}; ${Object.entries(r.xpPerHour).map(([k,n])=>`${k} ${n} XP/h`).join(', ') || 'no measured XP rate'}; defeats are not kill-credit attribution`;
    }
    private closeUnknown():void {
        if(this.target&&!this.target.closed){if(this.target.engaged)this.report.unresolvedEnds++;this.target.closed=true;}
    }
}
