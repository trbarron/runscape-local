# Supply coverage and replenishment

Status: authorized implementation design, 2026-10-29. User approved systematic working supplies,
early replenishment, current readiness distinct from delivery history, and character-negotiated roles.
Baseline: 01467ff; council340 treated a historical71coal delivery as continuing coverage after it
was consumed. Existing advisory only suggested12bar batches. No new user approval gate is implied.

## Contract

A pure calculator receives observed stocks (owner, carried, bank, bank timestamp), supported
work-input demands, and recent measured throughput when available. It reports estimated minutes
covered, 45-minute working target and a below10-minute refill threshold. Unsupported/unknown work
is omitted rather than supplied with invented ingredients. Priors are explicitly estimates, not
measured XP/hour or completion guarantees. Only executor smelting attempt and food-consumption
reports supply measured rates initially; other supported consumables use labelled priors.

Demand comes first from supported intended work for owners of open mission milestones, then
current remaining routines (full pipeline when repeating). Keep mission work visible while a character performs fallback. Do not create
new projects from inventory alone. Use existing workRequirements for recipes/tools/levels; tools
and reusable moulds are not consumables. Fishing's30bait readiness buffer is not30bait per catch:
use one bait/feather per estimated catch. Food uses observed consumption if available or a labelled
prior and supported cooked-food values. Existing combat readiness still governs carried loads.
Inputs produced by an earlier pipeline step are not requested as external stock as well. Shared
requirements use max demand, not summing alternative routines; rank mission demands first.

Stock is last observed, not a bank reservation. Bank views older than30min are unknown for supply
promises; show their age and ask verification. Fresh noted carried stock can be transport stock but
is not ready for processing; the readiness executor remains authoritative. Missing data is unknown,
not a confirmed zero. No donor bank, recipient inventory or mission is changed by calculation.

Below10min coverage (including depleted stock), suggest replenishing toward45min. Never count
historical handoffs or old council prose as current stock. Show candidates and a bounded suggested
amount, limited to observed available surplus. Provisional donor reserve is max(own demand target,
25% stock,10items), capped to stock; characters can negotiate a different reserve. No exclusive
reservation or sum of multiple donors is promised. Simultaneous suggestions require reconciliation
at council. Demand target is capped2000units/item and co-input stock where known, so no infinite
buffer/method with unavailable inputs is silently promised. Unknown co-inputs do not guarantee work.

No persistent new delivery state, automatic assignment or transfer. Existing wants, agreements,
trade confirmations and mission checks retain their roles. On low coverage the existing controller
notices/council request mechanism is used, deduplicated15min with current-stock rechecks each minute;
existing council cooldown still applies. Startup must not consume alerts before overview ready.
A completed trade can fill the buffer; consumption may reopen it. Fallback does not close a shortage.
Contexts replace the old12bar coal-only advisor and explain completed delivery vs present coverage.
No extra model worker or per-minute model call; council uses its existing15min cooldown. No website
schema, save edit or goal replacement.

## Validation and deployment

Pure tests: bulk sizing, low/high thresholds, depletion after receipt, provider reserves, stale and
missing stock, same-item alternative demands, co-input cap, no supplier, food/feather adapter, rates.
Integration: actual open-mission inputs survive fallback; filled/completed goals stop old demands;
notices defer startup/deduplicate/reopen and cannot recurse; existing full tests/typecheck.
Graceful rollout: backup state/players, four verified fresh saves, reload; inspect live stock reports,
first warning/accepted council, and eventual actual trade and downstream work separately. No human
approval or full five-stage review is claimed from writing this design. Rollback removes advisor
and hooks through normal reload; existing state remains compatible. Runtime limits: no durable
supply reservation/acknowledgment protocol, timing estimates imperfect, bank observations age.

## Focused design review and author resolutions

Fresh supply_design_review read the design-critic persona, feature standard and selected source.
Demand uses missionSupplyWork per open milestone: skill objectives retain their recorded supported
method filtered by worker/action/skill rather than switching recipes on depletion; when absent,
rebuild a supported skill chain. Finite stock objectives use a fresh chain and cap quantities to
the actual shortfall. Completed skills and unrelated flattened work are excluded. Legacy flattened
work has no milestone IDs: two open objectives for the same worker/skill share supported method
candidates, which are advisory alternatives, not separately reserved projects. Other objective kinds use current routines; no chain is invented for them.
A separate SupplyActor/BankView adapter preserves ages/unknown banks; aggregates owned transport
stock for logistics only, never claiming noted items are process-ready. Readiness remains separate.
Unknown recipient banks produce verification guidance, not confirmed-low alerts; stale donor banks
are excluded. Co-input caps use positive known co-input quantities; zero/zero inputs retain provisional
working demand rather than suppressing both. Earlier smelting removes only the matching intermediate
bar request while retaining upstream input shortages; planned production is not present supply.

Priors:2work units/min,4fish catches/min; one bait/feather per catch. Smelting uses median of last6
matching action/recipe outcomes in2h, finite positive resolved attempts, duration>=20s; clamp0.1–60
units/min. Food uses healing HP/min from matching action/target whole-order food reports in2h,
or max(1,maxHP*0.1)HP/min prior. Stocks aggregate supported cooked fish into nominal healing HP;
requests must select real fish/counts using their healing values. Demand persists at zero stock. Zero consumption does
not establish perpetual coverage. These are planning estimates; no station throughput guarantee.
Minute tick is independent of events. Alerts are per receiver/item, maxonce15min even if filled and
depleted sooner; filling does not emit, next low tick after cooldown reopens. Startup does not consume
alerts. No-supplier low coverage still requests sourcing council; unknown banks request verification
in context only. Existing council cooldown may delay negotiation. Shutdown stops checks.

Alternatives: expanding only the coal string misses food/feathers and leaves history/current-stock
confusion; readiness-only refill waits until work is blocked and cannot withdraw a donor's bank.
A durable reservation/acknowledgment protocol could prevent competing promises, but would require
new delivery-state reconciliation and account for cancellation/restarts. This scope reuses council,
wants and confirmed trades; advisors do not reserve or allocate competing stock. Focused critique
with author resolutions only, no full five-stage/re-audit claim. No new permission gate overrides
the user's existing implementation authorization.

Focused supply_code_review found Feather/feathers mismatch, disappeared zero-food demand, feasibility
reconstruction hiding intended work, stale-peer global suppression and narrow intermediate exclusion.
Author fixes: canonical Feather stock key, food as healing-HP coverage even when depleted, retained
skill-method intent, fresh workers independently assessed, and supported fish/chop/smelt intermediates
excluded while their external inputs remain. Repeating routines include their full pipeline. Tests
cover these specific cases. No independent resolution re-audit or durable reservation claim.

Final focused code recheck identified fractional food offers, missing upstream jewellery smelting,
and equal-capped demand rate ties. Author fixes: food reserves retain at least the healing value of
10 actual owned fish (or all stock when fewer), and candidate offers contain whole fish counts;
Crafting keeps gold smelting, while Smithing smelts must match recorded smith recipes; equal target
amounts retain the faster consumption rate. Focused tests cover all three. Legacy flattened work
still lacks exact project IDs; compatible supported methods for the same worker/skill may share
advisory coverage. This limitation is not a durable assignment or reservation guarantee.
