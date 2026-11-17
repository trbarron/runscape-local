import type {BotWorldState} from '../rs-sdk/sdk/types';

export interface WorldObservation {
    dispatch?:{success:boolean;message:string}; at:number; position:{x:number;z:number;plane:number};
    npcs:string[]; objects:string[]; items:string[]; dialogue?:string;
}
const clean=(s:unknown,n:number)=>typeof s==='string'?s.replace(/\s+/g,' ').trim().slice(0,n):'';
/** Actual SDK scene, not an atlas destination or a character's geographic interpretation. */
export function observeWorld(s:BotWorldState|null,receivedAt:number|undefined,now=Date.now(),dialogue?:string,dispatch?:{success:boolean;message:string}):WorldObservation|undefined {
    const p=s?.player;
    if(!p||receivedAt===undefined||now-receivedAt<0||now-receivedAt>5000||![p.worldX,p.worldZ,p.level].every(Number.isFinite))return;
    const entities=(rows:{name:string;optionsWithIndex?:{text:string}[]}[],max:number)=>
        [...new Set(rows.map(n=>`${clean(n.name,36)}:${(n.optionsWithIndex??[]).map(o=>clean(o.text,20)).filter(Boolean).slice(0,2).join('/')}`))].sort().slice(0,max);
    const world:WorldObservation={...(dispatch?{dispatch:{success:dispatch.success,message:clean(dispatch.message,120)}}:{}),at:now,position:{x:p.worldX,z:p.worldZ,plane:p.level},
        npcs:entities(s!.nearbyNpcs??[],6),objects:entities(s!.nearbyLocs??[],6),
        items:[...new Set((s!.groundItems??[]).map(i=>clean(i.name,36)))].sort().slice(0,4),
        ...(clean(dialogue,500)?{dialogue:clean(dialogue,500)}:{})};
    while(JSON.stringify(world).length>1400) {
        const rows=[world.objects,world.npcs,world.items].sort((a,b)=>b.length-a.length)[0];
        if(rows.length)rows.pop();
        else if(world.dialogue?.length)world.dialogue=world.dialogue.slice(0,-20);
        else if(world.dispatch?.message.length)world.dispatch.message=world.dispatch.message.slice(0,-20);
        else break;
    }
    return world;
}
export function validWorldObservation(v:unknown):v is WorldObservation {
    if(!v||typeof v!=='object')return false;
    const w=v as WorldObservation;
    return Number.isFinite(w.at)&&!!w.position&&[w.position.x,w.position.z,w.position.plane].every(Number.isFinite)
        &&[w.npcs,w.objects,w.items].every((a,i)=>Array.isArray(a)&&a.length<=[6,6,4][i]&&a.every(n=>typeof n==='string'&&n.length<=80))
        &&(!w.dispatch||typeof w.dispatch.success==='boolean'&&typeof w.dispatch.message==='string'&&w.dispatch.message.length<=120)
        &&JSON.stringify(w).length<=1400
        &&(w.dialogue===undefined||typeof w.dialogue==='string'&&w.dialogue.length<=500);
}
