# Bootstrap review — 2026-10-27

Target: observed baseline at source commit `7b446a5`; documentation reviewed as working-tree drafts. No immutable document hash was recorded during review. This is scoped correctness review, not the complete formal EGM lifecycle or a lossless reimplementation certification.

## Discovery and evidence

Bootstrap scope was bounded to first-party agents source: agents, map, portraits, reviews and world-index (five discovered directories); reviews was pruned as non-code, leaving four source packages. Existing READMEs were preserved. SDK, live state, credentials, saves, logs, dependencies and generated outputs were excluded from scout inspection.

Fresh read-only scouts used `fork_turns: none`:

- `/root/egm_core_scout`: controller startup, state, events, messages, memory, coverage and publication; planner and agent excerpts. **Exception:** source reading accidentally totalled approximately 58 KB rather than the requested 50 KB; further reads stopped. This is not claimed as strict bootstrap compliance. Many core modules were not fully audited.
- `/root/egm_portraits_scout`: seven portrait source files and publication/package dependencies, within 50 KB and 300 lines per file. Identified incomplete invalidation, timeout escalation and S3-only publication concerns; these remain documented limitations, not fixes.
- `/root/egm_world_scout`: world-index and map source contracts, within per-package limits. Did not inspect generated index contents or run renderers.

The parent separately checked the generated fishing-type counts without importing runtime code: six net/bait, two lure/bait, no cage/harpoon. skills.ts defines swordfish Cooking 45; fishing.ts has harpoon executor support, but the current index supplies no matching spot.

## Fresh document review

Reviewer `/root/egm_baseline_review` received fresh context (`fork_turns: none`), the target paths, design-critic persona, reimplementation standard and read-only constraints. It inspected all seven target baseline/contract documents, LAYERS.md, the handoff introduction, full short source files (store, mission-coordination, opportunities, portraits/watch, map/render-basemap, events) and targeted excerpts in missions, mission-chain, council, readiness, blocked-options, orchestrator, dashboard, lanes, publish, portrait manifest/render and world-index index/build. Source reading remained below 50 KB.

Actual stage: scoped source/document correctness and critical boundary review. No full comprehension/antagonistic/readiness sequence, whole-system source audit, SDK/website audit, runtime verification or human design approval is claimed.

## Findings and disposition

| Finding | Resolution |
|---|---|
| Mission discussion incorrectly described as preceding selection | Corrected: direct vote/runoff or singleton acceptance precedes up to three work-split rounds |
| Legacy claim-based closure obscured by automatic-check language | Explicitly distinguished two council claims from game-verified completion |
| Portrait hash described as angle definitions | Corrected to angle count; camera/yaw/config invalidation remains a limitation |
| Screenshot cadence could imply fixed start intervals | Clarified completion-relative scheduling, override and minimum |
| Map contract named the wrong render source | Corrected to render-basemap.ts |

The parent applied these corrections; no second independent post-correction review was performed. Known limitations remain in the baseline. No code changes, runtime imports, tests, game actions, service restarts or native global plugin installation were performed by this bootstrap.

## Verification

Local skill validation passed. All 92 vendored upstream file hashes matched UPSTREAM.json; license and revision were retained. Shared guidance and Claude skill symlinks resolved to their canonical files. Local documentation links and whitespace were checked. Runtime tests were intentionally not run for this documentation-only change. Files remain uncommitted under the bootstrap skill's VCS-isolation instruction.
