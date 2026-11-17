# Shared expeditions replace single-character grinding missions

Status: authorized implementation, focused reviews completed; final verification/deployment pending. Baseline current source
656d18b plus documentation. User rejected the current MikeSmithing90 mission as uninteresting and
only for one person, following approval of discovery week. This explicitly authorizes rescoping that
unfinished goal, preserving it as retired, and changing future mission options. It does not authorize
invented achievements or fixed permanent roles. No new approval gates/full EGM lifecycle claimed.

## Observed problem and outcome

The active Smithing Workshop has one open milestone, MikeSmithing90; achievement/armour are closed.
Other characters repeat fallback training. Discovery hints do not change mission selection.32legacy
templates mostly offer stocks or skill ladders; another ten-level workshop remains a normal choice.
Outcome: a party project requiring a fresh contribution from every character and several distinct
kinds of fieldwork, chosen in council. Skills are tools/personal projects rather than party purpose.

## Proposed behavior

Live mission context uses sharedProjects policy. During that policy, legacy grind/reserve offers stay
available diagnostically but are excluded from party selection with a clear reason. Characters retain
all personal training actions/preferences. Add six indexed regional expedition templates: Varrock,
Lumbridge, Western Coast, Falador, Northern Roads and Al Kharid. Existing recent-key exclusion applies;
six regions avoid an empty menu solely from current+last3exclusion. No claim this finite library is
unlimited novelty or a quest engine. Each trip is bounded preparation/survey/test/return; party may
split activities and negotiate routes, partners and tasks, with no permanent supplier/fighter role.

A mission has4member checks plus one shared diversity check. Each member contributes a fresh look
at actual region coordinates AND a productive practical test there (positive measured XP on allowed
field actions, or an actually read NPC conversation with dispatchsuccess). The party needs3distinct
activity types across those contributions. Starter cows/chickens/goblins/rats and smith/smelt fallback
are excluded from qualifying field trials. This is an observed experiment, not proof of a new method's
quality, quest completion or attributed kill. No minimum XP/level grind; one real productive test
counts. Report interpretation/next test through the existing guide when available.

Regions are concrete circle{name,x,z,radius<=180}. Offers require all4fresh members and at least one
supported field method per member and3distinct available action types across the party, proven by
indexed in-region sites/current levels and complete own production preparation chains. Suggest
methods but do not assign a permanent role. Level-qualified nonstarter fights require actual carried
or own-bank food under existing readiness at execution; index is not a route guarantee. Don't offer
ferry/toll/deep-wilderness resource chains. Surface coordinates/readiness remain authoritative.

## State/evidence contract

New Check kind expedition carries immutable region/participants/member(optional)/minMethods and
since. Generation uses since0; toGoal binds all checks to one actual acceptance timestamp. Stable
objective keys exclude since/progress so cache refreshes do not reset work or bypass recency.
Add optional bounded evidence list on each check (max16 proofs): source{run,t,bot,action,target},
actual position, kind survey/trial, XP or observed dialogue flag. Orchestrator subscribes to its own
order_end stream, uses pure reducer on current plan and persists only a genuinely new qualifying
proof. This evidence is independent of bounded learning-guide retention and discovery-pilot expiry.
Never ingest old log directories or planner promises. Unknown/missing/stale positions do not qualify.
Look requires valid fresh worldObservation at actual region coordinates; trials use bounded executor XP-location samples (up to8recent productive tiles) captured from fresh
SDK updates after order start, rather than aggregate start/end positions. The observed XP sample
must be in-region on ground plane and positive; stale frames and life changes reset the baseline.
All contribution orders must begin at/after acceptance (new orderStartedAt), including surveys;
world.at must be >=since. No credit for an old running order that ends after selection. Dialogue
trials require world data from interact
with confirmed dispatch (choose alone cannot establish NPC identity/dispatch, so not a trial).
Partial productive orders may qualify; shutdown/council interruptions are observations, not completed
objectives. Evidence t must be >=since; source run nonempty. Duplicate proof/class/member/activity
cannot increase progress or cause repeated writes. Store survey once and first proof per action per
member; at most4members*(1survey+3activity proofs)=16. Different targets of one action are one method.

Member check requires its survey and >=1trial. Shared check counts distinct trial actions from
members who ALSO have a survey. All four member checks are required regardless of shared diversity.
Existing game automatic checks remain; no council prose can complete expedition milestones. Persisted
evidence lives in the plan and survives restart. Old saves/checks remain readable; new optional check
kind is produced only by validated code, not model JSON. Unfinished old objective is retained through
existing retainUnfinished flow with explicit user rescope reason. No direct completion or inventory edit.

Do not append another five-achievement ladder to expeditions: it would keep a finished trip hostage
and restart grind. Keep standing armour/fashion check. Existing old achievements remain historical.
Feasibility refresh preserves region/since/evidence; rebuild suggestions from the chosen region only.
Short-lived readiness failures are recoverable, not automatic mission completion. If no eligible
project exists, report empty menu and preserve current goal; never silently restore solo workshops.

## Files, rollout, cost and alternatives

New expedition.ts pure definitions/XP-location sampler/qualifying reducer/evaluator and expedition.test.ts. Modify
missions.ts for Check/Ctx/live policy/offers/progress/work refresh; council.ts for acceptance timestamp,
no achievement append on expeditions and event recorder; orchestrator.ts subscribes; opportunities.ts
fingerprints policy; mission-coordination.ts preserves each named participant milestone owner even if another member
claims it; memory.ts renders parallel fieldwork/options instead of a sequential next-milestone chain; planner.ts clarifies trial/survey/
shared goal semantics; mission/opportunity fixtures update count and new behavior checks. Document
LAYERS/README/HANDOFF/SITEMAP and this design. No SDK/game/website mutation; additive order/progress
metadata must retain existing summary rendering. No dedicated model calls/budget increase; smaller
projects may increase existing council/planning rate, review remaining spend.

Prompt-only changes leave the wrong menu and active goal. Four tiny level targets are still grinding.
A full quest engine needs quest-state/requirements/reward verification and is deferred. Event proofs
in the learning guide could be evicted or expire before goal completion, so mission progress belongs
in the plan. Current+last3exclusion is finite recency, not a permanent discovery ledger.

Tests prove all4required,3actualmethods, pre-acceptance/wrong actor/wrong region/stale positions/
prose/no-XP/starters rejected, observed conversation semantics, source provenance, persistence/
dedup/max16, stable refresh and library exclusion; acceptance binds since and omits achievement ladder.
Full agent checks/typecheck. Commit, backup state/saves, graceful stop/four fresh saves, set only
plan.rescope to explicit user request atomically with backup, restart and verify council selects a
shared project and all4have meaningful open checks. If council not yet due, wait existing cooldown;
do not forge a choice or erase goal. No pilot expiry/budget renewal. Update handoff with loaded
commit/actual selection/behavior still pending. Existing accounts/saves/preferences preserved.

## Review record

Fresh shared_expedition_design read persona/standard/spec and selected sources. Three major findings
resolved: asynchronous council saves must merge latest field proofs by key+acceptance timestamp,
never across replacement goals; all proof orders must start after acceptance, not merely end then;
productive-location evidence must come from fresh SDK XP samples, not aggregate endpoint guesses.
The recorder writes synchronously only for qualifying events; after awaited council rounds the draft
merges current proofs before progress evaluation/coverage/final save. Retirement reloads latest old
goal to preserve proof history. Field sampling is enabled only for active expedition missions, so
ordinary production logs do not gain unnecessary sample payload. Regression simulates an event
arriving during an awaited council interval, JSON restart and final merge. Readiness/executor test
verifies actual state subscription, timestamp and sampled tile. Fresh shared_expedition_code reviewed persona/standard/spec and implementation read-only. Three
major findings resolved: a failed replacement vote reloads and merges the retained goal before
saving; stale/missing/pre-start XP frames invalidate the sampler and the next fresh frame primes a
new baseline (cannot attribute old XP to a new place); accepted expeditions do not auto-retire from
recoverable tool/food/funding losses. Fresh proposal revalidation still checks full eligibility.
Added regression coverage for each case. Later prompt/render corrections explicitly show parallel
named contributions and alternative fieldwork options, not a sequential chain beginning at M1;
refresh suggests untried activity types for shared diversity. No full independent resolution re-audit
or full EGM workflow approval claimed. Actual user authorization
is this request and the preceding rejection of solo Smithing as party objective, not a fabricated
formal approval. All substantive changes stay within party mission selection and observed progress.

## Operational limits

An indexed region and preparation chain are candidate feasibility, not a proven safe path. Regions
can overlap; this pilot does not claim each trip is geographically novel or the six-template library
is an unlimited generator. Characters choose actual questions/methods and can revise them. Survey,
productive trial and diversity checks certify observed contributions, not that the experiment was
interesting or its interpretation true. Review choices and guide results after actual trips. The
existing three-item history allows later revisits; adding new quest/content protocols remains future.

### First live selection and bounded correction

Council420 unanimously selected Varrock and archived unfinished Smithing90. All four fresh surveys
were verified in plan proofs. Mike then proposed iron smithing as a practical test despite its exclusion;
the check correctly stayed incomplete. Add deterministic routine preflight for a participant who still
owes fieldwork: smith/smelt sequences without any qualifying field test get an explanation before
preparation/execution. Preparation-only steps remain valid, methods remain character-chosen, and
personal production is available after the participant contribution. This is obligation feasibility,
not a permanent profession/role restriction. No fabricated field credit or rewriting his commitment.
