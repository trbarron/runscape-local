# Progress and recovery signals

`progress-signals.ts` groups blocked order outcomes with positive XP by character,
action and numeric-normalized reason. Three repeated blocks can signal a recovery
problem even when useful work occurred. Done, yielded and partial outcomes do not
trigger this rule.

The controller checks its bounded 500-event buffer over 30 minutes, emits one
warning per group per 30 minutes, queues notices and requests council through the
existing cooldown after startup. A request does not prove a council ran. Restart
resets deduplication; busy logs can evict earlier evidence. The standalone watchdog
also includes this check but needs separate invocation.

Pickpocket entry requires half maximum HP in nominal supported cooked-food healing,
scaled for short sessions. A living character within four tiles of a known ground-
floor bank and outside combat can withdraw explicit supported cooked fish despite
low HP. Raw food, travel and active combat never receive that exception.

[Supply coverage](supply-coverage.md) provides current replenishment advice. Actual
transfers require agreement, capacity and confirmed trade. Notes must be converted
through a bank before processing. No historical receipt establishes current stock.
