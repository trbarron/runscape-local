# Mission coordination: observed behavior

Status: baseline at source commit `7b446a5` plus the 2026-10-27 working tree. This describes current behavior and its limits, not proposed guarantees.

## Candidate contracts

missions.ts defines checks for skill level (all/any, optionally a named member), stock item/count, worn match/pieces, monster kills, combat level and party coins. Candidate context contains members with skills, combat, worn items, carried stock and last-seen bank stock, plus resource spots and achievement facts.

The source baseline had 27 templates: five broad missions, eight ore reserves, three wood reserves, three bar reserves, three food reserves and five skill workshops. The current working tree adds species-specific fish recipes plus Firemaking, Fletching and Crafting workshops, bringing the library to 30 templates, and mithril and adamantite bar reserves bring it to 32. Reserves are an easy fallback: only the frontier bar tier is offered, a reserve the party already half holds is skipped, and reserves fill a shortlist only when fewer than three other offers exist and none of the last two missions was a reserve. Firemaking and Fletching use bounded log batches; Crafting builds gold jewellery through mould, gold-bar and furnace dependencies, and gem jewellery only when cut gems are already available or uncut gems can be cut from owned stock. mission-chain.ts attaches work records with owner, action, target and optional amount, destination, skill, level and note. It checks currently qualified workers, indexed resources, suitable tools, own funds and materials, recipes and stations. Existing stock reduces required new production. Named raw and cooked targets prevent unrelated food from satisfying a requested cooking action.

Feasibility is conservative and best effort. It cannot prove safe eventual success or fresh bank stock. Resource chains exclude wilderness and toll-dependent locations for these missions. Runtime hazards, burns, price changes and partial results still require recovery. Swordfish cooking is supported for existing raw stock at Cooking 45. The current working tree indexes a Musa Point cage/harpoon cluster and has ferry-backed actions for tuna 35, lobster 40 and swordfish 50; mission feasibility reserves 60 own coins for the round trip. Fishing actions enforce each catch level in fishing.ts (the generic `lure` entry requires 20 for trout and salmon; the species entry for salmon requires 30), including anchovies 15, sardine 5, herring 10, trout 20, pike 25 and salmon 30. Runtime loading and an end-to-end fishing trip remain unverified; see [the swordfish feature spec](swordfish-fishing.md) and [skill workshop scope](skill-workshops.md).

## Refresh and selection

opportunities.ts fingerprints member capabilities, inventory/equipment, bank observations, sites and the kill ledger. Candidates rebuild when facts change or after five minutes. The council's minute tick and menu endpoint consult this cache; selection forces a refresh. The shortlist has at most five choices, first spreading across categories then filling remaining slots. Scarcity can produce fewer choices.

Stable variant keys derive from template identity and checks. The current and last three variants are excluded, with compatibility handling for older title history. Selection is requested when there is no goal, completion, explicit rescope or structural infeasibility. The old every-five-councils replacement policy is absent. Recoverable training or funding difficulties should not alone force retirement.

Council sessions are normally hourly, with a minimum fifteen-minute interval for requests. Mission selection votes directly on validated choices and uses a runoff if needed; a singleton can be accepted immediately. The later work-split discussion uses up to three rounds. An empty menu reports an error and does not fall back to an unconstrained invented mission. Fresh all-party state is required and feasibility is rechecked before acceptance.

## Handoff and execution

The plan retains milestones, automatic checks and work metadata. Automatic milestones require observed game facts; legacy/freeform milestones can instead close through two council claims, a weaker evidence class described in LAYERS.md. Replaced missions preserve unfinished checks, a reason and time in retiredMissions, capped at ten. Coverage assignment prefers an eligible claimant, then an existing owner, then round-robin ownership. Next-work text uses that owner's first work item or milestone guidance, with fallback guidance when needed.

Coverage does not validate that commitment prose matches a task, prove owner capability at execution time, or acknowledge delivery. It can remain until the next split after a milestone completes. These are current limitations, not guarantees to build against. Character loops still choose and execute their own structured actions.

`workshop-notes.ts` adds a factual WORKSHOP NOTES block comparing up to three eligible metals by XP per bar (Smithing 15+, with a bank observation); it informs rather than directs. Withdrawals before production are bounded by free slots (`production-batch.ts`, see [runtime continuity](runtime-continuity.md)). readiness.ts checks levels, funds and known bank constraints, then performs bounded preparation, including withdrawals, affordable tool purchases and freeing slots. It does not permit using another character's bank. blocked-options.ts keeps at most 24 rejected options per character for fifteen minutes, invalidating them when relevant facts change or banks refresh. Suppressing an unchanged retry does not extend its lifetime. Transient failures are not all persistent blockers.

## Acceptance checks for future changes

Use focused mission-chain, opportunity, coordination and blocker tests for changed behavior. Include scarce-resource/empty-menu cases, stale stock and owner changes, completed and retired milestones, stable variant exclusion and fact-triggered refresh. Validate named cooking against the requested raw input. Keep game-action verification separate from offline tests, and record whether a running controller loaded the change. Documentation review does not import these modules or create a new runtime session.

## Shared project policy (2026-10-30)

The live shortlist now uses [shared expeditions](shared-expeditions.md) after the user rejected
another solo Smithing ladder. Six regional templates bring the diagnostic library to38. Legacy
skill/reserve offers are diagnostic/personal options, not selected shared missions. New automatic
expedition checks retain bounded post-acceptance field proofs in the current plan; every member
surveys and practically tests, while the group covers three action types. World/XP location evidence,
not prose or old work, satisfies checks. Council event-proof merge and failed-vote preservation are
part of the state contract. No five-achievement append to expeditions; standing armour retained.
