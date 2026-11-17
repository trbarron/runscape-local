import {missionSelectionReason} from './opportunities';
import {huntOffer} from './hunt';
import {refreshMissionWork} from './missions';
import {test,expect} from 'bun:test';
import {recordHuntGoal,huntReading,type HuntCheck} from './hunt';
import {mergeFieldProgress} from './expedition';
const seed=()=>({key:'hunt',set:100,milestones:(['guard','white knight','return'] as const).map((target,i)=>({id:i+1,done:false,auto:{check:{kind:'hunt',target,since:100} as HuntCheck}}))});
const pair=(t:number,target='guard')=>({t,bot:'bram',type:'info' as const,sharedEngagement:{at:t,target,index:7,id:12,x:2960,z:3381,plane:0,leader:'trish',assistant:'bram',leaderRoutine:4}});
const defeated=(t:number,target='guard',index=7)=>({t,bot:'trish',type:'order_end' as const,action:'fight',orderStartedAt:t-10,routineId:4,fight:{unresolvedEnds:0},fightDefeats:[{t:t-1,name:target,index,id:12,x:2960,z:3381,plane:0}]});
test('preparation and stage boundaries prevent old fights/XP from unlocking the next target',()=>{
 let g=seed();expect(recordHuntGoal(g,pair(110),'run',false)).toBeUndefined();
 g=recordHuntGoal(g,{t:120,bot:'mike',type:'order_end'},'run',true)!;
 expect(g.milestones[0].auto.check.readyAt).toBe(120);
 expect(recordHuntGoal(g,defeated(125),'run',true)).toBeUndefined(); // order started before prep
 expect(recordHuntGoal(g,pair(140,'white knight'),'run',true)).toBeUndefined();
 g=recordHuntGoal(g,pair(140),'run',true)!;
 g=recordHuntGoal(g,defeated(160),'run',true)!;
 expect(huntReading(g.milestones[0].auto.check).met).toBe(true);
 expect(g.milestones[1].auto.check.readyAt).toBe(159);
});
test('paired and defeated NPC must match run, routine, index/id and a bounded encounter window',()=>{
 let g=recordHuntGoal(seed(),{t:120,bot:'mike',type:'order_end'},'run',true)!;
 g=recordHuntGoal(g,pair(140),'run',true)!;
 for(const [e,run] of [[defeated(160,'guard',8),'run'],[defeated(160),'other-run'],[{...defeated(160),routineId:5},'run'],[defeated(40000),'run']] as const){
  const next=recordHuntGoal(g,e,run,true)!;expect(huntReading(next.milestones[0].auto.check).met).toBe(false);
 }
 expect(recordHuntGoal(g,{...defeated(160),fightDefeats:undefined,xp:{Attack:100}},'run',true)).toBeUndefined();
});
test('knight proof alone is insufficient: both fighters must be observed back at the safe bank',()=>{
 let g=recordHuntGoal(seed(),{t:120,bot:'mike',type:'order_end'},'run',true)!;
 for(const [e] of [[pair(140)],[defeated(160)],[pair(180,'white knight')],[defeated(200,'white knight')]])g=recordHuntGoal(g,e,'run',true)!;
 const back=(bot:string)=>({t:230,bot,type:'order_end' as const,action:'look',outcome:'done',orderStartedAt:220,observedPosition:{x:3013,z:3355,plane:0,ageMs:0}});
 g=recordHuntGoal(g,back('trish'),'run',true)!;expect(huntReading(g.milestones[2].auto.check).met).toBe(false);
 g=recordHuntGoal(g,back('bram'),'run',true)!;expect(huntReading(g.milestones[2].auto.check).met).toBe(true);
 const restored=JSON.parse(JSON.stringify(g));const draft=seed();mergeFieldProgress(draft,restored);
 expect(huntReading(draft.milestones[2].auto.check).met).toBe(true);expect(draft.milestones[0].auto.check.readyAt).toBe(120);
 expect(recordHuntGoal(g,back('bram'),'run',true)).toBeUndefined();
});

test('later unresolved combat does not erase an already observed paired target defeat',()=>{
 let g=recordHuntGoal(seed(),{t:120,bot:'mike',type:'order_end'},'run',true)!;
 g=recordHuntGoal(g,pair(140),'run',true)!;
 g=recordHuntGoal(g,{...defeated(160),fight:{unresolvedEnds:1}},'run',true)!;
 expect(huntReading(g.milestones[0].auto.check).met).toBe(true);
});

test('refresh preserves the hunt weapon/preparation/assist charter instead of substituting armour forging',()=>{
 const ctx:any={members:Array.from({length:4},(_,i)=>({name:'member'+i})),size:4};
 const offer=huntOffer(ctx);if(typeof offer==='string')throw Error(offer);
 const goal:any={work:offer.work,milestones:offer.milestones.map(m=>({...m,done:false,auto:{check:m.check}}))};
 const before=JSON.stringify(goal.work);refreshMissionWork(goal,ctx);expect(JSON.stringify(goal.work)).toBe(before);
});

test('completed challenge waits for review instead of selecting another checklist or escalating automatically',()=>{
 const ctx:any={members:[1,2,3,4],size:4};const goal:any={mission:'challenge',milestones:[{done:true,auto:{check:{kind:'hunt'}}}]};
 expect(missionSelectionReason(goal,ctx)).toBeNull();expect(missionSelectionReason(goal,ctx,'user asks for next tier')).toBe('user asks for next tier');
});
