# Runtime continuity and productive execution

Status: Implemented; offline checks passed; local service rollout recorded in the handoff.
Date: 2026-10-27. Baseline: `7b446a5` plus the session working tree.
Authorization: user approved durable supervision, honest execution outcomes, capacity-aware
crafting batches and personal production before unnecessary handoffs: “Lets implement them now.”
This implementation record does not claim an independent EGM review or human spec approval.

## Evidence and responsibilities

The [post-Smithing review](../../agents/reviews/2026-10-27-post-smithing.md) found the
controller absent while its game clients remained connected. It also found productive
20-minute steps labelled stale, short withdrawals followed by oversized crafting targets,
and a one-bar trade dependency despite an available personal smelting chain.

Operations owns process recovery. Execution owns honest outcomes and bounded batches.
Mission feasibility proposes supply chains; characters retain their goals and choice of work.

## Process contract

The macOS user LaunchAgent `com.trb.runscape-rascals` starts `agents/supervisor.ts`, with
absolute paths, a 30s launchd throttle and a 360s shutdown allowance. It runs while the
user is logged in. `agents/service.ts install|start|stop|status` manages it. Other hosts
must provide a system supervisor around `agents/run.sh`.

The supervisor claims an exclusive PID lock, publishes a heartbeat every 10s and starts
one controller. The controller publishes its own heartbeat every 5s, including PID,
supervisor PID, start time, phase, run directory, character names and the private browser
endpoint. That heartbeat file (`agents/state/controller-heartbeat.json`) is written with mode 0600
and is not part of the public snapshot. The supervisor keeps its own heartbeat file
(`supervisor-heartbeat.json`) with phases `recovering`, `running`, `stopping` and `stopped`, and
runs the controller under `caffeinate -i`. The orchestrator refuses to start if another live
controller owns the heartbeat.

A controller gets 180s to reach running state (no matching heartbeat, or still `starting`). A heartbeat older than 90s requests
graceful termination; an unresponsive child gets up to 180s before SIGKILL. Every child
exit records code/signal in `agents/runs/supervisor.jsonl`; normal output also persists in
`service.log`. Unexpected exits restart after 10s, including an unexplained zero exit.
An explicit service stop unloads the job and stops restarting it.

Recovery stops an orphaned supervised controller before replacement. It closes only a
recorded browser whose non-blank pages are all at the game origin and carry a `bot` parameter
naming a recorded party member. It then waits up to 150s for every character save (`.sav`
modification time) to be newer than the browser close, or newer than the old heartbeat when no
browser was reached.
If the browser cannot be reached, fresh saves plus gateway-confirmed dead sessions are
required. Unknown ownership, another living supervisor, active clients or missing fresh
saves block login and produce a recovery diagnostic. No inventory/level/goal edits occur.
Blocked recovery is retried every 30s. The supervisor repeats recovery in a `finally` block on
shutdown and logs `shutdown-recovery-blocked` on failure. Startup before browser registration
needs no character recovery.

This supervises processes and connection ownership; it does not prove mission progress.
The gameplay watchdog remains a separate diagnostic command.

## Execution and supply contracts

`yielded` means measured work progressed but its 20-minute budget expired. The target
is unfinished and the planner may resume at the same step. `stuck` means no measured
work progress, including three consecutive passes without progress. Minute-based goals still finish normally when their time expires.
`partial` means useful crafting output was produced but remaining inputs are unavailable.
Neither outcome declares a skill/count target or mission milestone complete.

Before a withdrawal followed by production (smelt, smith, cook, craft, fletch or firemake,
non-noted non-stackable items), execution bounds its current batch by free slots, reusable
tools and recipe input ratios, never above the step's stated amount. A zero-unit capacity
defers to ordinary readiness clearing. It skips already supplied batch inputs.
For example, 22 available ingredient slots fit seven steel recipes: 14 coal and seven
iron ore, rather than 22 coal followed by an impossible 11 iron ore. The original smelting
target remains 11; execution replenishes remaining available own-bank inputs between
passes. Events distinguish requested, current-batch and received withdrawal quantities;
short bank stock remains explicit. Genuine failures still block, and missing supplies
are not fabricated.

Supply feasibility first probes a named worker's complete personal chain, when a recipient is
given, no probe is already active and the party has more than one member. The probe
restricts workers and holders to that character. If it succeeds, no teammate rendezvous
is introduced solely to consume external stock. If it fails, all tentative work,
reservations, purchase counts and spending are rolled back before shared-chain planning.
Necessary trades remain supported with existing ownership/capacity safeguards.

### Confirmed stochastic smelting outcomes

The iron-smelting repair extends `yielded` to a bounded expected-loss retry budget,
as well as a productive time budget. `SmeltingObservation` subscribes only during a
smelting order and counts explicit fresh server outcomes, deduplicated by observation
ID or a legacy tick/text/occurrence identity. The optional `order_end.smelting` report
contains resolved attempts, actual bar types, recipe-confirmed consumed inputs, iron
impurity failures, reach failures and the current consecutive-loss count. These are
observed outcomes, not estimates of unseen attempts or SDK calls.

Ordinary iron impurity messages prove the furnace processed ore, but produce no bar
or XP. They bypass the generic three-idle-pass diagnosis only for iron requests with
fresh confirmed impurity evidence and no intervening reach evidence in that pass.
Ten consecutive confirmed losses abort the current pass and yield for another decision;
a successful bar resets the consecutive-loss budget. The original target remains fixed.
Losses do not set measured XP/item progress, and goal completion still uses game state.
Time limits still apply. Ore exhausted after losses is partial; real level requirements,
reach errors and empty attempts keep their actual failure paths. Observers are removed
on completion, interruption or exception.

For smelting with observed outcomes, summaries use recipe-confirmed input consumption
instead of net inventory decrease, which understates use after automatic bank resupply.
Steel's raw-iron-plus-coal recipe does not have the iron-bar impurity roll. Tests cover
message evidence, repeated frames, retry limits, actual completion, missing ore and real
errors; a separate local-server fixture verified 10 ore consumed, 3 bars, 7 impurity
losses and 37 displayed Smithing XP, without modifying party characters.

## Verification and rollout

Offline checks cover yield versus completion, retained batch goals and ingredient ratios,
partial output versus actual completion, failed personal-chain rollback, heartbeat expiry,
fresh-save requirements and launchd configuration. An isolated process fixture kills a
controller and verifies replacement, then kills the supervisor and verifies its orphaned
child is stopped before replacement. It uses a temporary directory and no game accounts.

For the initial rollout, back up state/saves, identify exclusively party-owned legacy
browsers, verify no gateway controllers remain, close those browsers and verify all fresh
saves before installing the LaunchAgent. Verify the plist, launchd parentage, fresh
heartbeats, all four ready characters and the local dashboard. Do not inject completion
claims or replace the party's mission. The handoff distinguishes offline checks, loaded
code and observed live behavior.

No public snapshot schema change is required: new outcomes stay in existing event/summary
strings, and optional withdrawal details remain event metadata. The website consumes the
published summaries; controller heartbeat/private browser state is not published.

Rollback: unload with `bun agents/service.ts stop`, wait for stopped state and fresh saves,
then restore source or use the interactive supervisor. Never overlap controllers.
