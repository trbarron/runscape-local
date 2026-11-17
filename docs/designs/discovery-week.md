# Learning and discovery

`learning-pilot.ts` owns bounded validation, reducers and retrieval; `learning.ts`
owns local persistence. Characters author optional ambitions and interpretations.
Executor observations remain immutable evidence. Current game state takes precedence
over historical observations and character explanations.

## Lifetime and persistence

The initial pilot lasts 24 hours. An explicitly invoked one-time extension can add
seven days after the original expiry. It preserves original timestamps, IDs and
content and validates the exact relationship between original and extension dates.
Startup never renews expiry. After expiry retrieval continues read-only. Invalid
state disables capture rather than silently resetting it. Back up state before an
authorized extension and do not edit cached state while the controller is running.

## Observations and interpretations

Successful or blocked actions can retain fresh world evidence with their actual
outcome. Scene snapshots require SDK state at most five seconds old and include
actual coordinates, bounded nearby names/options and actually read dialogue.
Dispatch success is separate from seeing dialogue. Neither proves quest completion.
Capture from action callbacks preserves transient dialogue.

World observations reserve at least 24 slots within the 128-record store when
available. Identical scenes are sampled at most once per 30 minutes. World JSON is
bounded to 1,400 characters and numeric facts to 1,800; omit whole fields explicitly
instead of truncating JSON. Guide context is capped at 3,500 characters.

Interpretations can be open, supported, contradicted, inconclusive or retired.
Closure requires a retained source and distinct later result observed after the
hypothesis and no later than the update. Both remain character assessments.
Eviction removes dependent notes with their evidence. Source/result excerpts and
age remain visible; new evidence does not rewrite old outcomes.

## Optional outings

During the extended active pilot, ordinary decisions can receive up to three hints
within 1,000 characters from real nearby NPCs or indexed sites. Surface survey hints
are bounded to 400 tiles and avoid toll/ferry/deep-wilderness chains. Suggestions
are not route guarantees. Characters choose bounded outings, partners and tests
while honoring accepted deliveries and readiness.

No dedicated model worker is added. Shorter routines can still increase planning
traffic; the configured spend ceiling remains authoritative. Entry counts alone
do not demonstrate learning or mission progress. Mission proofs are stored in the
plan independently of guide retention and expiry.
