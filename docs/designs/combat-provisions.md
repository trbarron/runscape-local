# Combat provisions and engagement continuity

Source contract; deployment and instance objectives are recorded locally.

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
