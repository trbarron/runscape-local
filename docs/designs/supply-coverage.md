# Supply coverage

`supply-context.ts` gathers intended mission work, routines and dated observations;
`supply-coverage.ts` estimates coverage and refill amounts. This is advice, not a
reservation, role assignment or inventory controller.

Working targets cover 45 minutes, with refill advice below ten minutes. Rates use
measured smelting attempts/food consumption where available and labelled priors
otherwise. Tools are reusable, not per-unit demand. Food coverage uses healing HP
and proposals use whole fish. Planned upstream output removes duplicate intermediate
requests without pretending those inputs already exist.

Mission demand survives fallback activity. Alternative work uses maximum demand,
not a sum of incompatible routines. Finite stock goals cap at the remaining need.
Targets cap at 2,000 units and known co-input availability. Unknown work is omitted.

Banks older than 30 minutes are unknown for promises. Transport notes are not
process-ready inventory. Missing data is not zero. Historical completed trades do
not cover stock already consumed. Donor reserve suggestions use the larger of own
work target, 25% of stock or ten items, capped to stock; characters may negotiate.
Competing requests still require reconciliation and actual confirmed transfer.

The controller checks each minute and deduplicates recipient/item notices for
15 minutes. Council requests obey existing cooldown and startup readiness. No
extra model worker, durable reservation or delivery acknowledgment protocol exists.
Readiness still verifies actual usable supplies at execution.
