# Twenty-four-hour learning and ambition pilot

Historical initial pilot. The authorized [seven-day extension](discovery-week.md) adds explicit renewal,
world observations, later result citations and optional discovery suggestions.

Status: authorized design, baselinecbf83f2, 2026-10-29. User: “Lets test that… explorer or
experimental phase.” Existing implementation authorization is carried forward. No claim that
open-ended autonomous goal selection or a formal five-stage review is already complete.

## Scope and success

Pilot one self-authored ambition per character, a small shared evidence-linked field guide and
relevant retrieval in normal decisions/councils. Preserve current mission/checks, character agency,
fashion, account/save integrity, budget, feasibility and safety. No new LLM calls, website or published snapshot schema
changes, automatic achievement claims or freeform party-mission replacement. Projects are optional
bounded existing-action routines while obligations are covered or productive fallback is appropriate.

Success is behavioral: characters express distinct reasons/next steps, cite relevant evidence,
revise methods after contrary outcomes and carry a project across more than one decision. Merely
producing entries is not success. One day later assess actual decisions/actions, not prose claims.

## Data and interfaces

Pure learning-pilot.ts reducers/types/ranking plus learning.ts persistence wrapper. State file
agents/state/learning-pilot.json version1: startedAt, expiresAt, nextId, observations[], interpretations[],
ambitions{}, ambitionHistory[], counters. Initialize once at normal controller startup with24h expiry;
restart preserves original expiry. Missing state means no initialization on planner/module import.
After expiry, retrieve records read-only and stop new ambition/interpretation/observation capture;
normal gameplay continues. Pilot expiry never interrupts work or completes a goal.

Observations are immutable executor facts from this controller's order_end events, captured by
orchestrator subscription, not model-authored assertions. Source {run,t,bot,action,target,summary},
plus bounded snapshots of outcome/reason/duration/XP/fight/smelting/withdrawal data. Unique monotonic
obs ids; no external run ingestion or fabricated seeding. Target is additive order_end metadata with
legacy label fallback. Skip successful generic errands; capture productive work and blockers.
Sample identical bot/action/target/outcome/reason groups no more than once/30min, preserving
immutable records/citations. Max128 observations, retain cited records preferentially. At most32
interpretations, one per evidence-id/author pair, with interpretation and next experiment separately
labelled unverified character hypotheses. Drop interpretation citations only together with their
record; never silently relabel prose as fact. Sources have known live-controller provenance.

Decision schema adds nullable ambition {title,why,nextStep,reconsiderWhen,status:pursue|pause|retire}
and nullable field_note {evidence_id,interpretation,next_test}. Null keeps state. Accept at most one
each per accepted planning decision, after preflight and alongside existing memory updates. Validate
string lengths/nonempty fields and existing evidence id; reject invalid references with an honest
notice rather than throwing. Only character may change its own ambition; retired/replaced versions
kept in bounded16-entry history. Paused/retired does not complete game objectives. Show self-report
labels and do not propagate ambition status to mission milestones.

Retrieve at most4 observations and2 interpretations with short snapshots, using exact normalized
action/target topic words from current action/goal/ambition/notes .
Lexical ranking, not semantic certainty; include one recent own failure if no topic matches and a
recent shared outcome when relevant. Existing SDK/world state overrides stale records. Distinguish
facts, hypotheses and intention in rendered context. Include teammates' current ambitions for
coordination; no private inventory beyond already published party facts. Field-guide retrieval uses
only bounded stored data, no network/model calls. The first pilot has no new lookup mode or model worker: retrieval is automatic in existing contexts.
Maximum rendered learning context3500characters (truncation explicitly marked); max fields title60,
why120,nextStep140,reconsiderWhen120,interpretation180,nextTest180; source summary300/facts1800.
Ambition revisions have monotonic revision ids/timestamps. Global history cap16. Eviction removes
uncited observations first, then any dependent interpretations if necessary; no dangling usable prose.
Sampling keys include bot/action/target/outcome/normalized reason and consumed-food types; successful
ordinary work is limited to one/key/30min; no writes for skipped events. Already-satisfied/no-change
steps are not productive evidence. Fresh start/end positions (<=5s age at capture) are optional order-end telemetry; travel requires observed coordinate movement within the same life.
proposed target strings never establish a visit or actual method. Evidence is executor-observed data,
not universal truth or authoritative kill credit. Evaluation reconstructs project work from decisions
and actual actions; active-ambition metadata alone is not proof of project pursuit.

Invalid/unsupported existing state is preserved, capture disabled with a bounded warning; never
silently restart expiry or ids. A missing file is initialized only by explicit controller startup.
Persistence succeeds before swapping in-memory state; failed saves retain previous state, produce
an info warning and never escape into event dispatch/game execution. All interpretation ids and
references are validated. Extra decision fields nullable; max response tokens1200 to accommodate
occasional authored updates (no extra model calls). Existing lookup and rejected proposals do not
call accepted-learning updates. Expiry permits read-only retrieval, no new mutations.

Charter in system prompt values discovery, expertise, individuality, useful cooperation and learning.
Characters may propose/revise their ambitions and a small experiment using supported actions; larger
party goals remain constrained to the validated mission system in this pilot. Councils discuss
ambitions once after covering obligations; cannot abandon a dependency simply because a project
sounds interesting. Event-driven existing blocked reports feed the guide automatically; ordinary
reflection can propose a hypothesis in next decision, no extra reflection model worker.

## Alternatives, phases, failure and verification

Prompt-only charter cannot preserve projects/evidence. Unbounded free text invites stale universal
claims; immutable observations plus explicitly unverified interpretations preserve uncertainty.
A new arbitrary-mission planner would be a larger unverified change. This pilot uses existing
validated routine execution, with no automatic owner assignment or custom goal completion.

Phase1 Create learning-pilot.ts/tests with expiry, sampling, immutable provenance, bounded history,
reference validation, own ambition lifecycle and relevance tests. Phase2 Create learning.ts wrapper,
Modify planner.ts schema/context/lookup, agent.ts accepted update + target metadata and orchestrator
startup/subscription. Handle persistence/observation errors as observation warnings without failing
an order or duplicating game actions; never recursively record info events. Model malformation stays
under existing planner recovery. Phase3 Modify LAYERS/README/HANDOFF/index and this spec, run full
regressions/typecheck/schema checks. Phase4 backup/graceful reload, four verified saves; startup and
actual guide persistence checked. No forced ambition, fake discovery or account reset. Rollback
removes prompt/schema/hooks through graceful reload, retaining state as an archive.

Evaluation after24h: chosen/revised ambitions, repeated self-project actions, evidenced interpretations,
retrieved relevant entries versus repeated known failures, actual new methods/locations/cooperation,
primary mission progress and spend. Counts alone are descriptive; no automatic success score or
forced novelty quota. Existing ledger/game fact limitations remain visible in observation labels.

Retirement archives an explicit transition revision, timestamp and reason alongside the previous ambition.
The real decision-loop tests inject planning dependencies, including unread messages and memory writes,
so lookup retries, preflight rejection and resume acceptance cannot mutate live state.

## Focused design review

Fresh exploration_design_review read the designated design critic and feature standard plus selected
planner/agent/store/events/orchestrator sources. Major findings resolved above: invalid-state/expiry
failure behavior; executor/proposed-target provenance; numeric size caps; deterministic capture and
pruning; explicit integration acceptance. Add tests for rejected/preflight/lookup update boundaries,
read-only expiry, invalid-file preservation and subscriber/save failure containment. No full lifecycle
or independent resolution re-audit claimed. User's implementation authorization remains in force.

Fresh exploration_code_review identified no-change travel, missing retirement transition metadata,
unrelated failure displacement and missing real-loop acceptance tests. Implemented observed start/end
movement, explicit retirement transitions, failure fallback only without topic matches, and three
real-loop tests. Focused review with author resolutions; no independent resolution re-audit claim.

## Early pilot corrections (2026-10-29; authorized maintenance follow-up)

Observed before this correction: Wren eventually authored an ambition, and Trish's later71coal
handoff succeeded. Zero adoption and permanent trade failure are no longer accurate baselines.
Other characters still have no ambitions, and production cleanup/cycling defects remain.

The normal decision prompt now invites a character without a current or historical ambition once,
with explicit null opt-out. An accepted decision records optional Memory.ambitionInvitedAt; compare
against pilot start so it persists across restart without resetting expiry. Lookup/rejected proposals
never consume the invitation. Existing memories without this additive field remain compatible.
The invitation appears only in ordinary decision calls, not council/reflection schemas. Existing
ambitions/history prevent repeated invitations. No extra calls, automatic project or renewal.

Routine execution derives internal Args.bankOutputs from its explicit smith targets, recomputed
when resumed. Broad/named-bank cleanup deposits these exact names as well as ordinary resources;
explicit item deposits retain their target. Worn gear, unrelated carried gear/tools and the food
reserve remain outside this extension. Production loops require progress from work or a completed
handoff, not merely deposits, equips or withdrawals. This applies to carried-over routines too.

Explicit bank targets normalize note qualifiers to the name in the pack. Giving uses anchored item
names and refuses mixed IDs/forms before opening a trade; SDK's first-name-match offering cannot
safely choose among same-name noted/unnoted stock. Deposit/withdraw the intended form before retry.
The SDK already deposits all distinct IDs for a deposit-all regex; no SDK change is required.
Order-end handoffs include their intended item as target, and legacy summary parsing cannot use
parentheses from a failure reason as the target. No historical observations are rewritten.

This is a scoped correction under existing user authorization, with focused regression tests and
real-loop fixtures. No new independent review or full design lifecycle is claimed for this follow-up.
