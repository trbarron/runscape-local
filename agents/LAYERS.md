# Layer responsibilities

This contract describes source behavior. Deployment status and active operator
constraints belong in the ignored local `agents/HANDOFF.md`.

| Layer | Responsibility |
| --- | --- |
| Operator | Purpose, constraints, spending, deployment scope and explicit rescoping |
| Maintenance | Diagnose failures, improve code, validate changes and verify authorized reloads |
| Council | Choose feasible objectives, negotiate ownership and preserve unfinished goals |
| Character planner | Choose routines and partners, respond to blockers, retain preferences |
| Executor | Validate fresh readiness, run bounded actions and report observed outcomes |
| SDK/game | Authoritative inventory, equipment, movement, combat, skills and saves |
| Dashboard/website | Publish observations and timestamps without controlling characters |

## Evidence and ownership

Fresh game state is authoritative. Bank views are dated observations, not reservations.
A planned or promised transfer is not a confirmed delivery. Automatic milestones use
code checks; legacy freeform completion by council claims is a separate evidence class.
Keep targets and unfinished goals intact when execution is blocked or yields.

The planner selects routines. Deterministic code checks levels, recipes, supply,
capacity and safety before execution and rechecks changing facts. Relevant stock
changes invalidate remembered blockers; unrelated bank refreshes do not. Recovery
must not invent stock, alter preferences or silently replace the shared objective.

The council owns negotiated roles. Supply advice and production continuation do
not assign permanent suppliers or authorize another character's bank access.
Paired combat requires current consent and an exact locally corroborated target.
Observed defeat does not establish shared kill credit.

## Contracts

- [Mission coordination](../docs/designs/mission-coordination.md): feasible offers,
  stable objectives, ownership and evidence.
- [Production cycles](../docs/designs/production-cycles.md) and
  [supply coverage](../docs/designs/supply-coverage.md): own-bank continuation,
  capacity estimates, dated stocks and negotiated replenishment.
- [Combat provisions](../docs/designs/combat-provisions.md),
  [paired assist](../docs/designs/paired-assist.md) and
  [hunt evidence](../docs/designs/combat-hunts.md): preparation, consent and outcomes.
- [Learning](../docs/designs/discovery-week.md) and
  [expeditions](../docs/designs/shared-expeditions.md): immutable observations,
  character interpretations and separately persisted mission proofs.
- [Runtime continuity](../docs/designs/runtime-continuity.md): supervision,
  save verification and bounded recovery.

## Operations and publication

The supervisor owns process recovery, not strategy. The optional scheduled reviewer
is outside the party and operates only within explicit instance authorization.
Read [operations](../docs/operations.md) before installing or reloading services.

Imports can initialize logs or persist state. Inspect files without importing runtime
modules during documentation work. Tests may emit synthetic run events. A source
edit does not reload a running controller.

Publication success, local capture time and current game state are distinct.
Failed capture retains old assets with honest age. The website consumes snapshots;
it never becomes a second controller. Delivery acknowledgment, atomic multi-file
state updates and complete test/live event provenance remain limitations.
