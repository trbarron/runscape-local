# Productive failure, food recovery and delivery guidance

Status: implemented/tested, loaded at a545d82, 2026-10-29; baseline06a6433. User: “Lets make those changes.”
Scope: extend existing readiness, council guidance and overview; no new delivery state protocol.

Observed:127 blocked fight orders with positive XP escaped the watchdog's zero-XP filter;
Wren repeatedly pickpocketed without food and then could not withdraw her banked trout at low HP;
coal accumulated in supplier banks while Mike's bank remained empty. Existing post-kill combat
fix is loaded but has not been verified in a subsequent live fight.

Requirements/implementation:
- Pickpocketing uses the existing healing-readiness mechanism: half maximum HP nominal cooked-fish
  healing at entry, scaled for2–10min and capped for longer goals. It does not waive independent
  danger checks or promise food will last forever. Rest/replenish between bounded sessions.
- Only withdraw_from_bank targeting explicit cooked supported fish, within4tiles of a known bank,
  plane0, alive and not inCombat, may bypass the initial low-HP danger gate. Raw food, travel and
  active combat never bypass it. This recovers access to carried supplies, not remote travel immunity.
- progress-signals.ts groups blocked order_end with positive XP by bot/action/numeric-normalized
  reason. Three in the time window warn even though useful work occurred. Yield/partial/done do not.
- Standalone watchdog includes this check. Controller subscribes to order_end, checks the last30min
  in its existing500-event buffer, emits one overview info warning per group/30min, queues notices,
  and requests council through the existing15min cooldown only after normal council startup.
  No recursive order_end emissions, direct role assignment or claims that a council ran when
  throttled. Restart resets warning dedup; the bounded buffer can miss old bursts in very busy runs.
- Pure coal guidance uses observed own ore/skill and party coal. It proposes up to12bars' missing
  coal, names potential suppliers and requires agreed giver/receiver/count/meeting/capacity plus
  confirmed transfer. Notes allow bulk transport but must be deposited/withdrawn normally to smelt.
  Facts are cached bank observations, not a promise. No automatic supplier choice or cross-bank access.
- Queue labelled live-plan request for one actual coal handoff and one provisioned5min combat
  verification; character choices retained. Back up state, preserve mission/checks/roles, verify saves
  before graceful reload. No new persistent schema/website fields/SDK changes.

Alternatives: more generic prompts did not make banked stock a delivery; direct assignment would
replace character choices. XP-only health hid execution regressions. Full delivery protocol is
larger than this authorized extension and remains future work.

Files: progress-signals.ts/tests, combat-food.ts/tests, agent.ts danger bypass, planner.ts context,
watchdog.ts, orchestrator.ts hook, LAYERS.md/README.md/HANDOFF.md and design index.
Acceptance: positive-XP repetition/normal outcomes/window separation, quantified unaccepted
handoff guidance, pickpocket budget, safe-bank-only cooked-food recovery; full regressions/typecheck.
Live: fresh startup, actual deliveries and multi-kill combat order remain separate evidence.

## Review resolutions and checkpoints

Focused fresh reviewer progress_recovery_review inspected selected code and EGM readiness standard.
No concrete broad safety bypass or recursion bug found; missing hook integration tests and startup
suppression semantics were major findings. Resolved by injected createProgressMonitor and harness:
pre-startup events are not marked sent; the next order_end after readiness scans the existing
bounded history. Requests throttled by council are not claimed as completed councils and will be
eligible again on next warning after30min. No background retry bypasses council cooldown.

Phases:1 Create progress-signals.ts/tests and modify combat-food.ts/tests; isolated pure facts,
readiness and hook tests pass.2 Modify agent/planner/watchdog/orchestrator with injected startup/
dedup/notice/request wiring, full regression/typecheck.3 Modify LAYERS/README/HANDOFF/index and
this design (no deletions), back up and load, verify startup and preserve accounts.4 Verify actual
coal transfer and multi-kill provisioned fight from live events. No independent re-audit/full EGM
lifecycle claimed; actual user implementation authorization is retained.

Validation:249 full regression tests, typecheck/whitespace passed; final strict unknown-combat
food-recovery guard additionally passed13 focused tests/typecheck. Loaded run
2026-10-29T12-51-43-026Z after four saves. Healthy startup; actual coal transfer and combat
verification remain pending. Consolidated live request verified, mission/checks/roles preserved.
