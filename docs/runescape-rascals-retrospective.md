# Four Adventurers, Three Tiers of Intelligence

## What a persistent RuneScape party taught us about allocating intelligence

**Runescape Rascals · Presentation retrospective · Revised November 8, 2026**
**Presentation outline: approximately 20 minutes**

Four characters lived in a shared game world. Most of their work ran through deterministic code, with a small model making occasional decisions. A more capable maintenance assistant periodically reviewed the system and repaired its tools. Above both sat a human, watching the experiment and deciding when its behavior needed attention or its purpose needed to change.

**The central idea: use a small amount of intelligence close to the work, more intelligence to diagnose the system, and human judgment to decide whether the system is doing something worthwhile.**

Each tier operated at a different scope and cadence. Routine work stayed near the bottom. Failures, persistent stalls and questions about purpose brought in a higher tier. Corrections then flowed back down as better tools, clearer observations or revised goals.

This was an evolving engineering experiment, not a controlled comparison of models or architectures. The three-tier framing describes how we operated it; it does not establish that this allocation was optimal.

---

## 1. The foundation: a world with consequences

Max Bittker's [RS-SDK](https://github.com/MaxBittker/rs-sdk/) and [RuneBench](https://maxbittker.github.io/runebench/) work provided the inspiration and foundation. RS-SDK exposes a RuneScape world built on LostCity to coding agents. Our experiment used that foundation for a persistent four-character party, rather than an official RuneBench evaluation.

Bram, Wren, Mike and Trish had separate accounts, inventories, banks and memories. They could gather, craft, equip themselves, fight and exchange goods. They shared a mission board and negotiated work in council.

The world made dependencies concrete: knowing that coal existed did not put it in the smith's pack. Agreeing to help did not deliver it. Choosing a monster did not make its tile support two attackers.

**The experiment asked how much intelligence each kind of problem needed—and where that intelligence should live.**

Credit: [Max Bittker's talk](https://www.youtube.com/watch?v=cNm4zyUtWj0), RS-SDK, RuneBench and the LostCity contributors. Talk references use the supplied description and chapters; the full video/transcript was not reviewed.

---

## 2. The architecture: three tiers, two reasons to intervene

```text
TIER 3 — HUMAN: purpose and judgment
Watches the dashboard, notices patterns, decides what matters
                         │
                  Requests an investigation
                  or changes the objective
                         ▼
TIER 2 — MAINTENANCE: diagnosis and system improvement
More capable coding models, such as Opus or Sol
Periodic review + manually requested investigations
                         │
                  Repairs tools and prompts,
                  tests and reloads changes
                         ▼
TIER 1 — CHARACTERS: local decisions and execution
Limited GPT-6 Luna reasoning around deterministic routines
Recurring planning/councils + decisions when work ends or fails
                         │
                         ▼
                SDK → persistent game world
                         │
                Outcomes, errors and state
                         └────► logs and dashboard inform all tiers
```

There were two recurring reasons to run a reasoning step:

- **Scheduled or recurring review:** check whether things still work and choose the next action.
- **An exception or concern:** something failed, stopped progressing, or looked wrong to the human.

These were separate mechanisms, not a universal automatic escalation service. A gameplay error normally returned to the character planner first. The maintenance assistant found persistent problems during review or investigated when the human asked. Human observation remained an important trigger.

The party's council belonged to tier 1. It coordinated character decisions; it was not the more capable maintenance layer. The dashboard observed the system and did not control the characters.

Evidence: [layer responsibilities](../agents/LAYERS.md), [party architecture](../agents/README.md), [hourly maintenance](designs/hourly-maintenance.md).

---

## 3. Tier 1: little reasoning, lots of execution

The character tier deliberately used limited model reasoning. Most later planning used **GPT-6 Luna**. Its job was to choose a bounded routine, respond to new information and negotiate with the other characters.

A routine might be:

```text
Withdraw ingredients → smelt a batch → make equipment → bank the output
```

The model did not choose every movement, furnace click or bank operation. Code handled recipes, requirements, navigation, inventory space, replenishment and bounded recovery between decisions.

Reasoning returned at recurring decision points: work finished, a step blocked or yielded, a relevant message arrived, a character died, or the party plan changed. Councils ran periodically, normally hourly, and on bounded requests when a plan no longer worked. Reflections also ran after a number of decisions. This was not a model call on every game tick, nor a single fixed timer for all character reasoning.

**The intended division: let cheap reasoning choose among supported actions, then let code do the repetitive work.**

“Minimal intelligence” describes the amount and scope of reasoning we allocated here. It does not mean there was no planning or communication cost. Frequent councils and short routines could still generate many calls.

Evidence: [character loop](../agents/agent.ts), [planning and council context](../agents/planner.ts), [production cycles](designs/production-cycles.md).

---

## 4. Tier 2: spend more intelligence on the system

The maintenance layer used more capable coding assistants, including Opus or Sol across maintenance sessions. Its job was broader than choosing the next game action:

- Review logs and current state across all four characters.
- Distinguish a bad plan from a broken tool or misleading observation.
- Reproduce failures, change code or prompts, and run appropriate checks.
- Reload the running system safely and verify what actually changed.

We added an hourly maintenance reviewer. It could make tested local fixes and commits within the user's authorization. Manual maintenance sessions also investigated specific concerns raised by the human.

This was a different use of compute: a relatively expensive reasoning session could improve a routine that would then execute repeatedly without another expensive diagnosis.

**The valuable output was often a reusable correction to the lower tier's environment.**

The exact maintenance model varied by session; we did not audit model-by-model cost or compare Opus with Sol. The automated reviewer used its configured coding model, not a measured dynamic model-selection policy.

Evidence: [maintenance operating instructions](../agents/maintenance/README.md), [review scope](../agents/maintenance/review-prompt.md).

---

## 5. Tier 3: the human decided what “good” meant

The human layer watched the dashboard, read character conversations and asked questions that the system was not reliably asking itself:

> Why are high-level characters still fighting cows?
>
> Why is one character making bronze when the party has better supplies?
>
> They are busy, but are they doing anything interesting together?

These questions triggered middle-layer investigations. Some revealed an executor defect. Others revealed missing information, weak coordination or an objective that rewarded the wrong behavior.

The human also set spending limits, standing priorities such as armour and fashion, and the experiment's direction. As basic productivity improved, the desired outcome shifted toward exploration, recognizable habits, useful learning and teamwork.

**The human evaluated purpose as well as performance.** A perfectly functioning worker could still be doing the wrong work for the experiment.

This tier was an essential part of the operating system we actually used. Its attention and interventions must be counted when discussing autonomy.

---

## 6. The correction loop: observe, diagnose, repair, verify

A typical intervention crossed the tiers like this:

1. A character hit a blocker or repeated safe fallback work.
2. A periodic review or human observation identified a persistent concern.
3. The maintenance assistant compared the character's explanation with game evidence.
4. It repaired the narrowest relevant tool, observation or planning rule.
5. After tests and any needed reload, the characters continued with better support.
6. Later outcomes established whether the repair helped.

Corrections had different owners. Execution and recovery defects belonged in code. Missing facts belonged in observations. Character roles and preferences remained theirs within the user's constraints. Changing the purpose of the experiment belonged to the human.

The objective was to bring the lower tiers back toward intended behavior without requiring a human to prescribe every click.

**A repair was not proven merely because a patch existed.** Implemented, tested, loaded and observed working were separate states.

---

## 7. Three examples of the tiers working together

### “Smithing is broken” → repair the interaction

Mike repeatedly failed to open the Smithing interface. Maintenance reproduced a closed-door reach failure: the interface existed, but approach and door recovery needed improvement. A separate test account verified the repair; later party logs recorded real Smithing output.

The character's explanation identified a symptom. More capable diagnosis turned it into a reusable tool correction. The reproduction did not prove that every historical Smithing failure had the same cause.

Evidence: [Smithing investigation](../agents/reviews/2026-10-27-smithing.md), [party verification](../agents/reviews/2026-10-27-evening-progress.md).

### “Someone is stuck on an island” → repair transport recovery

In a November 7–8 follow-up, the human noticed Wren was stranded. Fresh state showed she was below deck on a Karamja ship, with enough money to return. The recovery code treated ground level as shore and missed the reachable ladder. A separate tutorial check also misidentified that area as Tutorial Island.

Maintenance added ladder → deck → gangplank recovery, corrected the tutorial check and supported the return ferry in mainland travel. Wren then chose to bank her supplies, paid the 30-coin fare and reached Draynor, banking seven raw tuna and five raw swordfish.

This was verified movement and banking, not a claim that the whole mission had recovered.

### “I cannot verify a Guard” → expose the facts needed to act

The human questioned a character repeatedly falling back to woodcutting. A fresh inspection found reachable Guards on mapped multicombat tiles, but the character's ordinary observations omitted their exact tiles and identities.

Maintenance exposed those facts and clarified that accepting a prepared paired fight precedes completing its milestone. The characters also needed to treat spawn coordinates as search areas, since NPCs wander.

The new diagnostics were verified against live state. A successful paired fight remained pending at that follow-up. Better information was a repair, not proof of the downstream outcome.

Evidence for both follow-ups: [dated deployment and verification handoff](../agents/HANDOFF.md).

---

## 8. The harder failure: productive work without shared progress

The bottom tier was often good at remaining busy. It could chop, fish, smelt and bank while a shared dependency stayed unresolved.

A party mission became effectively one person's Smithing grind. After the human pushed for more interesting shared activity, we introduced regional expeditions requiring every character to contribute. The party completed those checks, then repeated the same five regions.

The audit found **48 regional mission selections with all five project checks completed in each**. That showed reliable execution of the checklist, not 48 novel discoveries.

The human's question changed from “are they gaining XP?” to “is this worth following?” Maintenance could improve feasibility and reporting, but it could not derive the user's preferences from throughput alone.

**Higher tiers needed to detect when successful local behavior no longer served the larger purpose.**

Evidence: [coordination review](../agents/reviews/2026-10-27-overnight.md), [shared expeditions](designs/shared-expeditions.md).

---

## 9. Cooperation and learning needed more than conversation

The party demonstrated some real cooperation: a **540-coal transfer** was confirmed by sender, receiver and subsequent banking. But agreeing to deliver, actually transferring items, carrying usable stock and consuming it were different events. Separate banks made those distinctions unavoidable.

Memory had a similar gap. At the original snapshot the field guide retained **128 observations and 32 interpretations**, with all 32 interpretations still open. A remembered explanation could outlast the defect that caused it. Recording more facts did not automatically produce a completed test or a changed decision.

These were reasons for the middle tier to improve evidence and protocols, and for the human tier to ask what cooperation or learning should mean.

**Useful evaluation had to follow effects: a delivered resource, a tested hypothesis, a changed behavior or a corroborated shared encounter.**

Evidence: [supply coverage](designs/supply-coverage.md), [learning pilot](designs/exploration-pilot.md), [discovery extension](designs/discovery-week.md).

---

## 10. The upper tiers could fail too

Layering intelligence did not remove operational failure:

- A maintenance lock left behind by a coding session blocked later reviews.
- Host sleep interrupted startup and shutdown; a live supervisor could coexist with an offline party.
- A scheduled reviewer was installed and enabled while macOS denied its Python process access to the repository.

The November 7–8 investigation repaired that scheduler and verified actual scheduled execution. “Installed” had not meant “reviewing.” Recovery from earlier outages also required preserving persisted saves rather than inventing fresh-save confirmation.

**Every tier needed evidence that its own loop was functioning.** The maintenance assistant was part of the failure surface, and the human still caught failures it had not resolved.

There was no independent fourth tier guaranteeing that the human, reviewer or scheduler noticed every problem.

Evidence: [runtime continuity](designs/runtime-continuity.md), [hourly maintenance](designs/hourly-maintenance.md), [recovery history](../agents/HANDOFF.md).

---

## 11. What the compute budget did—and did not—show

The architecture stretched character-planning compute by placing repeated execution in code and invoking Luna at decision points. In the original audited snapshot:

| Measure | Observation | Limit |
|---|---:|---|
| Combined skill levels | **335 → 2,356** | Retained complete-party ready states, not new-account baselines |
| Ended orders | **43,936** | Includes banking, rest, interruptions and failures |
| Orders labelled `done` | **37,276** | Does not imply mission success or useful discovery |
| Character planning ledger | **About $18.92; 19,877 calls** | Excludes maintenance models, hosting and human attention |

The planning tier was inexpensive under the local accounting. The experiment did not establish the total cost of achieving autonomy, or prove that the same result required this precise mix of models. Frequent councils could still consume substantial planning effort.

A better future accounting would separate:

- Character inference and routine execution.
- Maintenance inference, investigations and repair effort.
- Human interventions and time spent interpreting the experiment.

Then measure those costs per useful project or tested hypothesis, not just per call or XP gained.

*Evidence boundary: aggregate counts retain the November 3 cutoff below. November 7–8 recovery examples are separately dated follow-ups; they are not included in those totals. Progress uses this server's modified level curve and is not directly comparable to official RuneScape.*

---

## 12. What transfers beyond RuneScape

The reusable pattern is a hierarchy of scope and responsibility:

| Tier | Question | Useful intervention |
|---|---|---|
| Character / worker | What supported action should I take next? | Choose a routine, retry bounded recovery, report a blocker |
| Maintenance / system reviewer | Why does this class of work keep failing or drifting? | Improve tools, observations, coordination and recovery |
| Human / owner | Is this still the work we want the system to do? | Set direction, assess value and request investigation |

Use routine execution where the task is understood. Add recurring review so quiet stalls do not depend entirely on obvious errors. Make failures visible enough to diagnose. Bring in broader reasoning when local recovery cannot explain or resolve the problem.

For a future experiment, test the hierarchy itself: fix a harness version, compare review cadences, record which problems each tier catches, and measure whether repairs reduce repeated human intervention. Keep the maintenance budget visible alongside the worker budget.

**What we demonstrated was a persistent party supported by tiered intelligence—not four cheap agents that independently solved everything.** The compelling next question is whether better feedback between those tiers can produce more meaningful cooperation and learning with less intervention over time.

---

# Evidence appendix

## Scope and counting rules

The numerical audit below retains its November 3 cutoff. The revised presentation adds the human operator's three-tier framing and explicitly dated November 7–8 operational follow-ups from the handoff. It does not extend the aggregate audit or attribute a measured share of success or cost to any tier.


- **Log cutoff:** November 3, 2026, `15:55:00 UTC` (`08:55 MST`). This is an interim snapshot, not the end of play.
- **Earliest audited complete-party run:** October 20, 2026, `13:58:08 UTC`. Those characters were already trained; their ready states are not new-account baselines.
- **Audited subset:** 187 run directories with all four named character-ready records. We scanned 319 available event files; the other 132 partial, startup or synthetic files were excluded from aggregate gameplay totals. They are not all tests, and relevant failed-start evidence was reviewed separately for the recovery case.
- **Source revision:** repository HEAD `0241c35` at review; the restored runtime loaded `3ac3c75`. Older runs used earlier builds. The current source does not establish which fixes were present in every historical run.
- **Malformed records:** none in the aggregate scan.
- **Orders:** timestamp-filtered `order_end` events for Bram, Wren, Mike and Trish only. A run is not an independent trial; a restart is not necessarily a crash.
- **Regional completion:** 48 selection intervals had automatic completion events for project checks M1–M5 before the following selection. This establishes the checks closed, not that every trip discovered something new.
- **Combat:** only later records with explicit target metadata and whole-order fight telemetry support the named-target totals. Earlier unnamed combat is not assigned to monsters retrospectively.
- **Memory:** 128/32 describes the retained bounded store. All 32 retained statuses were `open` when inspected for this retrospective.
- **Cost:** the last audited spend event reported `$18.916629485`; the local ledger reported 19,877 calls when read. These are accounting observations, not independently verified provider charges.
- **Causal limits:** models, prompts, tools, missions and operations changed during the experiment. Maintenance fixes, user nudges and goal replacements were interventions. No randomized control, stable ablation or official benchmark score was produced.

### Skill-level comparison

| Character | Earliest complete-party ready state | November 3 recovery ready state |
|---|---:|---:|
| Bram | 104 | 626 |
| Wren | 80 | 607 |
| Mike | 73 | 474 |
| Trish | 78 | 649 |
| **Party total** | **335** | **2,356** |

### Ended-order outcomes

| Recorded outcome | Count |
|---|---:|
| `done` | 37,276 |
| `blocked` | 3,894 |
| `interrupted` | 2,404 |
| `yielded` | 150 |
| `stuck` | 96 |
| `stale` | 92 |
| `died` | 13 |
| `partial` | 11 |
| **Total** | **43,936** |

These are evolving executor statuses, not uniform success/failure labels across the entire experiment. `Interrupted` includes councils and operator shutdowns. `Died` order records are not a deduplicated lifetime death count.

## Sources and useful follow-up reading

### Foundation and inspiration

- [Max Bittker's talk](https://www.youtube.com/watch?v=cNm4zyUtWj0). Supplied chapter guide: **12:03** agent harnesses; **19:13** API design; **22:08** benchmarking; **31:29** multi-agent behavior; **35:34** simulated economics; **42:15** collusion experiments. Those topics are upstream context, not outcomes demonstrated by this party.
- [RS-SDK](https://github.com/MaxBittker/rs-sdk/): SDK and game-server foundation; upstream credits LostCity.
- [RuneBench](https://maxbittker.github.io/runebench/): task design, harness development and benchmark limitations. Its citation credits Max Bittker, Surya Narreddi, Rob Haisfield and Sean Lee. This retrospective does not reproduce its benchmark results.

### Local evidence

- [Layer ownership](../agents/LAYERS.md) and [party architecture](../agents/README.md).
- [October 27 overnight review](../agents/reviews/2026-10-27-overnight.md): repeated blockers, work coverage, trades and synthetic-log contamination.
- [Smithing investigation](../agents/reviews/2026-10-27-smithing.md) and [evening verification](../agents/reviews/2026-10-27-evening-progress.md).
- [October 28 combat review](../agents/reviews/2026-10-28-afternoon.md): improved reporting and continued safe-target habits.
- [Production cycles](designs/production-cycles.md), [supply coverage](designs/supply-coverage.md), [combat provisions](designs/combat-provisions.md) and [paired assist](designs/paired-assist.md).
- [Learning pilot](designs/exploration-pilot.md), [discovery extension](designs/discovery-week.md), [shared expeditions](designs/shared-expeditions.md) and [prepared combat challenge](designs/demon-challenge-brief.md).
- [Maintenance handoff](../agents/HANDOFF.md): dated deployments, verification boundaries, recovery failures and November 3 restoration. It is a historical record; newer entries do not retroactively establish earlier success.
- Raw evidence is local under `agents/runs/*/events.jsonl`; examples include `2026-10-29T17-45-27-974Z`, `2026-10-30T13-59-12-919Z`, `2026-10-30T17-06-44-434Z` and `2026-11-03T15-41-06-046Z`. Raw runs and live state are not required to read this presentation and may not be present in a fresh checkout.

**Presentation use:** sections 1–12 form the talk outline. Keep the evidence appendix available for questions, especially about costs, verified outcomes and the boundary between agent behavior and maintenance intervention.
