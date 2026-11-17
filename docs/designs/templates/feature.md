# Feature title

Status: Draft proposal (replace deliberately; do not imply user authorization)
Owner / date:
Source baseline commit:
User instruction authorizing this design work:
Implementation authorization, if any:
Affected contracts:

## Problem and success criteria

What user problem is being solved? Include a concrete current failure and its evidence window.
State measurable outcomes rather than “make it robust.”

## Goals and boundaries

List intended changes and what remains outside this feature's scope. Identify which layer owns
each decision. Distinguish factual observations from desired behavior and unverified assumptions.

## Current behavior

Link exact source files/symbols and the baseline contract. State known gaps and current live-state
uncertainties. Do not use a saved handoff or screenshot as authoritative live game state.

## Proposed contracts

Specify public types, function signatures, input/output shapes, state transitions and completion
semantics. Include ownership, timeouts, retries, expiry, idempotency and partial-result behavior
where relevant. Make defaults, units and unknown-state handling explicit.

## Side effects and dependencies

List disk/state mutations, game actions, process lifecycle, model/network calls, publication and
cross-repository consumers. Name what is authoritative and what is a last-seen observation.
State the limits the implementation actually enforces and those it does not.

## Alternatives and decisions

Compare credible alternatives, including a smaller change. Record why each was chosen or rejected,
and decisions the user still needs to make. Avoid turning a speculative future idea into a requirement.

## Risks and failure handling

Cover unavailable inputs, partial state, shutdown/restart, stale observations, resource/spend limits
and relevant failure modes. Explain recovery and the boundary of any “safe,” “atomic” or “verified” claim.

## Implementation plan

Name concrete existing/new files and the changes in each. Define any migration, compatibility
window, rollback and producer/consumer deployment order. Do not leave unresolved interface choices
for the implementing agent to guess.

## Acceptance and verification

Map each success criterion to meaningful checks. Separate offline tests from live verification;
state what the test environment cannot prove. Specify a bounded live observation window, expected
signals and rollback triggers. Preserve account/save integrity and avoid test/live log confusion.

## Review and authorization record

Link completed independent reviews and resolutions. Record unresolved findings and scope changes.
State which review stages were actually completed; a checklist is not evidence. Cite the user's
actual implementation authorization before changing runtime behavior.
