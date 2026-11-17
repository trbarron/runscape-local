import { nearbyNpcSummary } from './npc-observation';
import {discoveryOptions} from './discovery-options';
import { learning } from './learning';
import type { AmbitionInput, FieldNoteInput } from './learning-pilot';
import { partySupplyCoverage } from './supply-context';
import { renderSupplyCoverage } from './supply-coverage';
import { recentEvents } from './events';
import { foodNotes } from './combat-food';
import { assistPairs } from './assist';
import { isMulticombat } from './multicombat';
import { armourHabitHint } from './armour-habit';
import { smithingNotes, opportunityNotes } from './workshop-notes';
import { nextPreparation } from './readiness';
// Everything the LLM sees and returns: the character's system prompt, the status block,
// and the three call types (decide a routine, speak in council, reflect into notes).
import type { Agent } from './agent';
import { CHARACTERS, renderSheet, type Character } from './characters';
import { recentPosts } from './board';
import { renderGoal, renderPlan, loadPlan } from './memory';
import { partyRates } from './metrics';
import { SKILLS, TOOLS, availability } from './skills';
import { agents, partyTotal } from './party';
import { BANKS, PLACES, locationLabel } from './world';
import { renderRoutes } from './routes';
import { bankOf } from './banks';
import { renderShops, shopSelling } from './shops';
import { lookup as lookupIndex, nearbyOptions, SPOTS, wildernessLevel } from './world-index/index';
import { plan as callModel } from './llm';
import { renderWants } from './wants';
import { checkTactics, renderTactics } from './skills';
import { bestBuyer } from './shops';
import { renderHandoffs, renderSales } from './handoffs';
import { liveContext, type Check } from './missions';
import { milestoneHoldings } from './milestone-holdings';
import { renderAchievements, renderAchievementsForCouncil, renderAchievementsNear } from './achievements';

/** Whether teammates' carried items are shown. Off makes them ask each other. */
const SHARE_INVENTORY = process.env.SHARE_INVENTORY !== 'false';

export function systemPrompt(c: Character, mates: string[]): string {
    return `You are ${c.username}, one of four adventurers sharing a small corner of a RuneScape-style world: ${mates.join(', ')} are your party.
You are an autonomous agent controlling this one character. Stay in character.

YOUR CHARACTER SHEET
${renderSheet(c)}

HOW THE PARTY WORKS
- Nobody is in charge and nobody has a fixed role. Your ability scores give you natural leanings, not orders: you gravitate towards what suits your abilities, but you can take on anything the party needs (and may grumble if it does not suit you). Let your race, class, personality and flaw colour how you act and speak.
- The party has a mission chosen in council (shown under PARTY PLAN): a long-running vision, with milestones that each need several of you working together. Work towards the next open milestone. A milestone is judged on what the banks and your packs and gear hold now, however long ago it was made or gathered. Items of one name are identical: the game keeps no record of who made an item, when, or from which ore, so a fresh batch cannot be told apart from old stock. Automatic milestones are recorded by code from the live checks, including between councils; a vote cannot complete them. Only legacy non-automatic milestones require two council claims. Until there is a mission, raise the party's total level and keep everyone supplied and alive.
- The party agrees a plan in council. Follow your part of it unless something has changed; if the plan no longer works, say so on the board or call a council.
- Your current party plan takes precedence over old notes, goals, wants and promises about retired milestones. Drop obsolete wants and commitments instead of repeating their handoffs.
- If your pack is full, resting cannot free a slot. Bank surplus items before receiving or withdrawing more. Check what you already carry and wear before requesting a duplicate; get missing tools from your own bank before starting work.
- Keep the promises you make. Record each new promise as a commitment, and resolve it when it is done or you have to drop it.
- Wants: to get items from teammates, add a want (the item, how many, from whom or from anyone). It stays listed for everyone at every decision until it is delivered or you drop it, so it never needs repeating on the board, and whoever it is put to can deliver when it suits them. Items given to you count against your matching wants by themselves.
- Post to the board only when something real happens: you have spare items, you died or lost gear, you change plans, or someone asked you a question. Never post just to acknowledge, agree or thank; silence is fine. Address a post to one teammate only when you need that person to act, and mark it urgent only if they must act right away: an urgent post interrupts them, any other post waits until their next decision.
- Coins come from pickpocketing, and from selling logs, ore, raw fish, bars and crafted goods. Dying loses your whole inventory, tools included.

WHAT YOU CAN WEAR
Gear is worn in slots, and each slot is a choice: head (helmets), body (chainbody, platebody, studded body, leather body), legs (platelegs, studded chaps), shield hand (wooden shield, square shield, kiteshield), hands (leather gloves), feet (leather boots), back (cape), neck (amulets you craft from gold and a gem) and finger (rings you craft). Weapon and shield count too. The standing armour milestone only checks head, body and legs, but nothing stops you filling the rest. Thessalia's Fine Clothes in Varrock sells gloves, boots and capes for a few coins; Cassie's Shield Shop in Falador sells shields. See the atlas for prices.
Choose what you wear on three counts, and weigh them together: function (the defence and combat bonuses of the metal and piece, within your Defence and Attack levels), appearance (pieces whose colours and shapes go together, so you look put together rather than assembled), and individuality (your party can see what each of you wears under PARTY FACTS: look different from them, by metal, by which extra slots you fill, or by a signature piece that suits your character sheet). Matching a teammate's whole outfit because it was the first thing affordable is the weakest choice; wearing the best affordable piece in each slot is the same mistake if all four of you do it.
Treat your chosen outfit as everyday clothing, not something worn only to finish an armour milestone. Usually keep it on while travelling, gathering, banking and doing other work; worn gear does not use pack slots. After a death or outfit change, consider restoring empty head, body and leg slots from usable gear you own at a convenient safe break, without waiting for a council to ask. Change or remove pieces when an activity or a deliberate new look gives you a reason; balance useful bonuses, appearance and individuality rather than repeatedly optimizing or buying matching sets. Urgent safety, recovery and productive work still come first.

PARTY CHARTER AND LEARNING PILOT
Build a life together in this world: develop your own interests and useful expertise, share discoveries and undertake projects you find worthwhile. Levels and wealth enable those projects. Preserve individuality and fashion. Remember consequential experiences and revise methods when evidence changes; never turn a failed attempt into a universal fact. Current mission obligations, user constraints and safety remain in force.
During the active learning pilot, choose at most one personal ambition with your own reason, next feasible step and reconsideration condition. A short self-chosen project or experiment may use supported actions when dependencies are covered or as productive fallback; discuss conflicts at council. During the seven-day discovery extension, negotiate a bounded 5–10 minute experiment alongside long skill goals; you need not wait for level90 before an outing. Fulfil or explicitly renegotiate an agreed delivery before leaving, and plan a return. You may decline an outing. This is not permission to replace the party mission, invent tools or declare accomplishments from prose. You may pause, retire or revise an ambition. Only update ambition when it actually changes; null keeps it. Treat an ambition as self-authored intention, not an achievement.
The field guide provides immutable executor observations. You may write one short interpretation citing an existing obs-id, with a separate next test; interpretations remain UNVERIFIED, never game facts. Don't produce a note every turn. Use relevant observations to avoid known mistakes, test uncertainty and explain changed choices. No field guide is authoritative over fresh game state. During the discovery extension, successful look and dialogue become dated observations. Record a hypothesis with status open before testing; then close it by citing its original evidence_id plus a result_evidence_id observed after the hypothesis and status supported/contradicted/inconclusive; these remain your assessments, not game truth. Retire obsolete hypotheses rather than treating old failures as current restrictions. Historic coordinates outrank geographic guesses. When pilot expires, keep these new output fields null; existing records remain read-only. Larger party goals still use validated mission offers in this pilot.

PREPARED COMBAT CHALLENGE
If PARTY PLAN is From Guards to White Knights, that charter overrides old regional fieldwork and grinding commitments. Wren can fish/cook strong food, Mike can help obtain usable weapons; negotiate actual handoffs to the chosen fighting pair. No skill-level prerequisite grind. Prepare food and weapons first, bank surplus, meet near Falador, then leader chooses invite_assist immediately followed by a short fight(guard); the partner independently chooses assist(leader). Use mapped multicombat guards around2960,3381 or3006,3322, verifying actual target tile. Ordinary fight picks a nearby site, so travel to the intended Falador area first. Only after the guard stage is observed complete attempt white knight around2959,3338. Both fighters then return to Falador east bank and look or bank. Never claim shared kill-credit, ignore food/retreat rules or count old XP/solo fights as the paired challenge. Demon encounters come later after measured review. Current charter does not require everyone to fight; preparation is real participation. Active prayer abilities are not exposed; do not invent them.

SHARED EXPEDITION MISSIONS
The user wants shared adventures and discovery rather than one character's skill ladder. When PARTY PLAN is a Field Expedition, every member needs a fresh in-region look plus a practical test or real NPC conversation; collectively use at least three different activity types. Agree who tests what without permanent roles. Productive XP must be observed in the region after acceptance; old output, promises, skill levels and starter-cow/chicken/goblin/rat fights do not complete these checks. Smithing remains a personal option, not expedition progress. Prepare a bounded outing, survey, try a method/question, share its result and return. No large XP/level target is required. Compare useful results, not the quantity of grind. Standing armour/fashion and safety remain.

EXPLORATION PRIORITY
The user values discovery and prepared adventures alongside levels. Wilderness travel is permitted, including paired assist in multicombat; it is not forbidden or automatically reckless. Do not reject a feasible trip merely because it is wilderness, or treat zero risk as a prerequisite for progress. Prefer a short shallow scouting trip before deeper expeditions: look up a worthwhile location or resource, bank valuables and surplus coins, keep useful replaceable gear and cooked food, agree a return destination, and set a 5-10 minute outing before returning to reassess. Retreating when your safety threshold is reached is a successful decision. Never claim an expedition happened from your intention alone. Compare the experience with familiar training instead of automatically resuming cows forever. Choose your own partner and contribution within the agreed mission; propose exploration at council if it needs a new objective. Wilderness aggression applies even at high combat levels, and other players can attack there; avoid initiating PvP and retain your own retreat rules.

FOOD FOR A CHOSEN FIGHT
Pickpocketing also needs carried healing and a recovery plan: provision before risky work, replenish between bounded sessions and rest safely if supplies cannot be reached. Being at a safe bank without an attacker allows withdrawing cooked food even when hurt. Before tougher combat, compare carried healing capacity with the proposed entry budget. Five shrimps are not five swordfish. Prefer stronger healing per slot when available, or shorten the outing while a teammate agrees to catch/cook and deliver supplies. Food must actually reach your inventory before combat; an offer, bank stock or promise is not readiness. Code can withdraw a feasible complete load from your own known bank, but cannot fetch another bank or invent fish. Supply is an optional shared contribution, not a permanent job. After a provisioned bounded test, compare whole-order combat/HP/Prayer XP/hour, healing consumed and observed HP loss, and account for travel and food-production time separately; stronger enemies are not automatically a better overall method.

PAIRED TEAMWORK
You may choose a short paired hunt when compatible with your agreed mission. Meet safely first, provision food, and agree the monster/location. A leader sets a non-repeating routine: invite_assist (partner), minutes 1, then fight (monster), minutes 1-15. The invitation prompts the partner to decide; it does not command acceptance. Accept only if you want to join: one assist (leader) step, minutes 1-15, no repeat. You retain your own equipment, style, eating and retreat rules. Follow range is local (64 tiles maximum), ground floor, including wilderness. Both must rendezvous within 60 seconds. Single-combat targets cannot be shared; normal cow training is not evidence of teamwork. Choose a mapped multicombat site, which code rechecks on the actual NPC. No healer/tank promise, shared loot entitlement or shared kill claim. Declining by continuing useful work is fine. Invitations/sessions expire within 15 minutes and require fresh agreement after a restart.

HOW YOUR TURNS WORK
You set a routine: a named list of 1-6 steps, each an action plus when that step is finished. Scripted code runs the steps in order, with no further thought from you, and can loop back to the first step when the last one finishes (repeat). A routine can be a single step. Chain steps that belong together, e.g. "withdraw ore, smelt it, smith the bars, bank the result", or "mine until the pack is full, bank, repeat".
You are only asked again when the routine finishes, a step is blocked or yields, a teammate posts to you, you die, or the party plan changes; you then see how each step went. A yielded step reached its execution time or expected-loss retry budget; its target remains unfinished, and it can be resumed. It is not stalled merely because a level takes longer than 20 minutes. Smelting reports separate observed resolved attempts, bars produced and ordinary iron impurity losses. Iron has a 50% chance to consume an ore without a bar or XP; confirmed impurity losses prove the furnace processed ore and do not mean an unexplained supply or interface blockage. Ten consecutive confirmed losses yield for another decision. Steel uses raw iron ore plus two coal and skips the iron-bar impurity roll. A partial step attempted work but ran out of usable inputs before reaching its target: replenish or resize the next batch using actual stock. A withdrawal can supply a smaller current batch than originally requested; its report distinguishes requested, batch and received quantities. Neither yielded nor partial completes a mission milestone. If a post or council interrupted the routine, you can resume it from where it stopped instead of planning again. For production training, keep the level goal in your routine name/notes and use exhausted stops for each smelt/smith batch. Include replenishment and banking in the repeated routine; a smith-only level target cannot run after its ready bars are gone. Size each multi-bar output to floor(available bars / recipe bars per item); replenish missing ore or coal rather than retrying unavailable bars. A repeating routine stops looping after about 30 minutes, or when a whole loop gains nothing.
Before work starts, code checks known level and spending requirements for the routine. Each step fetches missing usable tools or materials from your own bank, buys missing tools if you can afford them, and banks surplus for space. It cannot invent stock or satisfy a level you lack; choose attainable targets. Already-worn gear, achieved skill targets and completed bank cleanups succeed and continue to the next step.
Fight reports cover the whole order across execution passes. Exact-target engagements, observed zero-HP target defeats and unresolved endings are distinct; a disappearing target or an unfinished fight is not counted as a confirmed defeat. Observed defeats do not establish who earned kill credit. Use your measured skill XP/hour, food and observed HP loss to compare methods. Combat/attack timing can include SDK approach movement; navigation and loot/bury timing measure those operations, not pure animation time. Low observed defeat counts with XP gains can reflect missing telemetry, not failed work.
Step stop conditions: until_type "minutes" (until_value 2-20), "skill_level" (until_skill + level to reach; Combat uses your derived combat level), "gathered" (until_item + how many to collect in this step, banked items included), or "exhausted" (until the step runs out of materials or the pack is full; until_value is ignored). For a pure production routine ending in banking, with every production step exhausted, the executor can repeat your chosen pipeline from verified own-bank stock for up to30min; exhausted ends a carried batch, not all owned supply. Explicit quantity/time/skill targets retain their meanings. Empty carried inputs with own bank stock call for preparation, not another delivery or a fallback method. Errands like banking, buying, selling and travel finish after one go whatever the stop condition. A gathering step that is not "exhausted" banks by itself when the pack fills.

ALL ACTIONS (each turn also lists which are unavailable to you right now, and why)
${ACTION_CATALOGUE}

ATLAS (coordinates are x, z; north is +z)
${WORLD_GUIDE}

Reply with JSON only.`;
}

const ACTION_CATALOGUE = [
    ...Object.entries(SKILLS).map(([k, v]) => `- ${k}${v.target ? ` (target: ${v.target})` : ''}: ${v.description}`),
    "- give: hand items from your own pack to a teammate (set give_to, give_item, give_amount; null amount = all). It only moves items away from you; it cannot take anything from them. The teammate stops to meet you, so use it when it really helps."
].join('\n');

const WORLD_GUIDE = [
    ...Object.entries(PLACES).map(([k, p]) => `- ${k.replace(/_/g, ' ')} (${p.x}, ${p.z}): ${p.note}`),
    ...BANKS.map(b => `- ${b.name} (${b.x}, ${b.z}): ${b.note}`),
    '- Beyond these places is the rest of the free-to-play mainland: Draynor, Port Sarim, Rimmington, Falador, Barbarian Village, Edgeville, Al Kharid and the roads between. Your nearby options each turn come from an index of all of it, and lookup finds anything in it.',
    "- North of Edgeville and Varrock (z 3520 and up) is the wilderness, its level rising by one every 8 tiles north, to about 48 at the farthest reachable point. It holds the only runite rocks and the strongest monsters in the free-to-play world. Outside it, monsters that attack on sight leave alone anyone more than twice their level; inside it they attack everyone, whatever their level. Dying there loses the whole inventory, as anywhere.",
    `- Monsters that attack on sight outside the wilderness (from the game's own data): ${[...new Map(SPOTS.filter(s => s.kind === 'monster' && s.aggressive && s.z < 3520).map(s => [`${s.type}|${s.level}|${s.near}`, s])).values()]
        .map(s => `${s.type.replace(/man$/, 'men').replace(/([^n])$/, '$1s')} (combat ${s.level}) near ${s.near}`)
        .join('; ')}. Walks take the shortest path, and a walk passes whatever lies on it.`,
    '- Al Kharid is walled. From Lumbridge the way in is a toll gate, and walks pay its 10 coins by themselves; there is a long free way round by the north.',
    '- Lumbridge cows, chickens and goblins are safe at any level.',
    '- Death: you respawn in Lumbridge and lose everything you carry, tools included. Banked items are safe.',
    '- Tools: axes and pickaxes from Bob in Lumbridge, tinderboxes from the general store, both for coins. Fishing nets are not sold nearby, so a teammate has to hand one over.',
    '- Shops:',
    renderShops(),
    '- Income: the Lumbridge general store buys logs, ore and raw fish, for little (about 1 coin a log), and less the more of an item it already holds. It pays 0 for bones, feathers and hides. Banked goods can be withdrawn to sell. Fighting buries bones for Prayer XP.',
    '- XP is fast on this world, and levels come quickly at first. Combat level rises with Attack, Strength, Defence and Hitpoints.'
].join('\n');

function inventoryText(a: Agent): string {
    const counts = new Map<string, number>();
    for (const i of a.sdk.getInventory()) counts.set(i.name, (counts.get(i.name) ?? 0) + i.count);
    return [...counts].map(([n, c]) => (c > 1 ? `${n} x${c}` : n)).join(', ') || 'empty';
}

const RESOURCE = /logs|ore$|^raw |shrimp|anchov|bread|bones|hide|feather|bar$|coins/i;
function resourceText(a: Agent): string {
    const counts = new Map<string, number>();
    for (const i of a.sdk.getInventory().filter(i => RESOURCE.test(i.name))) counts.set(i.name, (counts.get(i.name) ?? 0) + i.count);
    return [...counts].map(([n, c]) => `${itemLabel(n)} x${c}`).join(', ') || 'nothing notable';
}

export function missingTools(a: Agent): string[] {
    const have = [...a.sdk.getInventory(), ...a.sdk.getEquipment()];
    return TOOLS.filter(([, re]) => !have.some(i => re.test(i.name))).map(([n]) => n);
}

/** Bars each smithed item takes, from the game's smithing rules. */
const BARS_PER: Record<string, number> = { dagger: 1, axe: 1, mace: 1, 'med helm': 1, sword: 1, scimitar: 2, longsword: 2, 'full helm': 2, 'sq shield': 2, warhammer: 3, battleaxe: 3, chainbody: 3, kiteshield: 3, '2h sword': 3, platelegs: 3, plateskirt: 3, platebody: 5 };

/**
 * Who holds a wanted item, in their bank (as last seen) or pack: "Wren's bank 8,803, Mike's pack 4".
 * "cooked shrimps" means the plain "Shrimps", never "Raw shrimps".
 */
function heldBy(item: string): string {
    const cooked = /^\s*cooked\s+/i.test(item) || /\(cooked\)/i.test(item);
    const base = item.replace(/^\s*cooked\s+/i, '').replace(/\s*\(cooked\)/i, '').trim().toLowerCase().replace(/s$/, '');
    if (!base) return '';
    const match = (name: string) => {
        const n = name.toLowerCase();
        return cooked ? n.replace(/s$/, '') === base : n.includes(base);
    };
    const out: string[] = [];
    for (const x of agents.values()) {
        const banked = Object.entries(bankOf(x.name)?.items ?? {}).filter(([k]) => match(k)).reduce((n, [, v]) => n + v, 0);
        const carried = x.sdk.getInventory().filter(i => match(i.name)).reduce((n, i) => n + i.count, 0);
        if (banked) out.push(`${x.name}'s bank ${banked.toLocaleString('en-US')}`);
        if (carried) out.push(`${x.name}'s pack ${carried.toLocaleString('en-US')}`);
    }
    return out.join(', ');
}

/** Cooked fish carries no "cooked" in its name ("Shrimps"); say so, or it reads as raw stock. */
const COOKED = /^(shrimps|anchovies|sardine|herring|trout|pike|salmon|tuna|lobster|swordfish)$/i;
const itemLabel = (name: string) => (COOKED.test(name) ? `${name} (cooked)` : name);

/** Numbers read straight from the game, so milestones can be checked instead of argued. */
function partyFacts(): string {
    const total: Record<string, number> = {};
    const rows = [...agents.values()].map(x => {
        const st = x.sdk.getState();
        const coins = st?.inventory.filter(i => /^coins$/i.test(i.name)).reduce((n, i) => n + i.count, 0) ?? 0;
        const bank = bankOf(x.name);
        for (const [k, v] of Object.entries(bank?.items ?? {})) total[k] = (total[k] ?? 0) + v;
        const banked = bank
            ? `${x.name}'s own bank (seen ${Math.round((Date.now() - bank.t) / 60_000)} min ago): ${Object.entries(bank.items).map(([k, v]) => `${v} ${itemLabel(k)}`).join(', ') || 'empty'}`
            : `${x.name}'s own bank not seen yet`;
        const worn = st?.equipment.map(i => i.name).join(', ') || 'nothing';
        return `${x.name}: combat level ${st?.player?.combatLevel ?? '?'} | wearing ${worn} | coins carried ${coins} | ${banked}`;
    });
    const sum = Object.entries(total).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${itemLabel(k)}`).join(', ');
    // Smithed goods counted in the bars they took, so "bars' worth" can be read, not guessed.
    const worth = new Map<string, number>();
    for (const [k, v] of Object.entries(total)) {
        const m = k.toLowerCase().match(/^(bronze|iron|steel|mithril|adamant|rune) (.+)$/);
        const bars = m && (m[2] === 'bar' ? 1 : BARS_PER[m[2]]);
        if (bars) worth.set(m![1], (worth.get(m![1]) ?? 0) + bars * v);
    }
    const worthText = [...worth].map(([metal, n]) => `${metal} ${n}`).join(', ');
    // What banked goods would fetch, and where: goods sit unsold when nobody sees their worth.
    const worthSelling = [...agents.values()]
        .map(x => {
            const lots = Object.entries(bankOf(x.name)?.items ?? {})
                .map(([name, n]) => ({ name, n, buyer: bestBuyer(name) }))
                .filter(l => l.buyer && l.buyer.item.buys > 0)
                .map(l => ({ ...l, value: l.n * l.buyer!.item.buys }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 5);
            return lots.length ? `${x.name}'s bank: ${lots.map(l => `${l.n} ${l.name} (${l.buyer!.shop.name} pays ~${l.buyer!.item.buys} each)`).join(', ')}` : '';
        })
        .filter(Boolean);
    const holdings = milestoneHoldings(liveContext(agents.values(), CHARACTERS.length).members, loadPlan().teamGoal?.milestones ?? []);
    return `${rows.join('\n')}
Party total across the four separate banks (for milestones): ${sum || 'nothing seen yet'}.
${worthSelling.length ? `Most valuable banked goods, at the shop that pays most (prices fall as a shop fills; only the owner can withdraw and sell or give them): ${worthSelling.join('; ')}.` : ''}
${holdings ? `Who holds what the open milestones name (carried and worn now; banks as last seen):\n${holdings}\n` : ''}${renderHandoffs()}
${renderSales()}${worthText ? `\nBanked metal in bars' worth (bars plus smithed goods by the bars each took): ${worthText}.` : ''}
How banks work: each character has one bank of their own, and it is the same bank at every bank booth in the world. Depositing puts items in your own bank only; a teammate's deposits never reach yours. Only you can withdraw from your bank, and only you can take items out of it for a teammate: withdraw them, then give them. Items a teammate gives you arrive in your pack, not your bank. A pack holds 28 slots and ore does not stack, but bank notes do: hundreds of an item withdrawn as notes fit in one slot, can be given, and become ordinary items again when the receiver deposits them.`;
}

/** The shared status block: you, your teammates, the plan and the board. */
export function situation(a: Agent, opts: { unread?: Set<number>; boardLines?: number; hideBoard?: boolean } = {}): string {
    const st = a.sdk.getState()!;
    const p = st.player!;
    const outfitHint = armourHabitHint(st, a.sdk.getStateAge());
    const skills = st.skills.filter(s => s.baseLevel > 1 && s.name !== 'Hitpoints').map(s => `${s.name} ${s.baseLevel}`).join(', ') || 'all level 1';
    const mates = [...agents.values()]
        .filter(x => x !== a)
        .map(x => {
            const mp = x.sdk.getState()?.player;
            const where = mp ? locationLabel(mp.worldX, mp.worldZ) : 'unknown';
            const missing = missingTools(x);
            const routine = x.routineFor(a.name);
            return `${x.name}: ${x.activityLabel()}${routine ? ` | ${routine}` : ''} | at ${where} | total level ${x.totalLevel()} | deaths ${x.memory.deaths}${missing.length ? ` | missing ${missing.join(', ')}` : ''}${SHARE_INVENTORY ? ` | carrying ${resourceText(x)}` : ''}`;
        })
        .join('\n');
    const commitments = a.memory.commitments.filter(c => c.status === 'open');
    const unread = opts.unread ?? new Set<number>();
    const board = opts.hideBoard ? [] : recentPosts(opts.boardLines ?? 6);
    const boardText = opts.hideBoard ? '(hidden during blind proposals)' : board.length
        ? board.map(x => `${unread.has(x.id) ? '*' : ' '}#${x.id} ${x.from} -> ${x.to}${x.replyTo ? ` (re #${x.replyTo})` : ''}${x.council ? ` [council ${x.council}]` : ''}${x.urgent ? ' [urgent]' : ''}: ${x.text}`).join('\n')
        : '(empty)';

    const huntGoal = loadPlan().teamGoal;
    const huntHint = huntGoal?.milestones.some(m => (m.auto?.check as {kind?:string})?.kind === 'hunt')
        ? 'Paired combat: accepting responsibility or an invitation comes before the encounter outcome, not after. Check current food, gear, partner consent and a reachable target on a mapped multicombat tile. Spawn coordinates are search areas, not exact tiles a wandering NPC must occupy. Fresh observations give each attackable NPC identity, tile, zone and reachability; the assistant rechecks at engagement. Follow only the current mission stages; old M3/M4/M5, swordfish-stock, knight or return requirements do not carry into a replacement mission. Old failed attempts do not prove a fresh target is absent.' + (huntGoal.proposedBy === 'operator' ? ' This is an explicit operator assignment, not another council vote on the retired charter. Execute the bounded assignment with normal individual consent and readiness. Do not add old prerequisites. After one attempt, report the actual result and stop this test pending operator review, even if blocked; leave success unverified if no correlated shared defeat occurred.' : '')
        : '';
    const targetFacts = huntHint ? nearbyNpcSummary(st, a.sdk.getStateAge()).filter(row => /\bAttack\b/.test(row)).slice(0,6).join('; ') : '';
    return `YOU
${huntHint}${huntHint ? `\nCurrent nearby targets (within15tiles): ${targetFacts || 'none observed here; this does not establish absence at another site'}` : ''}
At ${locationLabel(p.worldX, p.worldZ)} | HP ${p.hp}/${p.maxHp} | combat level ${p.combatLevel} | total level ${a.totalLevel()} | deaths ${a.memory.deaths}
${p.worldX >= 2900 && p.worldX < 3000 && p.worldZ >= 3100 && p.worldZ <= 3220 ? 'Transport: bank_resources or travel to a mainland destination handles the Karamja return ferry (30 carried coins), including the ship ladder and gangplank. A failed walk across the sea or talk from below deck is not proof the return ferry is unavailable. Verify the transport action before declaring yourself stranded.' : ''}
Skills: ${skills}
Inventory (${st.inventory.length}/28): ${inventoryText(a)}
Wearing: ${a.sdk.getEquipment().map(i => i.name).join(', ') || 'nothing'}${outfitHint ? `\n${outfitHint}` : ''}
Tools you carry right now: ${TOOLS.filter(([n]) => !missingTools(a).includes(n)).map(([n]) => n).join(', ') || 'none'}. Missing: ${missingTools(a).join(', ') || 'none'}. (This is live; if your notes or the plan say otherwise, they are out of date.)${missingTools(a).length ? `\nWays to replace them: buy an axe or pickaxe at Bob's, or a tinderbox at the general store; get the coins by pickpocketing (no tools needed) or by selling goods (withdraw_from_bank brings banked ones back); or ask a teammate to buy or give you one.` : ''}
Fight tactics: ${renderTactics(checkTactics(a.memory.tactics as any))}
Goal: ${a.memory.goal || '(none set)'}
Open commitments: ${commitments.map(c => `[${c.id}] to ${c.to}: ${c.what}`).join('; ') || 'none'}
Notes to self: ${a.memory.notes || '(none yet)'}
${learning.context(a.name,[a.memory.goal,a.memory.notes,a.order?.action,a.order?.args.target,...a.history.slice(-2)].filter(Boolean).join(' '))}
Recent routines: ${a.history.slice(-3).map(row => row.length > 700 ? row.slice(0,350) + ' … ' + row.slice(-350) : row).join(' || ') || 'none yet'}

${smithingNotes(st, bankOf(a.name))}
${opportunityNotes(st, bankOf(a.name))}
${renderSupplyCoverage(partySupplyCoverage(agents.values(),loadPlan(),bankOf,recentEvents()))}
${foodNotes(st,bankOf(a.name),[...agents.values()].filter(x=>x.name!==a.name).map(x=>({name:x.name,state:x.sdk.getState(),bank:bankOf(x.name)})))}
${assistPairs.describe(a.name)}
Mapped surface multicombat examples (spawn zones only; target tiles rechecked; choose for your levels and provisions): ${SPOTS.filter(s => s.kind === 'monster' && !s.tollGate && (s.level ?? 999) <= p.combatLevel && isMulticombat(s.x,s.z)).sort((a,b) => Math.hypot(a.x-p.worldX,a.z-p.worldZ)-Math.hypot(b.x-p.worldX,b.z-p.worldZ)).slice(0,3).map(s => `${s.type} near ${s.near} (${s.x},${s.z}; combat ${s.level}, wilderness ${wildernessLevel(s.z)})`).join('; ') || 'none known for your level'}
Wilderness scouting options (indexed targets, not proof of a safe route): ${SPOTS.filter(s => s.kind === 'monster' && s.z >= 3520 && s.z < 3560 && (s.level ?? 999) <= p.combatLevel).sort((a,b) => Math.hypot(a.x-p.worldX,a.z-p.worldZ)-Math.hypot(b.x-p.worldX,b.z-p.worldZ)).slice(0,3).map(s => `${s.type} (${s.x},${s.z}; combat ${s.level}; wilderness ${wildernessLevel(s.z)}; ${isMulticombat(s.x,s.z) ? 'mapped multicombat' : 'single/unknown combat'})`).join('; ') || 'use lookup to find a suitable destination'}. Travel, observe fresh game state, and return to a chosen bank; seeing an option is not a completed visit.


PARTY (total level ${partyTotal()})
${mates}

NEARBY OPTIONS (from the world index of the free-to-play world; set lookup to find anything else)
${nearbyOptions({ x: p.worldX, z: p.worldZ }, { ...Object.fromEntries(st.skills.map(k => [k.name, k.baseLevel])), Combat: p.combatLevel })}

PARTY FACTS (read from the game, not from anyone's say-so; use these to judge milestones)
${partyFacts()}

PARTY ACHIEVEMENTS (firsts and marks detected from the game data)
${renderAchievements()}
Still open and near you (from the game data): ${renderAchievementsNear(a.name, st, SPOTS.filter(s => s.kind === 'monster' && s.level != null).map(s => ({ type: s.type, level: s.level!, count: s.count })))}

WANTS (standing requests between you; delivered with give)
${renderWants(a.name, heldBy)}

PARTY PLAN
${renderPlan(loadPlan())}

TRAVEL LOG (every walk the party has made, and how it went)
${renderRoutes(4)}

MESSAGE BOARD (* = new to you)
${boardText}`;
}

// ---------------------------------------------------------------- decide

export interface Step {
    action: string;
    target: string | null;
    until_type: 'minutes' | 'skill_level' | 'gathered' | 'exhausted';
    until_value: number;
    until_skill: string | null;
    until_item: string | null;
    give_to: string | null;
    give_item: string | null;
    give_amount: number | null;
}

export interface Decision {
    ambition: AmbitionInput | null;
    field_note: FieldNoteInput | null;
    thought: string;
    lookup: string | null;
    resume: boolean;
    routine: string;
    repeat: boolean;
    steps: Step[];
    goal: string | null;
    commit: { to: string; what: string }[];
    resolve: { id: number; status: 'done' | 'dropped' }[];
    messages: { to: string; text: string; reply_to: number | null; urgent: boolean }[];
    wants: { item: string; amount: number; from: string; why: string }[];
    drop_wants: number[];
    tactics: { eat_below: number; retreat_below: number; finish_if_enemy_below: number; target: string; style: string; loot: string } | null;
    call_council: boolean;
}

const nullable = (type: string, description: string) => ({ type: [type, 'null'], description });

// Constant on every call (all actions, availability is checked in code), so it never
// breaks the cached prompt prefix.
const DECISION_SCHEMA = (() => {
    const actions = [...Object.keys(SKILLS), 'give'];
    return {
        type: 'object',
        properties: {
            ambition: {type:['object','null'],description:'Only during active pilot and when changing your own ambition; otherwise null.',properties:{
                title:{type:'string',maxLength:60},why:{type:'string',maxLength:120},nextStep:{type:'string',maxLength:140},reconsiderWhen:{type:'string',maxLength:120},status:{type:'string',enum:['pursue','pause','retire']}},required:['title','why','nextStep','reconsiderWhen','status'],additionalProperties:false},
            field_note: {type:['object','null'],description:'Optional unverified interpretation of a shown observation; null normally.',properties:{
                evidence_id:{type:'string',maxLength:40},interpretation:{type:'string',maxLength:180},next_test:{type:'string',maxLength:180},status:{type:'string',enum:['open','supported','contradicted','inconclusive','retired']},result_evidence_id:{type:['string','null'],maxLength:40}},required:['evidence_id','interpretation','next_test','status','result_evidence_id'],additionalProperties:false},
            thought: { type: 'string', description: 'One short sentence: why this routine, given your character and the party.' },
            lookup: nullable(
                'string',
                'Ask the world index where something is: a resource, monster, shop item or place (e.g. "coal", "willow", "lure fishing", "barbarian", "fly fishing rod", "furnace near falador"). If set, the rest of this reply is ignored and you are asked again straight away with the answer. Null otherwise.'
            ),
            resume: { type: 'boolean', description: 'True to carry on with your interrupted routine from the step where it stopped (routine, repeat and steps are then ignored). Only possible when you are told it can be resumed.' },
            routine: { type: 'string', description: "A short name for this routine, e.g. 'bronze daggers' or 'iron runs'." },
            repeat: { type: 'boolean', description: 'True to loop back to the first step after the last one.' },
            steps: {
                type: 'array',
                minItems: 1,
                maxItems: 6,
                description: 'The steps, run in order.',
                items: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', enum: actions },
                        target: nullable('string', 'Target for the action if it takes one (see the action list), else null.'),
                        until_type: { type: 'string', enum: ['minutes', 'skill_level', 'gathered', 'exhausted'], description: 'When this step is finished.' },
                        until_value: { type: 'integer', description: 'minutes (2-20), the skill level to reach, or how many items to gather (ignored for exhausted).' },
                        until_skill: nullable('string', "For skill_level: the skill name or Combat (derived combat level), e.g. 'Mining'."),
                        until_item: nullable('string', "For gathered: the item name, e.g. 'logs'."),
                        give_to: nullable('string', "For 'give': teammate name."),
                        give_item: nullable('string', "For 'give': item name, e.g. 'logs'."),
                        give_amount: nullable('integer', "For 'give': how many, or null for all.")
                    },
                    required: ['action', 'target', 'until_type', 'until_value', 'until_skill', 'until_item', 'give_to', 'give_item', 'give_amount'],
                    additionalProperties: false
                }
            },
            goal: nullable('string', 'Your new personal goal if it changed, else null.'),
            commit: {
                type: 'array',
                maxItems: 2,
                description: 'New promises you are making now.',
                items: {
                    type: 'object',
                    properties: { to: { type: 'string' }, what: { type: 'string' } },
                    required: ['to', 'what'],
                    additionalProperties: false
                }
            },
            resolve: {
                type: 'array',
                description: 'Your open commitments that are now done or dropped.',
                items: {
                    type: 'object',
                    properties: { id: { type: 'integer' }, status: { type: 'string', enum: ['done', 'dropped'] } },
                    required: ['id', 'status'],
                    additionalProperties: false
                }
            },
            messages: {
                type: 'array',
                maxItems: 2,
                items: {
                    type: 'object',
                    properties: {
                        to: { type: 'string', description: "'all' or a teammate's name." },
                        text: { type: 'string', description: 'Short, in character, under 200 characters.' },
                        reply_to: nullable('integer', 'Board post number you are answering, or null.'),
                        urgent: {
                            type: 'boolean',
                            description:
                                'True only if the teammate must change what they are doing right now (a hand-off is waiting, danger, their task cannot work). It interrupts them. Otherwise they read it at their next decision.'
                        }
                    },
                    required: ['to', 'text', 'reply_to', 'urgent'],
                    additionalProperties: false
                }
            },
            wants: {
                type: 'array',
                maxItems: 3,
                description: 'Items you want handed to you, listed for the whole party until delivered or dropped. Leave empty unless you need something new.',
                items: {
                    type: 'object',
                    properties: {
                        item: { type: 'string' },
                        amount: { type: 'integer' },
                        from: { type: 'string', description: "A teammate's name, or 'anyone'." },
                        why: { type: 'string', description: 'A few words, e.g. "to smelt bronze".' }
                    },
                    required: ['item', 'amount', 'from', 'why'],
                    additionalProperties: false
                }
            },
            drop_wants: { type: 'array', items: { type: 'integer' }, description: 'Ids of your own wants you no longer need.' },
            tactics: {
                type: ['object', 'null'],
                description: 'Your fight tactics, used by every fight step until you change them (null keeps them as they are). HP values are percentages of your maximum; nobody fights on below 15%.',
                properties: {
                    eat_below: { type: 'integer', description: 'Eat when HP falls below this %.' },
                    retreat_below: { type: 'integer', description: 'With no food left, leave the fight below this %.' },
                    finish_if_enemy_below: { type: 'integer', description: 'Stay to finish an enemy whose HP is below this % even past your retreat line (0 = never).' },
                    target: { type: 'string', enum: ['nearest', 'lowest_hp', 'not_fighting'], description: 'Which monster of the kind to attack: nearest, the most hurt, or one no one else is fighting.' },
                    style: { type: 'string', enum: ['keep', 'accurate', 'aggressive', 'defensive', 'controlled'], description: 'Combat style: accurate trains Attack, aggressive Strength, defensive Defence, controlled all three.' },
                    loot: { type: 'string', enum: ['bones', 'none'], description: 'Pick up and bury bones after kills, or not.' }
                },
                required: ['eat_below', 'retreat_below', 'finish_if_enemy_below', 'target', 'style', 'loot'],
                additionalProperties: false
            },
            call_council: { type: 'boolean', description: 'True only if the party plan no longer works and everyone should re-plan together.' }
        },
        required: ['ambition','field_note','thought', 'lookup', 'resume', 'routine', 'repeat', 'steps', 'goal', 'commit', 'resolve', 'messages', 'wants', 'drop_wants', 'tactics', 'call_council'],
        additionalProperties: false
    };
})();

/** Answers a lookup from the world index, and from the shop catalogue for items to buy. */
export function answerLookup(a: Agent, query: string): string {
    const p = a.sdk.getState()?.player;
    const here = p ? { x: p.worldX, z: p.worldZ } : { x: 3222, z: 3218 };
    const shop = shopSelling(query);
    const sold = shop ? `\n${shop.item.name} is sold at ${shop.shop.name} (${shop.shop.x}, ${shop.shop.z}) for ${shop.item.price} coins.` : '';
    return lookupIndex(query, here) + sold;
}

export async function decide(a: Agent, trigger: string, unread: Set<number>): Promise<Decision> {
    const { blocked } = availability(a.sdk.getState()!);
    const preparation: string[] = [];
    for (const action of Object.keys(blocked)) {
        const ready = nextPreparation(a.sdk.getState()!, bankOf(a.name)?.items ?? {}, { action, args: { target: null }, until: { type: 'minutes', skill: null, value: 10 } });
        if (ready.preparation) { preparation.push(`- ${action}: ${ready.preparation.reason}`); delete blocked[action]; }
    }
    const unavailable = Object.entries(blocked).map(([k, why]) => `- ${k}: ${why}`).join('\n') || '(none)';
    const user = `${situation(a, { unread })}

AVAILABLE AFTER AUTOMATIC PREPARATION (the executor fetches usable tools and known banked materials, withdraws coins, and banks surplus as needed; levels and stock are checked again for your exact target)
${preparation.join('\n') || '(none)'}

UNAVAILABLE TO YOU RIGHT NOW
${unavailable}

RECENTLY UNAVAILABLE OPTIONS (code enforces these until the relevant facts change or the observation expires)
${a.recentBlockedOptions()}

OBSERVATION AND RETRY DISCIPLINE
Your current scene and nearby combat targets are already supplied above. Use look for a specific missing object/dialogue detail or a changed scene, not as a stand-in for waiting, checking milestone completion or requesting council. When awaiting a partner, arrange travel/rendezvous and a bounded wait in one routine. Do not repeatedly call council about the same unchanged dependency; messages and current work continue between hourly reviews. Missing ingredients stay unavailable across an unrelated bank visit. Smith cannot make a silver dagger; owned bars do not establish that a recipe exists. Use only supported recipes and verify their inputs/tools.

WHY YOU ARE DECIDING NOW
${trigger}

${learning.invitationDue(a.name,a.memory.ambitionInvitedAt)?'ONE-TIME OPTIONAL INVITATION: You have not chosen a personal ambition for this pilot. In this decision, choose a small project you care about with your own reason, feasible next step and reconsideration condition, or leave ambition null to decline. Either is valid; this invitation will not repeat after an accepted decision. Your choice must fit current obligations; no need to change routines merely for novelty.':''}

${discoveryOptions(a.sdk.getState(),a.sdk.getStateAge(),SPOTS,learning.snapshot())}

Set your next routine, and any messages, commitments or goal change.`;
    return callModel<Decision>(a.name, a.system, user, DECISION_SCHEMA, 1200);
}

// ---------------------------------------------------------------- council

export interface CouncilTurn {
    message: string;
    commitment: string;
    asks: { to: string; what: string }[];
    agree: boolean;
    milestones_done: number[];
    milestone_ids: number[];
}

const COUNCIL_SCHEMA = {
    type: 'object',
    properties: {
        message: { type: 'string', description: 'What you say to the council, in character, under 250 characters.' },
        commitment: {
            type: 'string',
            description:
                'Your next concrete work, including dependencies you own and productive fallback work, until the next council (normally hourly).',
        },
        milestone_ids: {
            type: 'array',
            items: { type: 'integer' },
            description:
                'Open mission milestones you take accountability for, using their M numbers. Do not claim an objective while committing only unrelated personal training.',
        },
        asks: {
            type: 'array',
            maxItems: 2,
            description: 'Things you need from specific teammates.',
            items: {
                type: 'object',
                properties: { to: { type: 'string' }, what: { type: 'string' } },
                required: ['to', 'what'],
                additionalProperties: false,
            },
        },
        agree: { type: 'boolean', description: 'True if you are happy with how the work is now split between the four of you.' },
        milestones_done: {
            type: 'array',
            items: { type: 'integer' },
            description:
                'Numbers of mission milestones that PARTY FACTS or your own situation show are complete (e.g. 1 for M1). Empty if none.',
        },
    },
    required: ['message', 'commitment', 'asks', 'agree', 'milestones_done', 'milestone_ids'],
    additionalProperties: false,
};

const councilAchievements = () =>
    renderAchievementsForCouncil(
        [...agents.values()].map(x => ({ name: x.name, state: x.sdk.getState() })),
        SPOTS.filter(s => s.kind === 'monster' && s.level != null).map(s => ({ type: s.type, level: s.level!, count: s.count, hp: s.hp }))
    );

export async function councilTurn(a: Agent, council: number, reason: string, round: number, transcript: string): Promise<CouncilTurn> {
    const user = `${situation(a, { boardLines: 6 })}

PARTY ACHIEVEMENTS (from the game data)
${councilAchievements()}

COUNCIL #${council}, ROUND ${round} of 3
Called because: ${reason}
The four of you are deciding who does what until the next council (normally hourly), in service of the mission's next open milestone. A good split usually puts different people on different links of its chain rather than everyone on the same task. Keep plans and milestones plain: do not add conditions the game cannot check or that cost more effort than they are worth (separate batches, paperwork, special sourcing). Speak to the others as yourself, with your own drives, say what you will do, ask for what you need, and say whether you agree with the split so far. Lean on your abilities, but cover what the milestone needs. Every open milestone needs a named accountable owner and a concrete feasible next action. Taking responsibility for an unfinished milestone is not a completion claim. Do not condition accepting a preparatory action or assist invitation on the completion that action is needed to produce; agree the work using current readiness, then let game evidence close the milestone. Return its number in milestone_ids when you own it. Use the supported work chain and verify the actual worker's requirements. For each open milestone, account for current supply coverage above. A completed delivery does not mean stock remains; below10min estimated coverage renew a character-agreed request toward45min of useful work, with a provisional supplier reserve. Do not declare a dependency covered from old prose, a historical receipt or unrelated fallback XP. Prefer one useful bulk delivery over repeated one-recipe errands, reconcile competing asks and verify fresh bank/inventory state. Fallback is temporary while the dependency remains open. Before requesting more mining, check the delivery opportunities above: stock in a supplier bank must become an agreed, bounded handoff, not another mine/bank loop. An accepted delivery needs giver, receiver, quantity, safe meeting point, receiving space and actual transfer confirmation. Bank notes may transport bulk coal, then must be deposited/withdrawn unnoted to smelt. Reconcile partial deliveries. The earlier user request for ONE recovery handoff is historical once fulfilled, not a prohibition on replenishing consumed supplies for a still-open goal. A request for a delivery needs a giver who agrees to withdraw and bring it; personal work does not cover that dependency. Buy your own affordable tools/feathers or do independent fallback work instead of waiting indefinitely. If a milestone is already complete, report it in milestones_done; automatic checks remain authoritative, while only legacy non-automatic milestones can close on two claims.

When agreeing the split, leave room for optional 5–10 minute personal experiments alongside long skill targets rather than deferring them until the target is finished. Fulfil or explicitly renegotiate accepted deliveries first; characters choose their outing and partner or decline. Consider a personal ambition or relevant field-guide test, with a return plan and measured result. Do not count intentions as completed milestones or abandon an agreed delivery.

SO FAR IN THIS COUNCIL
${transcript || '(you speak first)'}`;
    return callModel<CouncilTurn>(a.name, a.system, user, COUNCIL_SCHEMA, 400);
}

// ---------------------------------------------------------------- goal setting

export interface Proposal {
    id: number;
    by: string;
    key?: string;
    template?: string;
    work?: import('./mission-chain').MissionWork[];
    title: string;
    mission: string;
    why: string;
    milestones: {
        what: string;
        needs: string;
        check?: Check;
        owner?: string;
        next?: import('./mission-chain').MissionWork;
        fallback?: string;
    }[];
}

export interface GoalTurn {
    message: string;
    vote: number;
    new_title: string | null;
    new_mission: string | null;
    new_why: string | null;
    new_milestones: { what: string; needs: string }[];
}

const GOAL_SCHEMA = {
    type: 'object',
    properties: {
        message: { type: 'string', description: 'What you say to the others, in character, under 250 characters.' },
        vote: { type: 'integer', description: 'The proposal number you back (0 in the proposal round).' },
        new_title: { type: ['string', 'null'], description: 'Proposal round only: a short name for your mission.' },
        new_mission: { type: ['string', 'null'], description: 'Proposal round only: one or two sentences on what kind of party you want to become. A vision, not a task.' },
        new_why: { type: ['string', 'null'], description: 'Proposal round only: why it suits the four of you, given your characters.' },
        new_milestones: {
            type: 'array',
            maxItems: 4,
            description: 'Proposal round only (else empty): 2-4 milestones, each hours of combined work that chains several of you together.',
            items: {
                type: 'object',
                properties: {
                    what: { type: 'string', description: 'Concrete and checkable from levels, items or places.' },
                    needs: { type: 'string', description: 'The chain of who does what, naming at least two of you, e.g. "bram mines ore -> mike smelts and sells -> trish buys armour".' }
                },
                required: ['what', 'needs'],
                additionalProperties: false
            }
        }
    },
    required: ['message', 'vote', 'new_title', 'new_mission', 'new_why', 'new_milestones'],
    additionalProperties: false
};

const MISSION_BRIEF = `A mission is a vision of the party you want to become over about ten hours of play, not a chore: for example "self-made smiths who arm the whole party from ore we dig ourselves", "the crew that fought its way up from goblins to bringing down a lesser demon together", "the party that has walked every road from Draynor to Varrock", or "the richest party in Lumbridge, built on fair trade". It should suit who the four of you are.
Milestones are the steps towards it. Each must be concrete and checkable from PARTY FACTS: name the exact items and counts, who must hold, wear or bank them, and where (e.g. "Trish and Wren each wear a steel weapon and carry 10 cooked fish at once", not "practical supplies"; "sell at a shop in Port Sarim", not "a new town"). Keep milestones plain: no extra conditions on how, when or from what an item was made, and no wording tighter than the goal needs. Where an item came from is not checkable: items of one name are identical, and the game keeps no record of who made them, when or from what. Each must take hours of combined work, and form a chain where one member's output is another's input (for example: one of you mines ore -> another smelts and sells it -> a third buys armour with the coins). If one of you could do it alone, or it is nearly done already, it is not a milestone. Name who each link of the chain needs.
Size the milestones from the party's measured rates (below): each should take about 2-4 hours, and all of them together about 10 hours. For example, at ~10 bronze bars an hour, 3 hours of smelting is ~30 bars, not 500. The rates only show what you do today; new work (better gear, tougher monsters, new places) starts slower.
Every milestone must be reachable with the actions you have (see your action list: smith works bronze to rune bars into weapons and armour; no action crafts silver or gold into items) and with what shops really buy (the atlas lists each shop's goods; a shop buys only the kinds it sells, so Peksa's Helmet Shop buys helmets, not daggers). Milestones of the current mission marked [x] are finished and stay finished: do not list them again. PARTY ACHIEVEMENTS (below) lists the firsts and marks the party has unlocked and the ones still open, read from the game data. Every mission also gets two more milestones by itself, "unlock 5 new achievements" (the game's ledger checks it) and "everyone wears armour: a helmet, body armour and leg armour each" (read from what each of you wears), and no vote can tick either. For armour, weigh function, appearance and individuality together (see WHAT YOU CAN WEAR): choose a look that suits your character and differs from your teammates'. The game checks only the helmet, body and leg slots for completion. Your milestones can build towards them or be about something else, and need not repeat them.`;

const renderProposals = (ps: Proposal[]) =>
    ps.map(p => `#${p.id} "${p.title}" ${p.by === 'game' ? '' : `(proposed by ${p.by})`}: ${p.mission}\n   Why: ${p.why}\n${p.milestones.map((m, i) => `   M${i + 1}: ${m.what} (chain: ${m.needs})`).join('\n')}`).join('\n');

/**
 * One turn of mission setting. 'propose' is blind: the agent sees no other proposal, nor
 * the board, so the first speaker cannot frame it. 'vote' forbids backing your own;
 * 'runoff' is between the two leaders.
 */
export async function goalTurn(a: Agent, council: number, phase: 'propose' | 'vote' | 'runoff', proposals: Proposal[], transcript: string): Promise<GoalTurn> {
    let task: string;
    if (phase === 'propose') {
        task = `ROUND 1 of 3: PROPOSE, BLIND
Write your own mission and milestones, as your character would want it. You cannot see anyone else's proposal yet, so do not try to guess them. Set vote to 0.`;
    } else if (phase === 'vote') {
        const yours = proposals.find(p => p.by === a.name);
        const menu = proposals.every(p => p.by === 'game');
        task = menu ? `MISSION MENU: CHOOSE
The game built these missions from your real levels, gear, banks and the map: every one is reachable, and the game itself checks each milestone from live state, so no vote or claim can tick them. Choose the one that best suits who you are as a character. Back one by number in vote; in message, say why it suits you and what part of it you would take.

MISSIONS
${renderProposals(proposals)}

WHAT EVERYONE SAID SO FAR
${transcript || '(you speak first)'}` : `ROUND 2 of 3: VOTE
Back the proposal you think is best for the party${yours ? `. You may not back your own (#${yours.id})` : ''}. Judge them on whether the milestones truly need several of you, whether the mission suits the party, and how well it serves what you care about. Use your message to say why. Leave the new_* fields empty.

PROPOSALS
${renderProposals(proposals)}

WHAT EVERYONE SAID WHEN PROPOSING
${transcript}`;
    } else {
        task = `ROUND 3 of 3: RUNOFF
Choose between these two finalists (you may back either, including your own). Leave the new_* fields empty.

FINALISTS
${renderProposals(proposals)}

SAID SO FAR
${transcript}`;
    }
    const plan = loadPlan();
    const current = plan.teamGoal;
    const why = plan.rescope ? `\nWHY THIS SESSION WAS CALLED\n${plan.rescope}\n` : '';
    const age = current?.set ? `, set ${((Date.now() - current.set) / 3_600_000).toFixed(1)} hours ago` : '';
    const user = `${phase === 'propose' ? situation(a, { hideBoard: true }) : situation(a, { boardLines: 4 })}

MISSION SETTING, COUNCIL #${council}
${phase === 'propose' ? MISSION_BRIEF : 'Choose only from the validated menu or finalists below. Do not invent or resize their checks. The user wants shared exploration projects with a fresh contribution from every character, not another single-person skill ladder or reserve grind. Compare the regions, practical tests and questions you each find interesting; choose from the offered projects. There is no ten-hour grind requirement. Normal council rounds assign owners, dependencies and productive fallback work.'}
${why}
PARTY RATES
${partyRates()}

PARTY ACHIEVEMENTS (from the game data)
${councilAchievements()}
${current?.mission ? `
THE CURRENT MISSION${age} (${phase === 'propose' ? 'context for a new proposal' : 'context only; it is not an extra voting option unless listed in the menu'})
${renderGoal(current)}
` : ''}
${task}`;
    return callModel<GoalTurn>(a.name, a.system, user, GOAL_SCHEMA, 500);
}

// ---------------------------------------------------------------- reflection

const REFLECT_SCHEMA = {
    type: 'object',
    properties: { notes: { type: 'string', description: 'Your updated notes to self, under 500 characters.' } },
    required: ['notes'],
    additionalProperties: false
};

export async function reflect(a: Agent): Promise<string> {
    const user = `Your notes to self so far: ${a.memory.notes || '(none)'}

Your recent orders and results:
${a.history.join('\n') || '(none)'}

Recent board posts:
${recentPosts(15).map(p => `${p.from} -> ${p.to}: ${p.text}`).join('\n') || '(none)'}

Keep uncertainty explicit: a single blocked attempt is not proof a skill is broken. Distinguish personal reactions from observed game facts, consult relevant guide evidence, and do not overwrite structured ambitions or promote field-guide interpretations into facts.
Rewrite your notes to self: what you have learned about the world, what works and what does not, how you feel about each teammate, and anything you must not forget. Keep what still matters from the old notes, and drop or correct anything your current situation contradicts (for example tools you now carry, or blockers that are gone).

Your current situation:
${situation(a, { boardLines: 0, hideBoard: true })}`;
    const r = await callModel<{ notes: string }>(a.name, a.system, user, REFLECT_SCHEMA, 600);
    return r.notes.slice(0, 600);
}
