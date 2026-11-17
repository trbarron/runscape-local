# Shared expedition evidence

Regional expedition templates remain available in the diagnostic library. The
current shared-project shortlist filters to combat challenges; this document
explains expedition semantics when an expedition exists in the saved plan.

Each of four members must contribute a fresh in-region survey and a productive
field trial. Across surveyed members, at least three distinct activity types are
required. A trial needs positive located XP or an observed NPC conversation with
successful dispatch. Starter-monster combat and smithing/smelting fallback do not
qualify. Completion proves those bounded observations, not novelty or quest success.

Regions have explicit coordinates and radius at most 180 tiles. Candidate feasibility
requires fresh members, supported in-region methods and complete preparation chains.
It avoids ferry/toll/deep-wilderness chains and never guarantees route safety.

## State/evidence contract

The expedition check carries immutable region/participants/member(optional)/minMethods and
since. Generation uses since0; toGoal binds all checks to one actual acceptance timestamp. Stable
objective keys exclude since/progress so cache refreshes do not reset work or bypass recency.
An optional bounded evidence list on each check (max16 proofs): source{run,t,bot,action,target},
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

## Operational limits

An indexed region and preparation chain are candidate feasibility, not a proven safe path. Regions
can overlap; this pilot does not claim each trip is geographically novel or the six-template library
is an unlimited generator. Characters choose actual questions/methods and can revise them. Survey,
productive trial and diversity checks certify observed contributions, not that the experiment was
interesting or its interpretation true. Review choices and guide results after actual trips. The
existing three-item history allows later revisits; adding new quest/content protocols remains future.

### First live selection and bounded correction

## Routine feasibility

A participant still owing fieldwork gets deterministic preflight feedback for a
smith/smelt sequence with no qualifying field test. Preparation-only steps remain
valid. Methods stay character-chosen and personal production remains available
after the contribution. This does not fabricate field credit or assign professions.
