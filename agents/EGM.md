# Party controller contract

Status: observed baseline at source commit `7b446a5`, 2026-10-27. This is a scoped architecture contract, not a lossless reimplementation specification.

## Scope

service.ts and supervisor.ts own persistent process supervision and bounded session recovery;
orchestrator.ts owns client startup and character-loop supervision; agent.ts owns character
execution; council.ts owns shared planning. See [runtime continuity](../docs/designs/runtime-continuity.md)
for the implemented extension to this baseline.

## Interface

planner.ts proposes structured decisions; skills.ts executes SDK actions. missions.ts and mission-chain.ts enumerate and validate mission candidates. opportunities.ts caches the menu; mission-coordination.ts assigns accountability. dashboard.ts and lanes.ts publish observations.

The optional [paired assist protocol](../docs/designs/paired-assist.md) uses ephemeral invitations
and agreement between character planners. assist.ts owns bounded pair state and exact-target
execution; multicombat.ts reads server zone facts. Routine end/restart clears consent, and saved
cooperative routines require replanning. Shared target observations do not prove kills or damage
attribution. Existing snapshot fields display routine/activity and log evidence; no schema added.

## Invariants

A model proposal is not proof of completion. Automatic milestone checks use observed facts. Coverage ownership does not prove that the owner accepted or can execute its next task.

## Side Effects

Execution changes game state. store.ts writes local state; events.ts creates run logs, including on import. Publication writes Redis and optionally S3. Avoid runtime imports during documentation checks.

## Verification

For implementation changes use the scripts in package.json and the focused tests for the changed module. Documentation-only validation checks links and source claims without executing runtime modules.

The optional 24-hour [exploration pilot](../docs/designs/exploration-pilot.md) stores self-authored
intentions separately from immutable executor observations and unverified interpretations. It adds
context to existing planners, not another controller or mission-completion authority. The authorized
[discovery week](../docs/designs/discovery-week.md) renews it once explicitly, captures world/dialogue
evidence and supports later test citations and optional discovery suggestions.

[Supply coverage](../docs/designs/supply-coverage.md) replaces coal-only recipe-sized advice with
estimated working buffers and existing-cooldown council requests. It owns no inventory or roles;
confirmed trades and fresh/dated stocks remain separate evidence.

[Production cycles](../docs/designs/production-cycles.md) continue only the chosen eligible own-bank
pipeline under bounded executor checks. Carried-batch exhaustion is distinct from bank depletion;
explicit production quotas and character method choices remain authoritative.

[Shared expeditions](../docs/designs/shared-expeditions.md) replace solo level/stock ladders in the
live party shortlist. Automatic checks require post-acceptance surveys and productive field evidence
from all four, with method diversity. Current plan owns progress; learning guide owns interpretations.

The [prepared combat charter](../docs/designs/demon-challenge-brief.md) is the current user-authorized
mission policy, replacing repeated region checklists.19.50USD local total cap retains ledger spend;
source-correlated hunt/return proofs require post-preparation staged activity and never kill-credit prose.
