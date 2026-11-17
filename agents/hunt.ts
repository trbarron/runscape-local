import type {AgentEvent} from './events';
import type {Ctx,MenuMission} from './missions';
import type {FieldProof} from './expedition';
export interface HuntCheck {kind:'hunt';target:'guard'|'white knight'|'return';since:number;readyAt?:number;proofs?:FieldProof[];fighters?:string[]}
function matchedPair(c:HuntCheck):FieldProof|undefined {
 const ps=c.proofs??[];
 return ps.find(p=>p.action==='paired'&&ps.some(d=>d.action==='defeat'&&p.run===d.run&&p.leader===d.bot&&p.routineId===d.routineId&&p.npcIndex===d.npcIndex&&p.npcId===d.npcId&&d.t>=p.t&&d.t-p.t<=30000));
}
export function huntReading(c:HuntCheck){
 const ps=c.proofs??[];
 const met=c.target==='return'?!!c.fighters?.length&&c.fighters.every(n=>ps.some(p=>p.bot===n)):
 !!matchedPair(c);
 return {met,known:true,progress:c.target==='return'?`${new Set(ps.map(p=>p.bot)).size}/2 fighters observed back at Falador east bank`:`${c.target}: ${met?'paired encounter and target defeat observed (not shared kill-credit)':'prepare, agree assist and observe the same target defeat'}${!c.readyAt?'; previous preparation/stage pending':''}`};
}
export function huntOffer(ctx:Ctx):MenuMission|string {
 if(ctx.members.length!==4)return 'waiting for all four characters';
 return {id:0,by:'game',key:'challenge:guards-white-knight',template:'combat-challenge',category:'combat',title:'From Guards to White Knights',
 mission:'Equip and provision the party, practise paired combat against Falador guards, then defeat a white knight in a corroborated paired encounter and return to Falador east bank. Review results before harder monsters.',
 why:'Guard defeats are proven; white-knight success is not. Wren can prepare swordfish and Mike can help equip the fighters; characters choose their contributions and fighting pair.',
 work:[{owner:'wren',action:'cook',target:'swordfish',amount:40,note:'Prepare strong food from owned raw fish or a bounded fishing trip, then arrange confirmed deliveries to the fighting pair'},
 {owner:'mike',action:'smith',target:'adamant dagger',note:'Help everyone equip an affordable steel-or-better melee weapon from owned/buyable stock; craft only missing pieces, no level grind'},
 {owner:'trish',action:'invite_assist',target:'bram',note:'Suggested pair only: meet near Falador, equip weapons and carry strong food, invite for a short guard fight; partner must independently accept'},
 {owner:'bram',action:'assist',target:'trish',note:'Choose whether to accept after preparing; mapped Falador guards and white knights support multicombat. Keep own retreat rules'}],
 milestones:[{what:'The party holds 40 cooked swordfish for preparation',needs:'Catch/cook or use actual owned fish; confirmed delivery and carried readiness still required before combat',check:{kind:'stock',item:'swordfish',count:40},owner:'wren',next:{owner:'wren',action:'cook',target:'swordfish',note:'Food preparation, not a Cooking level target'}},
 {what:'Everyone equips a steel-or-better melee weapon',needs:'Use owned, affordable shop or craftable gear; preserve fashion and usable skill requirements',check:{kind:'wear',match:'^(steel|mithril|adamant|rune) (dagger|sword|scimitar|longsword|mace|battleaxe|axe|warhammer|2h sword)$',pieces:1},owner:'mike',next:{owner:'mike',action:'smith',target:'adamant dagger',note:'Make/trade only needed weapons'}},
 ...(['guard','white knight','return'] as const).map(target=>({what:target==='return'?'Both fighters return to Falador east bank':`Complete a prepared paired ${target} encounter with an observed target defeat`,needs:target==='return'?'Travel back after the knight stage and look or bank; then compare HP, food, duration and what to improve':`After the preceding stage, choose a short invite_assist + fight routine, partner accepts assist separately; Falador guard sites2960,3381 and3006,3322; white knights2959,3338. Preserve retreat and food rules.`,check:{kind:'hunt' as const,target,since:0},owner:target==='return'?'bram':'trish',next:{owner:'trish',action:target==='return'?'travel':'invite_assist',target:target==='return'?'Falador east bank':'bram',note:'Progress is observed, not declared from prose'}}))]};
}
/** A single complete snapshot latches preparation; stage cutoffs/proofs are durable. */
export function recordHuntGoal<T extends {milestones:{auto?:{check?:unknown};done:boolean}[]}>(goal:T,e:AgentEvent,run:string,prepared:boolean):T|undefined {
 if(!run||!Number.isFinite(e.t))return;
 const next=structuredClone(goal);let changed=false;
 const stages=next.milestones.flatMap(m=>(m.auto?.check as HuntCheck)?.kind==='hunt'?[m.auto!.check as HuntCheck]:[]);
 for(let i=0;i<stages.length;i++) {
  const c=stages[i];if(e.t<c.since||huntReading(c).met)continue;
  const previous=stages[i-1];
  if(!c.readyAt&&(i===0?prepared:previous&&huntReading(previous).met)) {
   c.readyAt=i===0?e.t:Math.max(...(previous.proofs??[]).map(p=>p.t));
   if(c.target==='return'){const pair=matchedPair(previous!);c.fighters=[pair?.leader,pair?.assistant].filter((n):n is string=>!!n);}
   changed=true;
  }
  if(!c.readyAt||e.t<c.readyAt||e.t<c.since)continue;
  const ps=c.proofs??=[];
  const add=(p:FieldProof)=>{if(ps.some(o=>JSON.stringify(o)===JSON.stringify(p)))return;ps.push(p);if(ps.length>16)ps.shift();changed=true;};
  if(c.target==='return') {
   const p=e.observedPosition as any;
   if(e.type==='order_end'&&e.outcome==='done'&&['look','bank_resources','travel'].includes(String(e.action))&&c.fighters?.includes(e.bot)&&typeof e.orderStartedAt==='number'&&e.orderStartedAt>=c.readyAt&&p?.plane===0&&p.ageMs>=0&&p.ageMs<=5000&&Math.hypot(p.x-3013,p.z-3355)<=8&&!ps.some(o=>o.bot===e.bot))add({kind:'trial',run,t:e.t,bot:e.bot,action:'return',target:'Falador east bank',x:p.x,z:p.z,plane:0});
   continue;
  }
  const pair=e.sharedEngagement as any;
  if(pair?.target?.toLowerCase()===c.target&&pair.at>=c.readyAt&&pair.at<=e.t&&e.t-pair.at<5000&&pair.leader!==pair.assistant&&pair.plane===0)
   add({kind:'trial',run,t:pair.at,bot:e.bot,action:'paired',target:c.target,x:pair.x,z:pair.z,plane:0,leader:pair.leader,assistant:pair.assistant,routineId:pair.leaderRoutine,npcIndex:pair.index,npcId:pair.id});
  if(e.type==='order_end'&&e.action==='fight'&&typeof e.orderStartedAt==='number'&&e.orderStartedAt>=c.readyAt&&Array.isArray(e.fightDefeats))for(const d of e.fightDefeats as any[]) {
   if(d.name?.toLowerCase()===c.target&&d.t>=e.orderStartedAt&&d.t<=e.t&&d.plane===0&&Math.hypot(d.x-2970,d.z-3355)<=100)
    add({kind:'trial',run,t:d.t,bot:e.bot,action:'defeat',target:c.target,x:d.x,z:d.z,plane:0,routineId:Number(e.routineId),npcIndex:d.index,npcId:d.id});
  }
 }
 return changed?next:undefined;
}
