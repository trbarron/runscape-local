# Hunt evidence

`hunt.ts` validates bounded, structured evidence in mission checks. It does not
choose a party objective or authorize another combat attempt. Active operator
instructions, including a failed trial's no-retry restriction, remain local context.

## Completion contract

Hunt proofs correlate the source run, leader routine and exact NPC index/config ID.
A mapped paired engagement and observed target defeat must correlate within
30 seconds. Fresh target coordinates and timestamps matter; aggregate XP, dialogue
and legacy kill achievements cannot substitute. Defeat observations do not establish
who earned kill credit. Per-target defeat telemetry is bounded to eight records.

Staged charters can require simultaneous preparation, successive target stages and
both matching fighters' observed bank return. Acceptance/preparation cutoffs are
immutable; orders must begin after the relevant cutoff. Council merges preserve
proofs accumulated while a round was awaiting model output.

Operator-assigned trial checks can use an assignment cutoff without importing old
preparation or combat proofs. A one-attempt instruction is an operator constraint,
not a durable executor attempt counter. Failed attempts leave success open. Preserve
retired unfinished objectives and do not escalate or restore them automatically.

## Boundaries

Individual food, equipment, consent, mapped combat and retreat checks still apply.
A plan may assign preparation without forcing weaker characters to fight. The
operator-only rescope flag bypasses normal council cooldown once and clears on
selection; character models cannot grant that authority. Mission completion never
changes the spending ledger or renews a learning pilot.

Verification lives in `agents/hunt.test.ts` and paired/fight reporting tests. Live
success requires new source-correlated observations, not passing unit tests.
