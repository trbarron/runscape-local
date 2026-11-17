import { expect, test } from 'bun:test';
import type { BotWorldState, NearbyNpc } from '../rs-sdk/sdk/types';
import type { Ctx } from './skills';
import { AssistRegistry, peerBlocker, sharedTarget, assistRoutineProblem, runAssist, runInvite, type AssistPeer, type AssistOps } from './assist';
const npc = (over:Partial<NearbyNpc>={}):NearbyNpc=>({kind:'npc',index:7,id:12,name:'Barbarian',x:3080,z:3415,tileX:3080,tileZ:3415,distance:1,
    hp:20,maxHp:20,healthPercent:100,reachable:true,optionsWithIndex:[{text:'Attack',opIndex:2}],...over} as NearbyNpc);
const state=(name:string,engaged=false):BotWorldState=>({tick:100,revision:100,inGame:true,
    player:{name,worldX:3080,worldZ:3415,level:0,hp:50,maxHp:50,isDead:false,combat:{inCombat:engaged,targetType:engaged?'npc':'none',targetIndex:engaged?7:-1}},
    nearbyNpcs:[npc()],combatEvents:[],skills:[],inventory:[],equipment:[] } as unknown as BotWorldState);
const step=(action:string,type='minutes',value=10)=>({action,until:{type,value}});
function harness() {
    let clock=100_000;
    const registry=new AssistRegistry(()=>clock);
    const a=state('wren'), l=state('trish',true);
    const peers:Record<string,AssistPeer>={wren:{state:a,receivedAt:clock,connected:true,action:'assist',routineId:2,step:0},
        trish:{state:l,receivedAt:clock,connected:true,action:'fight',routineId:1,step:1}};
    const pair=registry.offer('trish','wren',1,1);if(typeof pair==='string')throw Error(pair);
    const signal=new AbortController();
    const calls:string[]=[],notes:string[]=[];
    let onTick=()=>{};
    const advance=(ms=600)=>{clock+=ms;a.tick++;l.tick++;a.revision!++;l.revision!++;Object.values(peers).forEach(p=>p.receivedAt=clock);onTick();};
    const ctx={name:'wren',deadline:clock+3000,signal:signal.signal,notes,
        sdk:{getState:()=>a,waitForTicks:async()=>advance(),waitForCondition:async()=>advance(),
            sendInteractNpc:async(index:number)=>{calls.push(`attack:${index}`);a.player!.combat={...a.player!.combat,inCombat:true,targetIndex:index,targetType:'npc'};return {success:true,message:'sent'};}},
        bot:{walkTo:async(x:number,z:number)=>{calls.push('walk');a.player!.worldX=x;a.player!.worldZ=z;advance();return {success:true,message:'walked'};}}
    } as unknown as Ctx;
    const ops:AssistOps={registry,peers:n=>peers[n],now:()=>clock,
        tactics:{eat_below:70,retreat_below:60,finish_if_enemy_below:0,target:'nearest',style:'defensive',loot:'none'},
        eat:async()=>{calls.push('eat');},flee:async()=>{calls.push('flee');a.player!.combat.inCombat=false;},style:async()=>{calls.push('style');},
        announce:t=>calls.push(t),invite:()=>true};
    return {registry,pair,a,l,peers,ctx,ops,calls,notes,signal,advance,setTick:(fn:()=>void)=>{onTick=fn;}};
}

test('registry requires addressed consent, disjoint roles, expiry and id-scoped cleanup',()=>{
    let now=1000;const r=new AssistRegistry(()=>now);
    expect(r.offer('a','a',1,1)).toBe('choose another character');
    const p=r.offer('a','b',1,1);if(typeof p==='string')throw Error(p);
    expect(typeof r.accept('c','a')).toBe('string');
    expect(p.phase).toBe('invited');
    expect(typeof r.offer('b','c',1,1)).toBe('string');
    expect(r.accept('b','a')).toBe(p);expect(p.phase).toBe('accepted');
    expect(r.accept('b','a')).toBe(p);
    r.end(p.id);const q=r.offer('a','b',2,1);if(typeof q==='string')throw Error(q);
    r.end(p.id);expect(r.get('a')).toBe(q);
    r.cancelMember('b',true);expect(r.get('a')).toBe(q); // invitation survives recipient's old routine interrupt
    now+=15*60_000;expect(r.get('a')).toBeUndefined();
});
test('preflight bounds cooperative routine shape and duration',()=>{
    expect(assistRoutineProblem([step('invite_assist','minutes',1),step('fight')],false)).toBeNull();
    expect(assistRoutineProblem([step('assist')],false)).toBeNull();
    for(const [steps,repeat] of [ [[step('assist')],true], [[step('invite_assist','minutes',1)],false],
        [[step('assist','skill_level',40)],false],[[step('assist','minutes',16)],false],[[step('assist'),step('mine')],false],
        [[step('invite_assist','minutes',2),step('fight')],false] ] as const)
        expect(assistRoutineProblem([...steps],repeat)).not.toBeNull();
});
test('freshness, surface, death, distance and disconnect fail closed',()=>{
    const h=harness();const a=h.peers.wren,l=h.peers.trish;
    expect(peerBlocker(a,l,100_000)).toBeNull();
    l.receivedAt=90000;expect(peerBlocker(a,l,100000)).toContain('stale');l.receivedAt=100000;
    h.l.tick=90;expect(peerBlocker(a,l,100000)).toContain('stale');h.l.tick=100;
    h.l.player!.level=1;expect(peerBlocker(a,l,100000)).toContain('ground floor');h.l.player!.level=0;
    h.l.player!.worldX+=65;expect(peerBlocker(a,l,100000)).toContain('64');h.l.player!.worldX-=65;
    h.l.player!.hp=0;expect(peerBlocker(a,l,100000)).toContain('alive');h.l.player!.hp=50;
    l.connected=false;expect(peerBlocker(a,l,100000)).toContain('disconnected');
});
test('shared targeting never guesses by name, reuses a different config, player or unknown tile',()=>{
    const h=harness();expect(sharedTarget(h.a,h.l)?.index).toBe(7);
    for(const over of [{id:99},{index:8},{tileX:undefined},{tileZ:3500},{reachable:undefined},{hp:0}]) {
        h.a.nearbyNpcs=[npc(over)];expect(sharedTarget(h.a,h.l)).toBeUndefined();
    }
    h.a.nearbyNpcs=[npc()];h.l.player!.combat.targetType='player';expect(sharedTarget(h.a,h.l)).toBeUndefined();
});
test('assist joins only the exact target; reports simultaneous engagement without attributing shared hitsplats or kills',async()=>{
    const h=harness();let i=0;h.setTick(()=>{if(++i>=2) h.a.combatEvents=[{tick:102,observationId:102,type:'damage_dealt',sourceType:'player',sourceIndex:1,targetType:'npc',targetIndex:7,damage:3}];});
    expect(await runAssist(h.ctx,'trish',h.ops)).toBeUndefined();
    expect(h.calls.filter(c=>c==='attack:7')).toHaveLength(1);
    expect(h.notes.join()).toContain('1 confirmed shared engagements');
    expect(h.notes.join()).toContain('no shared kills inferred');
    expect(h.registry.get('wren')).toBeDefined(); // intermediate pass keeps agreement
});
test('single-combat and missing consent never send an attack',async()=>{
    for(const noConsent of [false,true]) {
        const h=harness();
        if(noConsent)h.registry.end(h.pair.id);
        else {h.a.nearbyNpcs=[npc({tileX:3255,tileZ:3270})];h.l.nearbyNpcs=[npc({tileX:3255,tileZ:3270})];}
        expect(await runAssist(h.ctx,'trish',h.ops)).toContain(noConsent?'invitation':'multicombat');
        expect(h.calls.some(c=>c.startsWith('attack:'))).toBe(false);
    }
});
test('own retreat threshold above 35 percent is honored after an eating attempt',async()=>{
    const h=harness();h.a.player!.hp=25;h.a.player!.combat={...h.l.player!.combat};
    expect(await runAssist(h.ctx,'trish',h.ops)).toContain('retreat');
    expect(h.calls).toContain('eat');expect(h.calls).toContain('flee');
    expect(h.calls.some(c=>c.startsWith('attack:'))).toBe(false);
});
test('target change during movement cannot dispatch the captured NPC',async()=>{
    const h=harness();h.a.nearbyNpcs=[npc({distance:4})];
    h.ctx.bot.walkTo=async()=>{h.peers.trish.action='mine';h.advance();return {success:true,message:'walked'};};
    expect(await runAssist(h.ctx,'trish',h.ops)).toContain('changed');
    expect(h.calls.some(c=>c.startsWith('attack:'))).toBe(false);
});
test('leader target change while fighting disengages rather than switching targets',async()=>{
    const h=harness();h.a.player!.combat={...h.l.player!.combat};h.l.player!.combat.targetIndex=8;
    expect(await runAssist(h.ctx,'trish',h.ops)).toContain('changed target');expect(h.calls).toContain('flee');
});
test('terminal duration disengages; intermediate pass rollover does not',async()=>{
    const h=harness();h.ctx.finalPass=true;
    await runAssist(h.ctx,'trish',h.ops);
    expect(h.calls).toContain('flee');expect(h.registry.get('wren')).toBeUndefined();
});
test('invite requires voluntary acceptance and readiness, otherwise expires within 60 seconds',async()=>{
    const h=harness();h.registry.end(h.pair.id);h.ctx.name='trish';h.ctx.deadline=200000;
    h.ctx.sdk.getState=()=>h.l;h.peers.trish.action='invite_assist';h.peers.trish.step=0;
    expect(await runInvite(h.ctx,'wren',h.ops)).toContain('timed out');
    expect(h.registry.get('trish')).toBeUndefined();
    expect(h.calls.some(c=>c.startsWith('attack:'))).toBe(false);
});
test('invite completes only after assistant accepts and rendezvous is ready',async()=>{
    const h=harness();h.registry.end(h.pair.id);h.ctx.name='trish';h.ctx.deadline=200000;
    h.ctx.sdk.getState=()=>h.l;h.l.player!.combat.inCombat=false;h.peers.trish.action='invite_assist';h.peers.trish.step=0;
    h.ops.invite=()=>{const p=h.registry.accept('wren','trish');if(typeof p!=='string'){p.readyAt=100000;p.phase='ready';}return true;};
    expect(await runInvite(h.ctx,'wren',h.ops)).toBeUndefined();expect(h.registry.get('trish')?.phase).toBe('ready');
});
test('external cancellation clears agreement without issuing a new attack or recovery walk',async()=>{
    const h=harness();h.signal.abort();await runAssist(h.ctx,'trish',h.ops);
    expect(h.calls.some(c=>c.startsWith('attack:')||c==='flee')).toBe(false);
    expect(h.registry.get('wren')).toBeUndefined();
});

test('continuous engagement is not counted twice across executor pass boundaries',async()=>{
    const h=harness();await runAssist(h.ctx,'trish',h.ops);
    h.ctx.deadline+=3000;await runAssist(h.ctx,'trish',h.ops);
    expect(h.notes).toHaveLength(2);
    expect(h.notes[1]).toContain('1 confirmed shared engagements');
    expect(h.calls.filter(c=>c.includes('confirmed shared engagement'))).toHaveLength(1);
});
test('a pending movement is cancelled when leader changes task, without a stale attack',async()=>{
    const h=harness();h.a.nearbyNpcs=[npc({distance:4})];
    h.ctx.bot.walkTo=async()=>new Promise(()=>{});
    const timer=setTimeout(()=>{h.peers.trish.action='mine';},20);
    try {expect(await runAssist(h.ctx,'trish',h.ops)).toContain('changed');}
    finally {clearTimeout(timer);}
    expect(h.calls.some(c=>c.startsWith('attack:'))).toBe(false);
});

test('observation failure while fighting cancels consent and attempts independent disengagement',async()=>{
    const h=harness();h.a.player!.combat={...h.l.player!.combat};
    h.ctx.sdk.waitForTicks=async()=>{throw Error('no publications');};
    expect(await runAssist(h.ctx,'trish',h.ops)).toContain('no publications');
    expect(h.calls).toContain('flee');expect(h.registry.get('wren')).toBeUndefined();
});
test('rendezvous waits for a current solo fight to finish before announcing readiness',async()=>{
    const h=harness();h.peers.trish.action='invite_assist';h.peers.trish.step=0;
    h.a.player!.combat={...h.l.player!.combat};h.ctx.deadline+=3000;
    let ticks=0;
    h.setTick(()=>{ticks++;if(ticks===1){expect(h.pair.readyAt).toBeUndefined();h.a.player!.combat.inCombat=false;}
        if(ticks===3){h.peers.trish.action='fight';h.peers.trish.step=1;}});
    await runAssist(h.ctx,'trish',h.ops);
    expect(h.pair.readyAt).toBeDefined();expect(h.calls.filter(c=>c==='attack:7')).toHaveLength(1);
});

test('wilderness positions and exact NPCs are permitted while normal assist safeguards remain',()=>{
    const h=harness();h.a.player!.worldZ=3532;h.l.player!.worldZ=3532;
    h.a.nearbyNpcs=[npc({tileZ:3532})];h.l.nearbyNpcs=[npc({tileZ:3532})];
    expect(peerBlocker(h.peers.wren,h.peers.trish,100000)).toBeNull();
    expect(sharedTarget(h.a,h.l)?.index).toBe(7);
    h.l.player!.combat.targetType='player';
    expect(sharedTarget(h.a,h.l)).toBeUndefined();
});

test('assist can actually dispatch to a shared NPC in a mapped wilderness zone',async()=>{
    const h=harness();
    for(const s of [h.a,h.l]) {
        s.player!.worldX=3227;s.player!.worldZ=3533;
        s.nearbyNpcs=[npc({tileX:3227,tileZ:3533,x:3227,z:3533})];
    }
    expect(await runAssist(h.ctx,'trish',h.ops)).toBeUndefined();
    expect(h.calls).toContain('attack:7');
    expect(h.notes.join()).toContain('1 confirmed shared engagements');
});

test('validated assist engagement publishes structured exact target and leader routine identity',async()=>{
 const h=harness();const events:any[]=[];h.ops.engagement=e=>events.push(e);
 await runAssist(h.ctx,'trish',h.ops);
 expect(events[0]).toMatchObject({target:'Barbarian',index:7,id:12,x:3080,z:3415,plane:0,leader:'trish',assistant:'wren',leaderRoutine:1});
});
