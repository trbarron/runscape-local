# Combat provisions and engagement continuity

Status: implemented/tested and loaded at bd86045; startup verified, provisioned trial pending, 2026-10-28; baseline9344b7f.
User approved the proposed food-value notes, team provisioning, actual carried-food readiness and
bounded stronger-monster comparison. No permanent supplier/fighter roles or mission replacement.

Observed failure: white-knight pilots ended without adequate food; five shrimps is treated like
five stronger fish by travel reserve. Existing combat wait can run six immediate low-HP rounds,
then loot/retarget while the old enemy remains alive. Current banks and prose are observations,
not proof food is carried. Existing executor preparation protocol can acquire own-bank supplies.

## Contract

A pure, state-free combat-food module reads fixed healing values for supported cooked fish from
server player/configs/consumption/consume_normal.dbrow. Raw/noted/unknown food contributes zero;
reported healing is nominal capacity (actual eating can overheal), not guaranteed survival.
Generic five-fish travel reserve remains separate. Character context reports carried healing as
max-HP equivalents, own bank quality/options/age, stronger-target entry budget, and teammate-bank
cooked/raw supplies plus qualified cooking/fishing capability. No implied trade or assigned roles.

For fight targets, a shared requirement uses indexed target maximum HP/level: starter monsters
(max level<=3) exempt; otherwise base budget is half max player HP. Targets with HP>=half player
max HP, level>=half player combat, or wilderness-only spawn require two max-HP equivalents.
Minutes below10 scale the budget down proportionally with a floor of2minutes; long/level/count
orders cap the entry budget at the10minute amount. Invite/assist require two equivalents since
partner's eventual foe may vary. Unindexed targets or unknown player maximum HP fail closed; incomplete indexed target stats use the larger budget conservatively. This is an initial
preparation heuristic, not a prediction or repeated per-bite quota. HP/target logic remains owned
by game/executor, roles/preferences by characters. Shorter plans and stronger per-slot food can
meet the same policy; there is no required fish species.

nextPreparation checks fresh carried healing before starting combat. It plans a complete own-bank
withdrawal set strongest-healing-first, accounting for free inventory slots; only then returns the
first acquisition. Never withdraw a useless partial batch or access another bank. A full pack of non-food items returns an explanatory blocker to bank surplus explicitly; no
automatic gear/tool deposits. Automatic loads use at most three food species and at most six
weak-food deposit actions, so acquisition fits the executor's ten-preparation bound. If carried
weak food prevents fitting an adequate load, deposit it only when known own-bank stock makes
the complete plan possible within both slot and action budgets. Otherwise
return an explanatory blocker requesting stronger supplies, a shorter trial or a confirmed handoff.
Actual withdrawals are verified through existing bounded preparation. No automatic buying,
cooking, teammate control or updates to reserve size. At readiness, the food must be carried.

Fresh exact-target engagement takes precedence over the existing XP/reach heuristic: an active
zero-XP fight is not a reach failure. Combat retains the current exact NPC until it is gone/zero HP, deliberately retreats, or the pass
ends. During low HP it eats, rechecks retreat policy, then waits a tick even if eating fails. It
never exits a fixed six-round loop into loot/retarget while still fighting. Each new pass reuses
an active matching target before selecting another. Unrelated combat makes it retreat instead
of treating a different enemy as the selected one. Loot only after resolved target engagement;
no looting on pass boundary. Existing time/cancellation bounds and finish-enemy HP floor remain.

## Alternatives, scope and verification

Prompt-only advice did not ensure carried food. Fixed fish counts ignore value; mandatory swordfish
would override preferences and may depend on unavailable supplies. Reuse existing readiness rather
than add a new mission/session protocol. No website/SDK/schema/persistent state migration.
Files: agents/combat-food.ts/tests, combat-engagement.ts/tests, readiness.ts/tests, skills.ts/combat continuity tests, fight-report.ts/tests,
planner.ts, LAYERS.md/README.md/HANDOFF.md, design index and this artifact. Add a labelled
user request for one provisioned10min comparison via backed-up live plan annotation, preserving
mission/checks/roles. Archive when actual results exist. Report XP, food and observed HP costs
separately from travel/setup and future supply time; no instant optimal-method claim.

Test server healing values/raw rejection, budgets/duration, strongest feasible own-bank choice,
slot accounting/weak-food replacement, impossible-stock no side effects, actual carried readiness,
continuous target through low HP/no food and pass boundaries, retreat, no premature loot.
Run focused then full checks/typecheck. Graceful reload with backup and four verified saves.
Verify healthy startup; actual provisioned trial/food supply/return remain separate live evidence.

## Focused review

Fresh reviewer combat_food_review read design critic persona/feature-spec standard, full design,
execution/readiness/combat/banking sources and consumption config. Two major findings resolved:
complete plans must fit ten preparation actions (bounded types/deposits, no partial non-food slot
clearing), and active exact-target combat must override no-XP reach failure. Add corresponding
regressions. This is focused review plus author resolutions, not a full five-stage review.

## Focused implementation audit

Fresh codebase-details reviewer combat_food_code_review read the target design, food/continuity
implementation/tests, readiness, skill/SDK integration and planner context without execution.
Two major findings resolved: all auto food withdrawals/deposits now use explicit cooked matching
so Raw swordfish cannot satisfy a cooked stock plan; active/tracked combat is checked BEFORE
initial spawn-location navigation on each pass. Regression tests exercise raw-first bank order
through the actual withdrawal matcher (stop before persistence), and pass rollover far from the
indexed spawn with navigation forbidden. No independent re-audit/full lifecycle claimed.

Validation:238 tests across31files, agent typecheck and whitespace checks pass. Focused tests
include actual cooked-bank matching, active zero-XP combat and far-from-spawn rollover. Nominal
food-consumption capacity and per-kind counts are additive order_end.fight fields; actual HP
restored and end-to-end supply economics are not inferred from them.

Deployment: run2026-10-28T20-39-17-131Z loadedbd86045 after four verified shutdown saves;
all characters resumed and heartbeats are fresh. Labelled live-plan request for one provisioned
comparison is visible; actual supplies, transfer, fight and return remain pending. See HANDOFF.
