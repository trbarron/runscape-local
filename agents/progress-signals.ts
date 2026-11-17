import type { AgentEvent } from './events';
/** Repeated early failures are still failures when a few XP were gained first. */
export function productiveBlockSignals(events:AgentEvent[],since:number):{key:string;message:string}[] {
    const groups=new Map<string,{bot:string;action:string;reason:string;n:number}>();
    for(const e of events) {
        if(e.t<since||e.type!=='order_end'||e.outcome!=='blocked'||!Object.values(e.xp as Record<string,number>??{}).some(n=>n>0))continue;
        const reason=String(e.reason??'').replace(/\d+(?:\.\d+)?/g,'#');
        const key=`${e.bot}:${e.action}:${reason}`;
        const g=groups.get(key)??{bot:e.bot,action:String(e.action),reason,n:0};g.n++;groups.set(key,g);
    }
    return [...groups].filter(([,g])=>g.n>=3).map(([key,g])=>({key,message:`${g.bot}: ${g.action} blocked ${g.n} times despite XP gains (${g.reason}); review recovery/dependency instead of treating partial progress as healthy completion`}));
}
/** Controller wiring is injected so startup, recursion and dedup are testable without a party. */
export function createProgressMonitor(o:{ready:()=>boolean;events:()=>AgentEvent[];warn:(text:string)=>void;
    notice:(text:string)=>void;council:()=>void;now?:()=>number}) {
    const sent=new Map<string,number>(),now=o.now??Date.now;
    return (e:AgentEvent)=>{
        if(e.type!=='order_end'||!o.ready())return;
        for(const signal of productiveBlockSignals(o.events(),now()-30*60_000)) {
            if(now()-(sent.get(signal.key)??-Infinity)<30*60_000)continue;
            sent.set(signal.key,now());
            o.warn(signal.message);o.notice(signal.message);o.council();
        }
    };
}
