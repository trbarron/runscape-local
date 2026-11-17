# Layer responsibilities and handoffs

This contract describes the current system, including its limitations. Proposed changes are
listed separately in [the overnight review](reviews/2026-10-27-overnight.md). Reading this file
does not change the prompts or reload the runtime.

## Ownership

| Layer | Owns | Does not own | Main implementation |
|---|---|---|---|
| User | Party purpose, standing priorities (including fashion), desired autonomy, spend and deployment scope | Repeating each click or solving every blocked step | Session instructions; runtime settings |
| Maintenance / operations reviewer (this coding assistant) | Review evidence across runs, diagnose cross-character failures, improve code and prompts, deploy within the user's scope, verify and leave a handoff | Pretending to be a permanent monitor; silently changing goals, inventories or completion history | `watchdog.ts`, `scorecard.ts`, `changes.json`, this documentation |
| Mission and council coordination | Build feasible opportunities from facts; characters vote and negotiate roles; persist the plan and notify characters when it changes | Making nonexistent items available; treating agreement as completion of an automatic check | `missions.ts`, `council.ts`, `memory.ts`, council prompts in `planner.ts` |
| Individual character planner | Choose a feasible routine, coordinate requests, react to blockers, resume or replace work, retain character preferences | Editing server truth, accessing another character's bank, declaring a failed action successful | `planner.ts`, `agent.ts`, `memory.ts`, `board.ts`, `wants.ts` |
| Executor and readiness | Run bounded routines; check requirements; acquire available own-bank tools/supplies; bank surplus; handle interruptions and bounded retries; report actual outcomes | Inventing stock, skills or success; endless retries; choosing a new party mission | `agent.ts`, `readiness.ts`, `skills.ts`, `game-requirements.ts` |
| SDK and game server | Movement, trade, combat, inventory and equipment changes, skill requirements and saves | Deciding the party's priorities | `rs-sdk/sdk/`, game configs and server |
| Observation / website | Publish and render timestamps, snapshots, portraits, logs and measured progress; preserve old assets honestly on publication failure | Sending gameplay commands, completing goals, treating a screenshot as live game truth | `dashboard.ts`, `lanes.ts`, `publish.ts`, `assets.ts`; website consumer |

The maintenance reviewer is outside the running party. The macOS LaunchAgent and `supervisor.ts`
own persistent process supervision, controller heartbeat checks and bounded orphan/session recovery.
`orchestrator.ts` starts clients, supervises character loops, handles connection health and shuts
down safely. Neither layer is a strategic model. `watchdog.ts` remains a separately invoked,
model-free gameplay check; its existence alone is not proof anyone is calling it regularly.

## Sources of truth

1. Fresh SDK/game state is authoritative for current carried/worn items, HP and levels.
   Bank records are observations from the last bank visit; retain their age and uncertainty.
2. `state/plan.json` is the current agreed mission/work split. Old notes, wants and commitments
   do not override it or the user's standing constraints.
3. Automatic milestones (`auto.check`, achievements, armour, outfit) are evaluated in code.
   Non-automatic legacy/freeform milestones can still close on two council claims. These are
   different evidence classes, not interchangeable definitions of verified completion.
4. Event logs record observed outcomes. A request, promise or attempted handoff is not a delivery.
   Count resolved promises by ID and reporting cohort; count transfers from confirmed records.
5. A published snapshot describes the party; it does not control it. Publication success and
   local capture success are distinct. Consumer and producer schemas must remain compatible.

## Runtime handoff contracts

### Coordination → character

The opportunity library now has 32 parameterized templates. Code validates actual worker levels,
methods, stations, usable supplies/tools and affordable own-bank-funded purchases, then offers up
to five diverse candidates. The cache is checked by the minute council tick and `/menu.json`,
invalidated by changed facts and refreshed after five unchanged minutes. Selection validates fresh
facts again. Stable objective keys distinguish variants; refresh does not alter the active goal.

Characters vote and negotiate milestone ownership. Full agreement requires coverage of every open
milestone. The saved plan records accountable owners, next actions and productive fallbacks;
remaining negotiation gaps are filled explicitly from supported suggestions. Work suggestions can
refresh while completion checks/targets stay fixed. An owner remains responsible for dependencies,
not merely claiming unrelated personal training. A plan still does not prove a delivery occurred.

Normal councils reassign work without replacing the mission. New missions are selected on completion,
explicit rescope or structural infeasibility, not every fifth council. Recoverable funding loss does
not automatically retire a goal. Retired unfinished missions retain their original objectives and
reason in `plan.retiredMissions`. A validated singleton is used; an empty menu is reported rather
than replaced by unvalidated character prose.

### Character → executor → character

The planner returns a named 1–6 step routine, action arguments, stop conditions and optional repeat.
Readiness checks known level/budget/stock constraints; the executor checks fresh state at each step.
It can use the character's own bank or supported affordable purchases, but cannot fetch a teammate's
banked items. It returns outcomes (`done`, `blocked`, `stale`, `interrupted`, `died`), reasons and
measured gains. A blocker is information to change the plan, not evidence to repeat it unchanged.
Preparation and routine loops are bounded. Requirements and valid destinations belong in code;
character reasoning chooses among feasible alternatives.
Reusable tool acquisition inside production is preparation, not productive output or a reason
to continue an automatic cycle. Normal-log Fletching permits shafts at level 1 and shortbows at 5;
readiness and workshop suggestions retain that distinction without assigning the character work.

Productive time-budget expiry is `yielded`, with the count/level target unfinished and
resumable; no-progress expiry is `stuck`. Useful crafting output with unavailable remaining
inputs is `partial`. Neither outcome completes a mission. Withdrawal batches reserve recipe
ratios and tool space while preserving final production goals; events report requested,
batch and received quantities. Available own-bank inputs replenish between passes.
Feasibility probes a complete personal chain before shared supplies, rolling back every
tentative reservation and purchase when that probe fails.

Smelting has a separate observed-attempt report: resolved attempts, bar outputs,
confirmed consumed inputs, iron impurity losses and reach failures. New explicit
server messages are deduplicated by publication identity (legacy tick/text fallback).
Expected iron losses do not increment the no-progress pass count; ten consecutive
confirmed losses yield with the target unfinished. The execution time budget still
applies, and neither input consumption nor expected failure counts as goal progress.
Fresh material exhaustion can be partial; real reach or level failures still block.

As of 2026-10-27, `blocked-options.ts` persists recent deterministic stock/material/recognized
level/funding failures per character. The planner sees these exclusions, preflight enforces them
before proposal side effects, and execution rechecks each step (including resumed work). Relevant
item, equipment, usable-level or funding changes invalidate the matching entry; an unrelated bank
refresh with the same missing stock does not; otherwise it expires after
15 minutes. Transient combat/route/shop errors are not cached. This is implemented feasibility
memory. Coverage is now implemented as above; a complete delivery handshake remains future work.

Combat stop conditions read the derived player combat level in both readiness and execution;
ordinary skills use their base levels. Character context includes optional owned, wearable adamant
gear and beginner Firemaking/Fletching opportunities, without replacing the agreed mission or
outfit preferences. Smithing context gives own-bank ore batches with room reserved for food/tools;
planners are instructed to repeat replenishment → exhausted smelt/smith batches → banking rather
than attach an entire level target to a finite bar supply. Workshop feasibility tries eligible
higher-tier recipes before lower-tier fallbacks, with adamantite bars mapped to adamant smelting.
These suggestions do not force a character to adopt an activity or guarantee a level gain.

### Combat food and engagement continuity

`combat-food.ts` reads fixed healing values for supported cooked fish from the server's consumption
config. Planning context shows carried nominal healing/max-HP equivalents, age-labelled bank
supplies, qualified teammate cooking/fishing opportunities and possible food-production handoffs.
Readiness credits only actually carried edible fish; bank stocks and promises are not carried food.
Raw/noted/unvalued foods are not credited by this initial policy. The five-fish travel reserve is
unchanged. No permanent supplier/fighter role or fish species is prescribed.

For ordinary non-starter fights the entry budget is half max HP, or two max-HP equivalents for
higher-HP/level or wilderness-only targets. Shorter minute-based sessions scale down; budget caps
at the10min amount for longer/level targets. Invite uses the full larger budget; assist scales its
larger budget to the chosen duration. This is an initial capacity heuristic, not a survival prediction
or a fresh restocking requirement after every bite. Starter targets level3 and below are exempt.

Readiness first proves a complete feasible own-bank load. It prefers stronger healing per slot,
uses explicit cooked matching, up to3 food types and6 weak-food deposit actions (under the10-action
preparation limit). It never begins an insufficient partial load or banks unrelated gear to free
many slots. Otherwise the planner gets a blocker to arrange supplies, bank surplus or shorten work.
Other characters' banks require agreement and an actual handoff. Eating favors effective healing
per action, with less overheal on ties. Food cost observations include type/count and nominal
healing consumed, not a claim of actual HP restored when healing overlaps damage.

`combat-engagement.ts` waits on the exact NPC until ended, deliberate retreat or pass boundary.
Active zero-XP combat overrides reach heuristics. Low HP/no food still advances game ticks;
it cannot exhaust six immediate rounds and fall into looting or another attack. Tracked targets
survive pass rollover and are checked before spawn navigation. Unrelated combat triggers retreat.
These recovery rules do not assign a new goal. See [combat provisions](../docs/designs/combat-provisions.md).

### Combat reporting

`fight-report.ts` owns a single observation accumulator for each fight order. Agent execution
subscribes across all passes and publishes cumulative text plus additive `order_end.fight`
telemetry, including interrupted/blocked orders. A selected NPC is tracked by world index and
config id; observed engagement and zero-HP target defeat are distinct from disappearance,
replacement or unfinished combat. Unresolved endings are never promoted into confirmed kills,
and target defeat does not identify the player who earned kill credit. HP loss is observed
negative HP change (a lower bound when healing overlaps damage); food is counted only around
successful eat calls with an observed inventory decrease, not deposits/trades/death losses.

Operation timings partition the whole order into combat/attack, explicit navigation, loot/bury
and other time. Combat helpers may approach a target internally; these are operation timings,
not pure movement/animation measurements. XP/hour uses the same whole-order duration. Finished
reports ignore late asynchronous updates. Earlier historical logs are not rewritten. Existing
legacy XP-based first-kill achievement inference is unchanged and is not made authoritative by
these reports. Website consumers keep reading the existing summary; no snapshot schema change.

### Character → character: paired combat assist

Characters may choose a bounded pair session without replacing their mission or outfit preferences.
The leader's non-repeating routine starts `invite_assist(partner)` (minutes 1), immediately followed
by `fight` (minutes 1–15). One urgent invitation prompts the recipient to decide; no automatic
acceptance. The assistant chooses a single `assist(leader)` step (minutes 1–15, no repeat).
Both finish any existing solo fight and rendezvous within four tiles/60 s before the agreed hunt.
Only two disjoint pairs are possible; controller-local consent expires within 15 min and is cleared
on routine end, cancellation or restart. Saved cooperative routines require a fresh planner decision.

Executor checks fresh connected game state, same ground floor, local 64-tile range and positions
including wilderness. It follows with bounded short moves, checks the leader's exact agreed fight
step and NPC identity, and dispatches only to a locally corroborated target in a mapped
multicombat zone. Single-combat, stale/unknown state, PvP and ambiguous targets fail closed.
Regroup, target-gap and mismatch waits are bounded. Assist honors its own eating/retreat rules;
terminal failures attempt bounded disengagement, while external cancellation issues no new action.
Confirmed shared-target engagements and follow attempts are cumulative session observations, not
kills or attributed damage. Existing XP reports remain separate. Wilderness permission is explicit; planner guidance favors prepared short exploration with food,
replaceable equipment and a return destination, without changing the agreed mission automatically.
Combat opportunities may include supported wilderness targets; production supply probes remain
conservative about non-wilderness sourcing. No website schema changes.
See [paired assist](../docs/designs/paired-assist.md) for exact limits and review evidence.

### Character → character: item delivery

Current: standing wants track requested quantity and confirmed deliveries; `give` and automatic
handoff handling use the existing trade code. `handoffs.ts` records completed transfers. Separate
banks remain separate even at the same booth. Received items arrive in inventory. Bank notes
stack for transport but must be deposited and withdrawn normally before processing/equipping.

Desired improvement, not yet implemented: model delivery as requested → accepted → ready →
transferred → acknowledged (or blocked/cancelled). Agree the item/count, source owner, safe
rendezvous and receiving capacity before travel. Partial transfers reduce outstanding quantity;
close only on confirmed transfer. Revalidate the target's safety and availability, expire stale
meetups and use productive fallback work while waiting. Keep this distinct from the maintenance
session handoff below.

### Runtime → maintenance reviewer

Logs and watchdog findings supply evidence; the reviewer decides whether the failure belongs to
requirements, action recovery, coordination, the world index or observation. A repeated impossible
withdrawal is a planning/feasibility failure, not a reason to fabricate the missing equipment. A
camera error belongs to observation, not a character's gameplay failure count. Log source/session
provenance is currently incomplete, so exclude identified test fixtures explicitly.

### Maintenance → next maintenance session

Use [HANDOFF.md](HANDOFF.md). Record the absolute evidence window/timezone and reviewed runs;
current mission and blockers; code commit/branch and whether the process actually loaded it;
validation; any state edits/backups; website/schema dependencies; and one next check. Re-read live
state at the next session: the handoff is dated evidence, not a current-state guarantee.

## Known contract drift (2026-10-27)

- Model-facing completion/cadence instructions now match automatic versus legacy checks and hourly
  councils. New forge missions retain superior/mixed pieces rather than requiring downgrades.
- Feasibility is conservative, not a guarantee of eventual completion: changing shop stock/prices,
  travel danger, burn/failure rates and trade readiness are rechecked by execution. Bank facts are
  still last-seen observations. Full acknowledged delivery coordination remains separate work.
- The watchdog is not scheduled by `orchestrator.ts`; check its actual invocation/heartbeat.
- Tests importing event-emitting modules can write into production `runs/`. A `party` event can
  be synthetic, so filtering bot names alone does not isolate production.

When these contracts change, update runtime prompts, implementation, relevant regression checks,
this file and the session handoff together. Markdown is guidance for maintainers; runtime characters
consume the prompts assembled in `planner.ts`, not this file automatically.

## Productive failure and delivery recovery

Pickpocketing now uses carried-food entry readiness (half maximum HP nominal healing, scaled
for short2–10min sessions). A living character already within4tiles of a known ground-floor
bank, outside combat, can withdraw explicit cooked food despite low HP. Travel, raw supplies and
active combat retain normal danger checks. This does not guarantee safety against future attacks.

The controller and standalone watchdog flag three repeated blocked orders with positive XP,
grouped by character/action/numeric-normalized reason. Controller warnings inspect its bounded
500-event buffer over30min, emit info and queue character notices once per group/30min, then
request council through the existing cooldown. Startup does not mark warnings sent before councils
are ready; the next order_end checks buffered history. A request does not prove a council ran.
No independent watchdog scheduler or outside alert service is installed.

Planning/council contexts show quantified coal-transfer opportunities from observed separate
stocks. The party chooses an agreeing giver/receiver, bounded quantity, meeting point and capacity;
only actual transfer counts. More mining/banking is not delivery. Bulk notes must be deposited and
withdrawn normally before smelting. No supplier is assigned automatically and bank age/current
stock still need verification. See [progress recovery](../docs/designs/progress-recovery.md).

## Learning ownership

The controller initializes `state/learning-pilot.json` once for a 24-hour pilot. Restarting preserves
expiry; after expiry retrieval continues read-only. The planner can author one optional ambition per
character, revise/pause/retire it and attach an explicitly unverified interpretation to an existing
executor observation. Automatic retrieval supplies relevant guide records in existing decisions and
councils. There are no extra model workers; decision output allowance is 1200 tokens.

`learning-pilot.ts` owns pure bounded reducers/ranking; `learning.ts` owns validated atomic persistence.
Only accepted decisions update intentions. Order-end events supply immutable observations; proposed
targets and prose do not establish visits, deliveries or mission completion. Current game state wins.
The existing mission, standing priorities and readiness/recovery checks still govern execution.
Invalid saved state disables capture with a warning rather than silently resetting the pilot.
Do not edit the cached file while running. Evaluate sustained projects and evidence-driven changes
after a day; entry counts alone are not success. See [design](../docs/designs/exploration-pilot.md).

Follow-up cleanup derives the current routine's named smithing outputs for broad bank deposits;
unrelated carried gear/tools and food reserve are preserved, and explicit item deposits stay scoped.
Production loops stop when only supply shuffling made progress. Note-qualified bank targets match
pack names, and mixed same-name item forms cannot be handed off ambiguously. Characters without
a current/history ambition receive one optional invitation in a normal decision. Accepted decisions
persist `ambitionInvitedAt` in memory; null declines, lookup/rejected proposals do not consume it.

## Supply coverage and replenishment

`SupplyCoverage` is advisory context, not a second planner or inventory controller. `supply-context.ts`
combines fresh character state, dated bank views, supported intended mission work and routines;
`supply-coverage.ts` calculates45min working targets and a below10min refill threshold. Rates use
recent verified whole-order smelting attempts/food use or clearly labelled planning priors. Food
coverage uses healing HP; proposed offers use actual whole fish, with food/own-work reserves.

The controller checks once/minute and queues notices plus existing-cooldown council requests,
maxonce per recipient/item/15min. Unknown/stale banks require verification, not a promise; banks
older than30min are excluded from available supply. Skills retain supported method intent while
on fallback; finite stock goals cap work to remaining needs. Completed delivery history cannot
cover consumed stock. Characters negotiate supplier/receiver/amount/reserve/meeting/capacity and
verify actual trade. No stock is reserved or moved automatically. Competing requests must be
reconciled; the adviser does not implement durable delivery acknowledgment. Existing readiness
still checks usable ingredients, food and note conversion. See [design](../docs/designs/supply-coverage.md).

## Bounded own-stock production cycles

A pure own-bank production routine ending in banking can continue the character's chosen pipeline
when every production stop is `exhausted`. This means a carried batch ended, rather than all owned
inputs vanished. Explicit quantity/time/skill-level production targets, trades, travel and other
activities do not acquire automatic repeat. Existing explicit repeat remains character-owned.
Continuation needs actual productive progress, fresh state and a dated own-bank recipe proof;
recursive capacity accounts for multi-bar recipes and banked intermediates. Ambiguous carried
notes do not authorize another cycle. No external supply, method change or new raw purchase is
chosen by this mechanism. Pass/step starts respect the30min invocation window; ordinary readiness,
no-progress stops and council/shutdown interruptions remain. Restart resets the invocation window
as existing routine execution did; no durable across-restart deadline is claimed.

`order_end.productionBatch` and readable reports distinguish observed carried inputs, known bank
stock and verified recipe capacity. Capacity is not a promised output. Supply advice recognizes
own upstream production instead of requesting intermediate bars from teammates. Exact known
craft/fletch/smith outputs join broad cleanup; unrelated gear/tools and food reserve remain scoped.
See [design](../docs/designs/production-cycles.md).

## Scheduled operations reviewer

The user authorized an hourly maintenance loop with tested local fixes/commits on2026-10-29.
`maintenance/review.py` runs an independent Codex CLI maintenance session via its own LaunchAgent;
it is outside party gameplay and runs only at the scheduled times. See
[operations setup](maintenance/README.md) and [design](../docs/designs/hourly-maintenance.md).
It preserves character choice, budgets and save/restart rules, stages only its own changes, and
does not push/merge or publish reports. Reports stay local. Unknown dirty work means read-only
review; the scheduler lock serializes its own jobs but not human coding sessions. Pausing stops
future reviews and lets a current deployment/review finish safely. OS filesystem access is separate
from Codex approval settings; a loaded job is not proof an hourly review has completed.

## Seven-day discovery extension

The user authorized the [discovery week](../docs/designs/discovery-week.md) after the original pilot
expired. Maintenance renews once explicitly while the controller is stopped; startup never extends
expiry. Original observations, ids, ambitions and accounts persist. After expiry retrieval is read-only.
Executor observations now include fresh coordinates, nearby names/options and actually read dialogue
for look/interact/choose/use. Dispatch result is separate; seeing dialogue is not proof an interaction
worked or a quest completed. World evidence has24protected slots within the existing128record cap.
Characters may propose optional5–10min outings alongside long goals, fulfilling or renegotiating
accepted deliveries first. Up to3bounded suggestions use real nearby NPCs/indexed spots in ordinary
decisions; they do not promise route access or override readiness. Character-authored test assessments
cite source and result observed after the hypothesis; both remain unverified and old evidence is dated.
Existing3500character guide cap, configured spend ceiling and safety/fashion/mission ownership remain.

## Shared expedition mission policy

The user rejected solo Smithing90 as the party objective on2026-10-30. Live context now shortlists
shared [regional expeditions](../docs/designs/shared-expeditions.md), keeping legacy training/reserve
templates diagnostic and personal training actions available. Every participant contributes an
actual in-region survey and a practical test; the group needs three different activity types.
Named contribution ownership stays with that participant, while method/partner choices are theirs.
There is no added five-achievement ladder. Armour/fashion remains standing. Old unfinished missions
are explicitly retired with objectives/reason preserved; never marked complete by rescoping.
Executor records fresh productive XP locations only during active expedition orders. Order start
must be after acceptance; old running work, endpoints/prose, starter fights and smithing do not
satisfy field checks. Current-plan proofs are bounded, deduplicated and independent of learning
pilot retention/expiry. Council reload/merge preserves event proofs across awaited discussions and
failed replacement voting, keyed by mission and acceptance timestamp. Tool/food/funding loss calls
for recovery, not silent retirement. All-party fieldwork is parallel, not waiting on M1's owner.

## Prepared combat charter (2026-10-31)

User authorized staged guard→white-knight progression and total cap19.50USD. This supersedes the
regional shortlist as current mission policy. Hunt Check owns immutable acceptance/preparation/stage
cutoffs and bounded structured proofs in plan. Actual assist callback reports mapped shared target;
FightObservation emits bounded fresh per-target defeat positions/times/identities. Matching source
run, leader routine, NPC index/id and <=30sec separates corroborated paired encounter from prose or
old XP. No shared kill credit is claimed. First stage requires simultaneous food/equipment preparation;
knight starts after guard evidence, and both matching fighters must return to Falador east bank.
Council merges preserve proofs and cutoffs across awaited rounds. No five-achievement append or
automatic escalation after completion; operator review chooses later targets. Current charter retains
standing armour/fashion and individual safety; weaker members can contribute preparation rather than
being forced into combat. Operator-only rescope flag bypasses automatic cooldown once and clears on
selection. Normal character requests cannot set it. Ledger/expiry/account integrity unchanged.

## Bounded planning overhead (2026-11-08)

Repeated look-only routines at the same actionable scene wait up to two minutes before another
planning call. Scene changes, urgent messages, handoff arrivals, interruption, health or combat
end the wait. Multi-step look→interaction routines are not delayed. Ordinary repeated council
requests with unchanged mission/progress/death facts wait for the hourly review; first/new-signature
requests retain the15min minimum, and operator rescope/progress/scheduled checks keep their paths.
Planner context keeps six board posts, four routes and three bounded recent routine summaries.
Material exclusion expiry remains15min; actual relevant stock changes still invalidate it.

## Operator-directed Guard trial (2026-11-08; current override)

The user retired the unfinished guard→knight charter as a failure of autonomous coordination.
The active live plan assigns Bram/Trish one bounded Guard trial at3006,3322, then report/stop for
operator review, including on failure. No40swordfish/all-party-weapon quota, knight or bank-return
stage. Actual per-character readiness, consent, mapped shared target and retreat remain enforced.
Old charter/proofs are retained in retiredMissions, not completed. The new guard hunt check is
success-only; readyAt is the operator assignment cutoff with no imported preparation or kill proofs.
One-attempt/10min-preparation limits are instructions within existing bounded routines, not a new
durable executor timer. A failed attempt leaves success unverified and must not trigger escalation.
