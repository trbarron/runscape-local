# Operating a local instance

Runtime data and session history stay local. Public documentation describes the
software; it does not establish the health or authorization of any deployed party.

## Local context

Copy [the handoff template](../agents/HANDOFF.example.md) to `agents/HANDOFF.md`.
Record current goals, constraints, budget, pilot expiry and evidence there. Replace
its summary at session boundaries; keep detailed reports in `agents/reviews/` or
`agents/runs/maintenance-reviews/`. Both locations are ignored.

`agents/models.json` is an optional local override; start from
[the empty example](../agents/models.example.json). Environment secrets, accounts,
player saves, state, browser recovery endpoints and logs must remain untracked.
`agents/changes.json` is local scorecard history; scorecard reads an absent file as
an empty history and `mark` creates entries. Preserve existing histories locally.

## Startup and recovery

Follow [setup](setup.md) and [service commands](../agents/README.md#run).
Do not run a second controller against the same characters. Before an authorized
reload, back up `agents/state/`, accounts and server player saves. Stop through the
existing service interface, verify fresh saves for every character and disconnected
clients, then restart and verify the new heartbeat and loaded build. Missing save
or ownership evidence blocks recovery; do not bypass it to make startup succeed.

A successful startup is not proof a gameplay fix worked. Observe the relevant
behavior and distinguish implemented, tested, loaded and game-verified outcomes.
Read-only review and documentation changes need no restart.

## Reviews

Find the actual controller/run from service status and heartbeat. Review all logs
intersecting the evidence window by event timestamp; the newest directory can be a
test. Separate camera failures, operator shutdowns and gameplay failures.

The [optional maintenance scheduler](../agents/maintenance/README.md) requires its
own local prompt and explicit operator authorization. Public examples confer no
permission to modify a deployment, spend money, renew experiments or publish data.
