# Bounded own-bank production

`production-cycle.ts` can continue a character's chosen own-bank pipeline across
carried batches. Eligible routines contain supported exact production, only
own-bank preparation/deposits/equipment, a final bank step, and `exhausted` production
stops. Explicit quantity/time/level quotas and trade/travel/buy/combat routines do
not acquire automatic repetition. Explicit character-selected repeats retain their
meaning.

Continuation requires a productive lap, fresh game state, a bank view at most
30 minutes old and owned inputs for a complete recipe unit. Recheck before each
step within the existing 30-minute invocation window. Stop on depletion, unknown
stock, failed readiness, no progress, council interruption or shutdown. Restart
resets the invocation timer; it is not a durable cross-restart deadline.

Capacity accounts for downstream ingredient ratios and banked intermediates.
Ambiguous carried notes do not prove usable supply. Estimates cap at 2,000 and say
“at least” at the cap; capacity is not guaranteed output. Iron impurity losses and
runtime hazards still apply. No new method, external donation or purchase is chosen.

`productionBatch` order metadata distinguishes the finished carried batch from
known bank stock and estimated recipe capacity. Supply advice removes intermediate
inputs produced earlier in the chosen pipeline while retaining raw-input shortages.
Planned bars are not present stock. Resume recomputes from current facts.

Automatic banking includes exact known outputs and preserves unrelated gear, tools
and food reserves. Explicit deposit targets remain scoped. Concise prose retains
typed output/input/failure counts and bank timestamps. Tests cover quotas, stale
stock, notes, ratios, progress, interruption and real executor continuation paths.
