# Paired combat assist

`assist.ts` coordinates a bounded two-character session. The leader proposes a
non-repeating routine with `invite_assist(partner)` immediately followed by a
1–15 minute fight. The recipient may choose a single 1–15 minute `assist(leader)`
step. Consent is explicit; the invitation never auto-accepts.

## Session contract

At most two disjoint pairs can exist. Invitations/consent expire within 15 minutes
and clear on cancellation, routine end or restart. Saved cooperative routines need
a fresh planner decision. Both finish existing solo combat and rendezvous within
four tiles in 60 seconds before the hunt.

Execution rechecks fresh connected state, same ground plane and a local 64-tile
range. The assistant follows bounded moves and attacks only the exact agreed NPC,
corroborated locally and located in a mapped multicombat zone. Unknown state,
single-combat targets, PvP and ambiguous identity fail closed. Wilderness activity
requires applicable permission and ordinary safety/readiness checks.

Regrouping and missing-target waits are bounded. The assistant honors its own food
and retreat rules; terminal failures attempt bounded disengagement. External
cancellation issues no new action. Neither participant gets a new mission from
this mechanism.

## Evidence

Shared-target engagement and follow attempts are cumulative observations, not kills
or damage attribution. Individual fight reports preserve XP and consumption facts.
[Hunt checks](combat-hunts.md) correlate exact shared-target evidence with observed
defeats where required. Snapshot consumers continue to display existing summaries.

`assist.test.ts` and `multicombat.test.ts` cover consent, session bounds and mapped
execution. A successful simulated test does not establish a live paired encounter.
