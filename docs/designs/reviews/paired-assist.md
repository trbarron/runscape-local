# Paired assist focused review, 2026-10-28

Target: ../paired-assist.md at baseline886b89d, before implementation.
Fresh fork_turns:none reviewers assist_design_review and assist_readiness_review completed,
reading personas design_critic.md / implementation_readiness.md and corresponding
feature-spec / implementation-readiness standards from third_party/egm. Both inspected selected
agent execution, skills, SDK types/actions and server GameMap loader sources; readiness also
read SDK execution-context and readiness/planner integration. Neither wrote files or ran runtime.

Findings and author resolutions:
- SDK attack helper can walk then send old index: use fresh guarded sendInteractNpc, no await
  between guard and call, connected-only, NPC option only. Watch and revalidate movement.
- Undefined freshness/coordinates:5s ages,5tick skew, authoritative tiles, reachable===true,
  Euclidean distances; short mismatch wait, immediate retreat from a different active target.
- Safety and long movement: uncapped own retreat threshold;3 s movement bounds,200 ms watcher.
- Registry lifecycle: concrete identity/phase/timers and routine-step binding; id-scoped cleanup.
- Restart consent/invite semantics: oneShot60 s invite; no saved cooperative routine replay.
- Idle and recovery: own deadlines; no XP-idle failure; rollover keeps consent, terminal flee10 s.
- Shared evidence: simultaneous exact targets, event baseline/dedup; no kill claims.
- Phasing: four buildable checkpoints with explicit real-zone fixture.

All resolutions are recorded in the target's concrete implementation decisions. No independent
re-audit or full five-stage review claimed. User's existing implementation instruction authorizes
leaving the design workflow for implementation; no extra approval inferred or requested.

## Focused implementation audit

Fresh reviewer assist_implementation_review used codebase_details persona and implementation
readiness standard. Read target design and assist/map modules/tests, executor/skills/planner
integration, SDK dispatch/cancellation/waits and StateCollector combat event publication.
No execution or state mutation. Completed findings:
- Hitsplats are not attributable to assistant: removed damage tally entirely; retain XP and
  shared-target observations only.
- Publication ids are shared across events: removed the damage-event aggregation path.
- Non-cancellation exceptions could skip disengagement: terminal catch + bounded flee;
  regression observation-failure test. Cancellation still sends no new action.
- Continuous fight recounted and earlier notes lost per pass: retain session identity and
  cumulative counters; consecutive-pass regression. Final note contains session totals.

These are author resolutions checked with regression tests, not an independent re-audit.
