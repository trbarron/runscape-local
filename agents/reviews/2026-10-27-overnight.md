# Overnight review — 2026-10-27

## Evidence and limits

Requested window: October 26, 20:00 through the morning of October 27, America/New_York
(EDT, UTC−04:00). The captured log sample runs from 20:01:10 to 07:56:52 across all overlapping
`agents/runs/*/events.jsonl`, not just the latest directory. The live snapshot was read at
08:02:00. Source reviewed at repository commit `6c568da`.

Read-only review: no restart, runtime goal edit, inventory change or gameplay intervention.
Counts are log observations, not independently re-read server history. XP is summed from reported
step deltas and may include gains during another action (combat interrupting smelting, for example).
Test runs are interleaved with live runs, including events labeled `party`.

## Results

- 26 achievement events; the morning snapshot has 234 achievements.
- Four characters reported 1,840 completed step records, including 167 with `blocked` outcome
  (9.1%). These are step records, not 1,840 successful tasks. Reported XP gains total 575,074.
- Bram: 114 decisions, 33 blocked steps, no deaths; Wren: 109 / 38 / 0;
  Mike: 237 / 74 / 1; Trish: 90 / 22 / 0.
- 31 sender-side trade records end in `: ok`. Receiving records and trade-session messages
  are not added again as separate deliveries. Partial sender deliveries can still say `ok`.
- 17 councils, two without full agreement; three mission selections. Automatic milestone
  completion did trigger new work splits, so that earlier fix is functioning.
- Five observed orchestrator starts in this window. Recent development included deployments;
  a start count is not a crash count. Step interruptions caused by shutdown are not agent errors.
- Model spend events total about $1.04, including development calls in the captured sample;
  this is not an exact isolated production bill.

## Priority 1: feasibility and repeated blockers

There were 50 blocked attempts to withdraw nonexistent bronze equipment from the character's own
known bank: Bram 12, Wren 21, Trish 17, mainly 03:11–04:50. Trish alone tried an absent bronze
med helm 12 times. The executor correctly refused; repeating the same plan was the failure.

Recommendation: keep a recent structured blocker cache per character/action/item/source. Suppress
that option until a relevant fact changes (new stock, completed delivery, bank refresh, level or
route change). Expose a compact explanation and feasible alternatives to the planner. Use a bounded
expiry for unknown facts, not a permanent blacklist. Add non-overlapping tests for unchanged stock,
new delivery and stale-bank refresh. Do not solve this by injecting items or only lengthening prompts.

## Priority 2: coordination coverage and mission continuity

Masters of Two Trades was chosen at 22:22. At 02:44 the scheduled mission session replaced it with
The Bronze Forge; the old skill mission was not logged as completed. Bronze finished at 04:50 and
Iron Forge was chosen at 05:04. The current implementation selects missions on every fifth council,
which is unrelated to the number of unfinished objectives.

At 08:02 Iron Forge had only the exact-three-iron-pieces milestone open. All four visible actions
were training or cooking, with no smithing/delivery/equipping action visible. One snapshot cannot
prove the mission is abandoned, but it illustrates why agreement is not proof of work coverage.

Recommendations:

1. Validate that every open milestone has an owner and feasible next action/dependency, or an
   explicit deferred/blocked reason. Give waiting characters independent productive fallback work.
2. Continue the current mission while it is feasible and making progress. Re-scope on completion,
   explicit user direction or a documented dead end; carry or explicitly retire unfinished work.
3. Build mission opportunities from useful improvement as well as reachability. Bronze should
   not be suggested simply because mixed/higher-tier equipment fails an exact-bronze pattern.
   Preserve fashion and useful bonuses; exact matching sets require an intentional mission choice.
4. Correct the prompt's claim-only completion explanation and half-hour cadence to match the code.

## Priority 3: safer, acknowledged deliveries

The log includes 11 blocked `trade failed:` outcomes for busy, absent or full recipients, as well
as an explicit unsafe rendezvous near jail guards. Mike died at 02:54 shortly after trading there;
Wren had warned that guards were interrupting trades. That sequence supports a safety/readiness
problem, though the log does not identify a confirmed killer for Mike's death.

Recommendation: a small deterministic delivery state machine with a safe rendezvous, giver/receiver
acknowledgment, stock and slot checks, partial-quantity accounting and an expiry. Recheck danger
before and during waiting; do not stand in combat while negotiating a trade. Use bank notes where
supported, and verify unnoting before smithing/cooking/equipping. See the layer contract for the
proposed states. This is runtime delivery, distinct from a coding-session handoff.

## Priority 4: supervision and trustworthy review inputs

- `watchdog-seen.json` last recorded an invocation at 21:29 on October 26. No later invocation is
  recorded there, and the orchestrator does not schedule it. A watchdog file is not overnight
  monitoring. Verify the actual external schedule, then arrange periodic checks and durable
  machine-readable alerts within the intended operating environment.
- Of 17 error events in the sample, 12 are from `readiness-test` and two `party` errors are the
  expected invalid-portrait-version fixture (`../x`). The remaining three are live planner/reflection
  errors. Do not count the 14 synthetic errors against gameplay or trigger operational recovery.
- Add isolated test event sinks/run directories and event provenance (live/test, session and build).
  Reporting should join actual live sessions, preserve deployment boundaries, distinguish operator
  shutdowns and show unresolved repeated blockers and objective coverage, not just raw error counts.

## Not first priorities

Four iron-platelegs smithing timeouts, other smith-interface failures and invented place names
(e.g. “Varrock west anvil”) merit targeted investigation. They do not explain the bulk of cross-party
coordination churn. The overnight atlas/shop/stackable-withdrawal fixes are already on disk and
were included in later starts; do not re-propose them as if still absent. Inspect post-deployment
samples before attributing old failures to current code.

## Recommended order

First fix prompt/contract drift and isolate telemetry, then add blocker suppression and objective
coverage. Next implement delivery readiness and mission continuity/usefulness. These are proposals;
this review only adds documentation. Use small changes with a baseline and an explicit post-load
verification, rather than deploying all interventions at once.
