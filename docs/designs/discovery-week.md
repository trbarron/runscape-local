# Seven-day discovery extension

Status: implemented, tested and deployed; initial capture verified, new-project adoption pending. 2026-10-30.
Baseline: 502558e; existing exploration-pilot.md remains historical.
User authorization: after the exploration audit and recommendation for a revised week-long pilot,
user said “Yes expand it.” This authorizes the extension, implementation and normal tested deployment.
This is a focused design/code review, not the full five-stage EGM lifecycle or invented section approval.

## Problem, observed baseline and success

The first24h pilot expired at2026-10-30T14:06:29.952Z. It retained128observations and32
interpretations,27by Wren, dominated by failed routing. Successful look/dialogue does not enter
captureObservation. Some location interpretations contradict raw coordinates. Real outings and
fish/shaft production occurred; no assist orders. Missions repeatedly postpone personal projects.
Success means actual optional outings, observed world details retained, and interpretations tested
against later evidence. Counts and prose alone are not success. No dedicated model worker/call site or configured budget increase; shorter routines and lookups
can increase existing planning traffic. Remaining budget may exhaust before seven days.

## Scope and ownership

Continue existing accounts, observations, ids, histories and ambitions. Maintenance explicitly
renews once for seven days from deployment; normal restarts must never renew. Characters choose
projects, tests and partners and may decline. Code supplies bounded suggestions from real indexed
spots/current nearby NPCs, never inventing a quest reward, granting mission completion or forcing
novelty. Existing readiness, food, fashion, wilderness/PvP limits and mission checks stay authoritative.
A brief5–10min personal outing can be negotiated alongside a long skill goal rather than waiting
for Smithing90. Existing accepted deliveries still require fulfilment or explicit renegotiation.
No new arbitrary mission engine, quest solver, action primitive or website/schema consumer required.

## State and observation contract

Keep version1 readable; add optional extension {startedAt,previousExpiresAt,expiresAt} with exact
seven-day duration, and require state.expiresAt===extension.expiresAt. Legacy24h validation remains
unchanged without extension. Extension previousExpiresAt must equal original startedAt+24h;
extension.startedAt must be finite and >=previousExpiresAt. Use the actual stopped-controller
operator write timestamp as extension.startedAt; require exact7*86400000ms duration. A pure explicitly invoked extendDiscoveryWeek validates existing state and requires the original pilot to have expired,
is idempotent when extension already present and preserves original startedAt/ids/content. No startup
renewal path. Back up file and all runtime state/saves before stopped-controller extension write.
Invalid state is preserved/disabled. Atomic write and restart persistence follow existing store rules.

Add bounded executor worldObservation (stored as Observation.world alongside numeric facts) to order_end for successful look, interact, choose and use.
Snapshot only SDK state <=5sec old, with actual coordinate/plane, up to6nearby NPC names/options,
6objects/options,4ground-item names, and <=500characters of actually read dialogue. Reject missing/
stale player. Names/options length-capped and sorted for deterministic capture. Dialogue is quoted
untrusted game text. Unsupported/failed interactions never prove success; observed dialogue on a
failed dispatch is still observation, not task completion. Done orders with a fresh scene qualify; blocked actions may retain the same scene with the failure.
Dispatch result {success,message<=120chars} is stored separately when available, so a rejected
interaction with visible dialogue is never labelled dispatch success. A failed use dispatch blocks
the order even if dialogue was read. Scene capture proves neither interaction nor quest completion; never use planner target as a place or claim quest completion. Capture from skill callbacks
rather than reconstructing expired dialogue from final state. Keep numeric telemetry unchanged.

World sampling includes position and scene/dialogue content, once30min per identical scene; cap128
retained observations with >=24slots protected for recent world evidence when present, avoiding
production flood starvation. Uncited records evicted first within the overrepresented class; cited
records may be evicted only with dependent notes removed. World snapshot JSON stays <=1400chars; numeric facts JSON remains <=1800chars by omitting
whole overlong fields with an explicit omitted list rather than truncating invalid JSON.
Existing numeric-only facts compatibility and3500char model context cap remain. World details must
survive projection and retrieval, and appear ahead of verbose numeric telemetry for world records.

Interpretations gain optional status open/supported/contradicted/inconclusive/retired and optional
result_evidence_id. Schema requires nullable result id plus status for new model output; legacy notes
remain open. Closure (supported/contradicted/inconclusive) requires an existing hypothesis with preserved
createdAt (legacy first t), plus a retained distinct result observed at/after that hypothesis and
source, and no later than the update timestamp. Validate chronology on load as well as acceptance.
Source/result compact excerpts are rendered together before large observation detail; truncation
remains explicit. Closure remains a CHARACTER ASSESSMENT,
not verified truth. Result citations receive same retention protection and cascading cleanup as source
citations. Records with old timestamps are labelled historical, with fresh-state/retest precedence;
new successful tests do not silently rewrite immutable old failures. Old geographic guesses remain
unverified, and an old observation is not a current route restriction. No automatic universal learning.

## Opportunities and prompts

New pure discovery-options.ts consumes current state, SDK age, indexed spots and guide snapshot.
Only active extended pilot; no stale/absent state. At most3hints/1000chars in ordinary decision
prompt only (no council/reflection duplication). Include actual nearby reachable Talk-to NPC, an
indexed surface survey within400tiles excluding toll/ferry/deep wilderness and recently attempted
same area, and a comparison hunt at eligible nonstarter NPC when available. One candidate per kind;
exact raw coordinates are executable travel targets. Indexed points are candidates, not proof a route
is traversable or safe; look up/verify before departure, fresh readiness validates any chosen action.
Use recently visited own observed positions to reduce repetition. Candidate eligibility is conservative
but does not guarantee a complete route. Local NPC conversation is not a guaranteed quest.
Prompts explicitly permit optional bounded experiments negotiated around deliveries, retain next
step/reconsideration reason, and use field_note to compare source and later result. Existing action
set already provides look/interact/choose/use/travel/fight/assist; no additional primitives now.

## Implementation, failure and cost

Modify learning-pilot.ts/types/reducers/validator/retention/rendering and tests; learning.ts typed
wrapper unchanged unless needed for compatibility. Add world-observation.ts/tests as pure snapshot
builder. Modify skills.ts to emit observed snapshots through optional Ctx callback, agent.ts to attach
only actual evidence to events, readiness integration tests for real skill callback. Modify planner.ts
schema/prompts/opportunities; add discovery-options.ts/tests. Update LAYERS/README/HANDOFF, this spec,
SITEMAP, agents/EGM.md and historical pilot pointer. Update maintenance prompt to recognize explicit extension and
review discovery results without renewing again. No other source files expected.
All memory processing bounded; at most1000extra prompt characters in ordinary decisions, field-guide
cap3500unchanged; no dedicated new model call site or configured spend extension. Monitor lookup/decision rate and
remaining spend; the existing budget ceiling, not the seven-day date, limits expenditure. Evidence remains local.
Store failure cannot stop gameplay; unavailable opportunities yield none; expired extension is read-only.
Rollback code through graceful reload; retain extended state as archive (old code rejects extension,
so learning disabled rather than silently erasing it). No account/save rollback needed for observation.

## Alternatives

Prompt-only renewal misses world facts and test outcomes. A quest engine/new freeform mission type
would expand protocol/safety and completion semantics beyond evidence; defer until real experiments
show a missing ability. Separate world store would need new retrieval/migration/retention protocols;
bounded additive evidence in the existing store is sufficient for this pilot.

## Verification and rollout

Tests: explicit/idempotent seven-day renewal and invalid-state refusal; legacy compatibility; restart
expiry persistence; fresh/stale snapshots, observed dialogue after closure, failed interaction handling;
world sampling/retention versus production spam; safe bounded JSON; result-citation validation and
cascade eviction; context budget/historical labels; opportunity freshness/filtering/diversity/repetition;
real executor emits snapshot and old numeric telemetry remains. Full agents suite/typecheck/whitespace.
Commit code and pending-deploy handoff, backup, stop, verify four fresh saves, extend saved pilot once,
start, verify loaded commit/fourready/exact fixed expiry. Observe normal decisions for suggestions or
new observation/ambition evidence without forcing an outing. No adoption guarantee. Next hourly
review should verify actual choices/results, expiry and spend, not just entries. No push/merge.

## Review record

Fresh discovery_week_design_review completed with design_critic persona and feature-spec standard,
reading target and selected baseline. No blocker; five major findings: renewal chronology, dispatch
versus dialogue, hypothesis/result chronology and retrieval, opportunity eligibility, and cost claim.
Resolutions: explicit expiry/extension timestamp relations; separate dispatch metadata; preserved
hypothesis createdAt and later retained result excerpt; concrete400tile/ground-plane/index filters,
24tile6h repetition window and real nearby Talk-to actions; unchanged budget/no dedicated worker
rather than unchanged planner-call count. Candidate routes remain explicitly unverified. Implementation
review and regression/deployment outcomes follow below. Existing
user authorization covers proceeding from scoped design through implementation; no additional gates
or full lifecycle approval claimed. Record actual findings and resolutions here before deployment.

### Focused implementation review

Fresh discovery_week_code_review read persona/standard/spec and implementation without edits,
imports or tests. It found no blocker and three major issues: look omitted current open dialogue;
sampling identity depended on requested action/target/dispatch metadata; citation excerpts could
hide decisive dialogue and omit age. Fixed look capture, scene-only successful-world identity
(position/names/options/items/dialogue, bot; failure telemetry independent), and deliberate paired
excerpts reserving dialogue/dispatch/coordinate/time space before scene lists. Added regressions
for open dialogue, alternate requested targets/actions/dispatch, source-only query with a full-scene
result and old counterpart, plus both-endpoint retention under mixed evidence churn. Hypothesis
closure remains a character assessment. With32notes at most64endpoints are cited, so preserving
both endpoints at128capacity is possible even with the24world floor; defensive cascade remains.
This is one focused design review and one focused implementation review, with author resolutions;
no independent re-audit or full EGM lifecycle approval is claimed.

### Deployment evidence

319tests across37files/1244assertions, TypeScript, whitespace and documentation links passed.
Loaded656d18b in2026-10-30T16-20-45-008Z after backed-up graceful stop/four verified fresh saves.
Explicit once-only extension begins2026-10-30T16:20:44.472Z and expires2026-11-06T16:20:44.472Z.
Original learning data preserved; loaded guide validated and new normal work outcomes captured.
Fresh-state preview produces bounded suggestions without another model call. Four ready, party2227;
new discovery outings/dialogue records/test closures remain pending, not claimed from suggestions.
See current HANDOFF for backup, runtime and next checks. Budget remains$18with$3.50left at startup;
no seven-day funding guarantee or automatic renewal.
