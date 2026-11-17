# Paired combat assist

Status: Authorized design; focused reviews completed, findings resolved below; implemented and loaded at `7306077`; offline checks/startup verified, shared combat pending.
Owner/date: maintenance assistant, 2026-10-28.
Baseline: `886b89d`. User authorization: “Lets start on that,” following the agreed first
step of paired assist with mutual agreement, a time limit and independent retreat rules.
This authorizes this feature's implementation; it is not approval of every earlier mode.
Affected contracts: agents/LAYERS.md, agents/EGM.md, agents/README.md.

## Problem and success criteria

The party can trade and negotiate, but each `fight` action independently selects a monster.
Two characters training on cows is not evidence they attacked the same NPC. Provide one
leader and one assistant sharing a confirmed NPC target, without assigning permanent roles.
Invitation, following and confirmed shared engagement must be reported separately.

## Boundaries and observations

Agent execution owns routines and cancellation. Character planners own invitation/acceptance
and the choice of partner, compatible with their mission, fashion and safety preferences.
The game owns combat permission and damage. No party goals, accounts or inventories are edited.
No four-character formation, healer/tank guarantee, PvP, new monster route, gear policy, loot
sharing or website schema is added. The server permits shared targets in multicombat zones;
its `multiway.csv` lists 8×8 zones. Single-combat and unknown zones are refused conservatively,
including special forced-multicombat NPCs outside mapped zones in this first version.
SDK player.combat has targetType/index; nearby NPCs have index/config id/tile/HP. Neither XP
nor disappearance alone proves a shared kill. Existing movement/attack helpers are cancellable.

## Protocol

A controller-local AssistRegistry holds at most two disjoint pairs across the four characters.
A character may occupy only one role in one pair. All records expire after 15 minutes including
rendezvous. Records are not persisted; controller restart cancels consent. Saved assist steps
must obtain a new invitation; saved leader invitation steps must replan before inviting again.

Leader chooses a non-repeating routine beginning `invite_assist(target=partner)` immediately
followed by a bounded minutes-based `fight` step of at most 15 minutes. Later steps are allowed
but end consent before they start. Invite is an explicit offer, not a command. Code publishes
one urgent addressed invitation so the partner can make a fresh decision; normal board rate
limits apply and failed publication cancels the offer. The partner may choose `assist(target=leader)`
or continue other work. There is no automatic acceptance. Invite waits at most 60 seconds for
acceptance and rendezvous within four tiles, otherwise cancels with an honest blocker.

Assistant chooses a minutes-based assist step, at most 15 minutes; repeating assist routines
are refused. `assist` accepts only the specifically addressed invitation. Accept is idempotent
across executor passes. Assistant approaches only if both players have fresh connected state,
are alive, on the same ground floor, including wilderness, with distance <=64 tiles.
The rendezvous allowance is 60 seconds; a separated active pair gets at most 20 seconds to
regroup and never pursues a partner beyond 64 tiles. Following uses short, bounded movement
rather than a world-scale route. Near the leader, the assistant waits without choosing a foe.
Leader must be running invite during rendezvous or fight during active work. Other actions end
consent; temporary no-target gaps between fights are permitted for at most 30 seconds.

Before every attack, the leader must be actively fighting a specific NPC; fresh assistant state
must contain the same index AND config id at matching tiles within two tiles, with an attack
option, reachable===true, positive/unknown HP and within two tiles of the assistant. The target
must be in a mapped multicombat zone. Never substitute a monster-name search, another nearby
NPC or a player. Attack dispatch uses SDK sendInteractNpc with the locally validated attack option, never
BotActions.attack (which can walk and then dispatch an old index). Re-read all guards immediately
before synchronous invocation, with no intervening await; require connection state connected to
avoid the SDK reconnection wait. This protects observed state, not an unknowable server change
after dispatch. Movement is watched every 200 ms in a nested abort context; revalidate after it.
Server refusals end this session instead of retrying an illegal join. Leader travelling/retreating
without a target makes the assistant regroup, not keep initiating attacks on the previous foe.

Each participant retains their own tactics. Assistant uses its combat style, eats at its own
threshold, and retreats at its own retreat threshold (no finish-enemy exception in assist v1).
At unsafe HP after eating, leader death/staleness, mismatched target, expiry or ordinary end,
the assistant disengages via existing flee behavior if still in combat. Interrupted/shutdown
execution issues no new attacks; existing cancellation and next-action safety recovery apply.
Leader is not automatically forced to retreat when the assistant leaves; it can continue solo
under its own checks, but the pairing is invalidated and visible to planners.

Registry membership is cleared on either character's routine end, interruption/death, stop or
session expiry, and when a leader advances beyond the agreed fight. An invitation is not
recreated by an assistant resuming. Idle movement is not XP or kill progress. A completed timed
assist routine can have zero engagements; report that honestly. No teamwork achievement is added.

## Observation and side effects

Normal info/chat/order_end events record invite, accepted, ready, ended and confirmed shared
engagement. Notes report cumulative session engagements and follow attempts; ordinary order reports
retain the character's XP. No damage attribution or shared kills are claimed: SDK hitsplat
observations cannot identify which player caused damage in a shared fight. Registry is memory-only. Existing board/memory/events have normal
disk writes. Game effects are movement, style, eating and NPC attack only. No new model service,
SDK schema or Redis/public snapshot field. Context lists current invitations/session and viable
nearby surface multicombat locations from the existing world index, so characters can choose.

## Alternatives and decisions

Prompt-only “fight together” cannot bind exact targets or consent. Persistent sessions risk stale
consent after restart; ephemeral sessions deliberately require a fresh agreement. A single action
that takes control of both characters would override the partner's choices; explicit invitation
and acceptance preserve each planner. Follow-only and four-person expeditions remain future work.
These choices implement the user's accepted bounded paired-assist direction; no formal owner
approval gate is claimed beyond that instruction.

## Implementation plan

- agents/assist.ts: pure registry, fresh-state/target decisions and bounded assist/invite runners
  with injected peer lookup, safety/movement/style/reporting operations; no runtime import side effects.
- agents/multicombat.ts: parse server multiway zone data, conservative tile lookup.
- agents/skills.ts: register invite_assist/assist, wire existing movement, safety, style, flee and party.
- agents/agent.ts: fresh SDK publication timestamps, routine validation, pairing cleanup, bound assist
  times, pass reporting and peer routine/step visibility through current order.
- agents/planner.ts: action/schema guidance, mutual consent and mission-compatible optional opportunities.
- agents/assist.test.ts, agents/multicombat.test.ts: offline protocol, failure and target tests.
- agents/readiness.test.ts: executor validation/cancellation integration where needed.
- agents/LAYERS.md, agents/EGM.md, agents/README.md, docs/designs/SITEMAP.md: actual contract updates.
- docs/designs/reviews/paired-assist.md: actual independent findings and resolutions.
- agents/HANDOFF.md: validation, loaded revision/run, save backup and remaining live checks.

## Acceptance and rollout

Test declined/expired invitations, disjoint roles, self/unknown partners, no automatic consent,
readiness timeout, leader switching tasks, stale/disconnected/dead state, floor/distance
limits and wilderness permission, same-index wrong-config/tile, player targets, single-combat refusal, no implicit new target,
independent HP retreat, event deduplication, cancellation and no unverified kill accounting.
Test real map parsing and a known supported multicombat location without launching gameplay.
Run focused tests, then agent tests/typecheck and diff checks. Tests must use fake state/actions,
never connect characters; importing existing event-emitting test modules can create synthetic runs.
After code review, back up runtime state/saves; graceful stop, verify four saves, launch once.
Verify startup and context/commands loaded within five minutes. Do not force a character's plan
or fake an engagement for live verification. Subsequent actual accepted pairing is the remaining
live check; an absence of voluntary adoption is not a successful combat test. Roll back on unsafe
attacks or runaway movement through a graceful reload, preserving saves and unrelated state.

## Concrete implementation decisions after review

Fresh means SDK getConnectionState()==connected, inGame, both getStateReceivedAt ages <=5,000ms,
and tick skew <=5. Unknown timestamps, coordinates, authoritative NPC tileX/tileZ or reachability
fail closed. Publication disagreement with no assistant combat waits <=3 seconds without attack;
if the assistant is already fighting a different target it retreats immediately. Use Euclidean
distances. Invitation expiry begins on offer; rendezvous deadline is offer+60 s; regroup is first
separation+20s; idle-fight gap is first no-target+30s. Earliest deadline wins. Pass boundaries do
not reset these timers. Invite is oneShot, minutes/1 representation, but its own wait cap is60 s.
Reject invalid assist limits or repeat at routine preflight, including resumed coop routines;
restart discards only saved cooperative routines and requests a fresh planner decision.

Registry records {id,leader,assistant,leaderRoutine,fightStep,created,expires,phase,readyAt,
separatedAt,idleAt,mismatchAt}; phase invited→accepted→ready→active, then deletion. API offer,
accept, get, ready, end(id), cancelMember; monotonically increasing ids prevent old cleanup from
removing replacements. Overlapping/crossed invitations fail instead of superseding another pair.
Leader routine identity and exact fight step bind consent. Invite step is permitted only as the
first step, immediately followed by fight; assist is the only step of its routine. Neither may
repeat. Either party's routine cancellation clears the pair. Entering any other leader step ends it.

Assist-specific safety eats below eat_below then retreats below retreat_below, without danger's
35% cap. Flee recovery is bounded to10 s with its own deadline under the still-live parent signal.
Normal 90s pass rollover preserves consent and combat, while terminal exit flees if fighting.
External cancellation sends no new action; existing executor's next action checks safety.
Short follow movement uses BotActions.walkTo timeout<=3 s, additionally bounded by earliest timer,
under a 200 ms safety/lifecycle watcher. Never use goNear's minimum 20 s movement for assist.

Confirmed shared engagement means both fresh player states simultaneously target the same
validated NPC, not attack submission. Increment once per {session,index,config} while continuously
shared; reset when target changes or disappears. Do not use SDK damage_dealt as attacker evidence: the collector infers it from NPC hitsplats
and facing, and multiple events can share a publication id. Damage attribution is omitted.
Session engagement identity/counters survive intermediate pass rollover; each note carries
cumulative totals because order_end uses the final note. Assist bypasses generic no-XP idlePass detection;
its own deadlines bound zero-engagement waiting. Report zero honestly at every pass.

Buildable phases: (1) pure registry/map/target tests (known barbarian zone3080,3415;
server source rs-sdk/server/content/maps/multiway.csv); (2) injected runners with fake actions,
clock and cancellation tests; (3) skills/executor/planner wiring, integration tests and docs;
(4) typecheck/full regressions followed by graceful rollout and startup evidence.

## Review record

Fresh design critic and readiness reviewers completed. Both identified SDK dispatch, freshness
and safety gaps; readiness also requested lifecycle, pass boundaries, telemetry and phased checks.
The concrete decisions above resolve those findings. See reviews/paired-assist.md. This is a
focused review with author resolutions, not a full five-stage EGM review or independent re-audit.
Design workflow ends before authorized implementation begins; existing implementation authorization
is carried forward, not inferred from artifact status.

## Implementation review resolutions

A fresh codebase-details reviewer inspected actual integration and SDK collector. Four major
findings were resolved: remove unsupported damage attribution entirely (also removes unsafe
publication-id event dedup); retain shared engagement identity and cumulative counters across
90s passes; handle non-cancellation observation/action exceptions as terminal cleanup with
bounded disengagement; retain no-new-actions behavior on external cancellation. Added regression
tests for those behaviors. Ready is deferred while an existing solo fight finishes. Documentation
and test results describe these narrower evidence guarantees; no authoritative damage claim.

## Verification evidence

214 regression tests across28files, typecheck and whitespace checks passed. After changing only
follow-attempt reporting,19 focused tests and typecheck passed again. All four shutdown saves
verified before the graceful reload. Run2026-10-28T14-02-29-898Z started commit7306077 with
fresh heartbeats and all characters connected. Council312 noticed both new capabilities.
Actual voluntary paired combat and its cleanup remain unverified live; see agents/HANDOFF.md.

## Wilderness policy amendment (2026-10-28)

User instruction: “Lets try that I guess. Why do we have a hard wilderness restriction? We can
remove that right?” The initial geographic exclusion was an operator-chosen first-version limit,
not a server requirement. It is now removed for participant coordinates and target NPC tiles.
Consent, fresh state, plane0, local range, exact NPC checks, mapped multicombat and independent
retreat remain. No new session type, persistence protocol or PvP attack capability is introduced.
Hunter candidates may include ordinary supported wilderness monsters with their existing food
chain; their first-kill checks still verify kills, not wilderness visits. Production-chain safeSite
probes retain their non-wilderness supply assumption; this does not prevent intentional travel.

System guidance values exploration alongside training and explicitly permits prepared wilderness
risk. It proposes shallow short scouting trips, food, replaceable gear, banked valuables, a return
point and reassessment. These preferences do not silently edit the active mission, impose a new
depth ban, promise a safe route or verify exploration from prose. Nearby shallow options and
wilderness levels are shown; actual moving target tiles are still checked by the executor.
Regression checks cover wilderness pair positions/target matching, real-zone attack dispatch,
continued player-target exclusion and supplied hunter candidates using wilderness monsters.
First actual wilderness crossing (including any warning UI), encounter and successful return
remain live verification work; passing fixtures cannot establish those outcomes.

Amendment deployment:217 tests/typecheck pass; loaded `b237d0b` in run
2026-10-28T14-41-36-408Z after four verified saves. Startup healthy; actual wilderness
entry and paired encounter remain unverified. Operational details in agents/HANDOFF.md.
