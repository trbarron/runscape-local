import type {BotWorldState} from '../rs-sdk/sdk/types';
import type {Spot} from './world-index/index';
import {activePilot,type LearningState} from './learning-pilot';

/** Optional candidates, never a claim of a traversable route, a quest or completed exploration. */
export function discoveryOptions(state:BotWorldState|null,ageMs:number,spots:Spot[],guide:LearningState|undefined,now=Date.now()):string {
    const p=state?.player;
    if(!p||!guide?.extension||!activePilot(guide,now)||ageMs<0||ageMs>5000||p.level!==0)return '';
    const own=guide.observations.filter(o=>o.bot===p.name.toLowerCase()&&now-o.t<6*3600_000);
    const visited=(spot:Spot)=>own.some(o=>{
        try {
            const pos=o.world?.position??JSON.parse(o.facts).observedPosition;
            return pos&&Math.hypot(pos.x-spot.x,pos.z-spot.z)<24;
        }catch{return false;}
    });
    const distance=(s:Spot)=>Math.hypot(s.x-p.worldX,s.z-p.worldZ);
    const candidates=spots.filter(s=>!s.via&&!s.tollGate&&s.z<3560&&distance(s)<=400&&distance(s)>24&&!visited(s))
        .sort((a,b)=>distance(a)-distance(b)||a.type.localeCompare(b.type));
    const lines:string[]=[];
    const talk=state!.nearbyNpcs?.filter(n=>n.reachable!==false&&n.optionsWithIndex.some(o=>/^talk-to$/i.test(o.text))
        &&! /^(banker|man|woman|guard|fishing spot)$/i.test(n.name)
        &&!own.some(o=>o.action==='interact'&&o.target.toLowerCase().startsWith(n.name.toLowerCase()+':')))
        .sort((a,b)=>a.distance-b.distance)[0];
    if(talk)lines.push(`Conversation: look, then interact "${talk.name}: Talk-to"; inspect actual dialogue, choose a next question. No quest/reward assumed.`);
    const survey=candidates.find(s=>s.kind==='tree'||s.kind==='rock'||s.kind==='fishing');
    if(survey)lines.push(`Survey: look up ${survey.type} near ${survey.near}; candidate travel "${survey.x},${survey.z}", look for resources/access, return to a chosen bank. Index is not a verified route.`);
    const hunt=candidates.find(s=>s.kind==='monster'&&(s.level??999)>3&&(s.level??999)<=p.combatLevel&&s.hp);
    if(hunt)lines.push(`Comparison: look up ${hunt.type} near ${hunt.near} (${hunt.x},${hunt.z}); if provisioned, test a short fight versus your familiar method using XP/time, HP and food. Optional partner via invite_assist; multicombat rechecked.`);
    return lines.length?`OPTIONAL DISCOVERY PROJECTS (choose, adapt or decline; negotiate around deliveries; 5–10min including preparation/return, check route/provisions first)\n${lines.slice(0,3).join('\n')}`.slice(0,1000):'';
}
