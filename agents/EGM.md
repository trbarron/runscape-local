# Party controller contract

`service.ts` and `supervisor.ts` own process recovery; `orchestrator.ts` owns client
startup and character-loop supervision. `agent.ts` executes structured decisions
from `planner.ts`; `council.ts` negotiates shared work. The game remains authoritative.

[Layer ownership](LAYERS.md) defines evidence and authority. The
[design index](../docs/designs/SITEMAP.md) covers implemented behavior and limits.
Active mission, budget and trial restrictions belong in the ignored local handoff.

`store.ts` persists local state. `events.ts` can create logs on import. Execution
changes game state; publication writes Redis or S3. Documentation checks must avoid
runtime imports. Validate implementation with focused tests and typechecking;
verify runtime loading and actual outcomes separately after an authorized reload.
