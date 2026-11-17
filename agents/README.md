# The party

Four autonomous characters (bram, wren, mike, trish) playing on the local rs-sdk server.
Each has a D&D character sheet. They negotiate who does what, then carry it out with
scripted skills. A cheap model (GPT-6 Luna) makes the decisions, and code does the playing.

## Responsibilities and review handoffs

[Layer responsibilities](LAYERS.md) defines the boundaries between the maintenance reviewer,
mission/council coordination, each character, execution, the game and the website. Start a review
from [the current maintenance handoff](HANDOFF.md); dated evidence belongs in [reviews/](reviews/).
The [2026-10-27 overnight review](reviews/2026-10-27-overnight.md) separates findings from proposed
behavior changes. Runtime characters consume `planner.ts` prompts, not these Markdown files.

## Run

The game server must be up (`docker compose up -d` in the repo root). The OpenAI key goes
in `../.env` as `OPENAI_API_KEY=...`.

```sh
bun agents/service.ts install   # macOS: persist through terminal/tool exits; starts now and at login
bun agents/service.ts status    # launchd state, process IDs, heartbeat age and current run
bun agents/service.ts stop      # unload service; graceful shutdown and verified saves
agents/run.sh                   # interactive supervisor; Ctrl-C stops it
bun agents/orchestrator.ts      # direct controller, without durable supervision
bun agents/metrics.ts            # metrics for the latest run (or pass agents/runs/<dir>)
```

A clean stop (Ctrl-C or SIGTERM) cancels the running orders and closes the game clients.
It then waits up to 150s for the server to save each character, which happens about 100s
after a client disconnects. The server also autosaves every 1,500 ticks.

On this Mac, the user LaunchAgent `com.trb.runscape-rascals` owns the persistent service.
It runs while the user is logged in, restarts a lost supervisor, and allows up to 360 s
for shutdown/recovery. Do not start a second controller alongside it. `service.ts start`
loads a stopped service again. The plist contains paths/PATH; API credentials remain in
the repo's `.env`. Logs are `agents/runs/service.log` and `supervisor.jsonl`; controller
events remain in their individual run directories. Heartbeats under `agents/state/`
report the controller and supervisor separately. The controller heartbeat also records
its private browser endpoint for recovery; do not publish that file.

The supervisor restarts an exited controller, gives startup 180s, and asks a controller
with a heartbeat older than 90s to stop gracefully. After a crash it closes only the
recorded, exclusively owned party browser and verifies fresh character saves before
logging back in. An orphaned supervised controller is stopped before replacement.
Unknown ownership or unverified saves block recovery and are logged for maintenance.
This is process supervision; the separate gameplay watchdog still requires invocation.

Dashboard: http://localhost:7790. Everything it shows is also written to `agents/public/`
(`index.html`, `snapshot.json`, `shots/*.png`, `map.png`). Copy that folder to any static
host to publish it.

## How it works

```
             ┌──────────────── council (every hour / on request) ───────────────┐
             │  up to 3 rounds; each agent speaks once a round → pinned party plan │
             └──────────────────────────────┬────────────────────────────────────┘
                                            │ interrupt: "new plan"
 board post to you ─ interrupt (≤1 per 3 min)┤
 death / routine done / step blocked ───────▶│
                                            ▼
          ┌──────────── decide (LLM) ────────────┐     every 12 decisions: reflect (LLM)
          │ sheet + situation + plan + board +    │     → rewrites the agent's notes
          │ available actions → routine (1-6      │
          │ steps, may repeat), posts, goal       │
          └──────────────────┬────────────────────┘
                             ▼
          ┌──────────── execute (no LLM) ────────┐
          │ run the steps in order, each until    │
          │ its condition; loop if repeating;     │
          │ auto-bank; serve hand-offs; log walks │
          └───────────────────────────────────────┘
```

The model is called only at decision points:

- **Decide.** Called when a routine finishes, a step is blocked, stuck, partial or yields, a teammate posts
  directly to the agent, the agent dies, or a council sets a new plan. It sets a routine: a
  named list of 1-6 steps, each an action plus a stop condition (minutes, a skill level,
  items gathered, or "exhausted": until out of materials or the pack is full), optionally
  repeating. A repeating routine stops after 30 minutes or a loop that gains nothing. The
  model sees how every step went; an interrupted routine can be resumed from its step. It
  can also post messages, make or resolve commitments, set a goal, or call a council.
- A productive step that reaches its 20-minute budget is `yielded`, with its target
  still unfinished and resumable. A step with no measured progress is `stuck`. A
  productive crafting step with no remaining usable inputs is `partial`; it does
  not complete its count/level target. Available own-bank supplies are replenished
  between passes without another planner call.
- Ingredient withdrawals are bounded to a current batch using free slots, required
  tools and ingredient ratios. The downstream count/level target stays fixed.
  Withdrawal events distinguish requested, current batch and received quantities;
  insufficient bank stock is reported as a partial withdrawal.
- Smelting reports count observed resolved attempts, actual bar types, confirmed
  recipe inputs, ordinary iron impurity losses and reach failures separately. Only
  fresh server messages count; repeated snapshots and player chat do not. Ten
  consecutive confirmed iron impurity losses yield with the target unfinished.
  Ordinary losses are not treated as three idle passes, and consumed ore never
  becomes fabricated bars or XP. Missing supplies and genuine reach/level failures
  retain their own outcomes. Steel uses raw iron ore plus two coal and bypasses
  the iron-only impurity roll.
- **Council.** Called at start-up, every hour, or when an agent says the plan no
  longer works (at most every 15 minutes). There are up to 3 rounds, and each agent speaks
  once per round. It ends early when all four agree.
- **Reflect.** Runs every 12 decisions and compresses recent history into notes to self.

Routine work never calls the model: walking, gathering, banking when the pack is full,
eating, fighting, trading hand-offs, and loot. The loop breaker forces a scripted rest if
an agent makes more than 10 decisions in 10 minutes.

## Files

| File | What it is |
|---|---|
| `characters.ts` | D&D sheets; leanings derived from ability scores (no listed favourite activities) |
| `skills.ts` | Scripted skills with declared requirements (`requires`) and abortable passes |
| `world.ts` | The atlas: places, banks, dangers, landmarks |
| `world-index/build.ts` | Generates `world-index/index.json` from the game server's map and NPC data: every tree, rock, fishing spot, furnace, anvil, range, bank and monster in the F2P world (ground floor, including wilderness), clustered into spots, checked walkable from Lumbridge |
| `world-index/index.ts` | Queries over the index: nearest spots, level needs, the per-turn "nearby options" block, and answers to an agent's `lookup` (asked again at once with the answer) |
| `shops.ts` | Shop catalogue (stock and prices) read from rs-sdk's wiki |
| `scorecard.ts` | Before/after metrics for each entry in `changes.json` (`bun agents/scorecard.ts`; `mark` starts a new window) |
| `routes.ts` | Travel log: every walk and how it went (safe, hurt, died, failed), shown to every agent |
| `banks.ts` | Each character's bank contents, as last seen open (for the party facts) |
| `agent.ts` | One agent: decision points, standing orders, interrupts, deaths, hand-offs |
| `planner.ts` | Everything the model sees and returns (decide / council / reflect) |
| `council.ts` | Negotiation rounds → `state/plan.json` |
| `board.ts` | The party's message board (`state/board.json`) |
| `memory.ts` | Per-agent goal, commitments and notes (`state/memory-<name>.json`) |
| `metrics.ts` | Metrics from the event log; also a CLI |
| `llm.ts` | Responses API client, cost ledger, hard budget (`runs/ledger.json`); routes a bot to another model through `models.json` |
| `models.json` | Optional, untracked: `{"<bot>": {"baseUrl", "model", "apiKeyEnv?", "price?"}}` puts that bot on any OpenAI-compatible chat endpoint (a local Ollama, Kimi). Read on every call; a failed call falls back to `PLANNER_MODEL` for that decision. `price` is USD per 1M tokens (`{input, output}`); local models are free |
| `watchdog.ts` | Health check over the event log; exits 2 when something needs a look (`bun agents/watchdog.ts --minutes 30`) |
| `run.sh`, `supervisor.ts`, `service.ts` | Interactive entry point, bounded controller recovery and durable macOS LaunchAgent; hold the machine awake with `caffeinate` |
| `dashboard.ts` | Screenshots, `snapshot.json`, static page, local server |
| `orchestrator.ts` | Start-up, browser clients, supervision, clean shutdown |

Runtime state lives in `state/` (survives restarts), `runs/<time>/events.jsonl` (one per
run) and `accounts.json` (the bots' passwords). Do not delete `accounts.json`: the server
keeps each account's password, so a new one cannot log in to the old character.

## Missions and opportunity refresh

`missions.ts` contains 27 parameterized templates: five broad party missions, eight ore reserves,
three wood reserves, five bar reserves (bronze to adamantite), three food pantries and five skill workshops. Concrete
checks, counts and roles are derived from game facts, not a queue of LLM-written future chores.
`mission-chain.ts` verifies supported production links: indexed non-wilderness spots, stations,
actual recipes, each assigned worker's current levels, usable owned tools, suppliers, and affordable
purchases from that buyer's own coins. Higher/mixed armour counts toward upgrades; quest-specific
bosses and skill targets above 99 are not offered. Existing stock counts, and reserves only produce
the shortfall rather than consolidating everyone's bank contents.

Stock reserves are the easy end of the library, so they are held back: a bar reserve is offered only
for the best metal the party's best smith can make (five bar tiers, bronze to adamantite), a reserve
the party already half holds is skipped, a reserve only tops up a shortlist with fewer than three
other offers and never follows another reserve, and a template used in the last two missions sorts
after fresh ones. The characters still choose from what is offered.

`opportunities.ts` keeps a diverse shortlist of at most five offers. The council check and diagnostic
endpoint re-read facts; a changed input invalidates the cache and unchanged inputs refresh after
five minutes. Mission selection forces fresh validation, including after voting. The current and
three recently run exact variants are excluded by stable objective keys (older title records still
work). A validated singleton stays valid; zero candidates logs a diagnostic instead of falling back
to uncheckable freeform missions. `curl localhost:7790/menu.json` reports generation time, eligible
count, the shortlist, and all 27 templates' eligibility/selection reasons.

Refreshing offers never replaces a mission. Councils reassign work hourly or on a bounded request;
a mission changes on completion, explicit rescope, or a confirmed structural dead end. Temporary
loss of supply funding is recoverable work, not automatic retirement. When an infeasible mission
is replaced, its unfinished objectives and reason are preserved in `plan.retiredMissions` (last ten).
In particular, the old swordfish goal is detected as unsupported while no cage/harpoon spot exists.

Characters choose the mission and negotiate ownership. Every open milestone needs an accountable
owner before a council can claim full agreement. `plan.coverage` records an owner, concrete next
step and productive fallback; if three negotiation rounds leave gaps, validated suggested ownership
is made explicit in the saved plan. Work-chain suggestions refresh from facts while the objective
checks remain stable. This is accountability, not automatic execution or a completed delivery.
The party still chooses its routines, and existing trade safety/capacity checks remain in force.
For a named worker's production chain, feasibility first tries a complete chain using that
worker's own stock, tools, funds and skills. A failed attempt rolls back all proposed steps,
reservations and spending before considering shared supplies. When personal production is
feasible it avoids adding a rendezvous solely to consume a teammate's small surplus.

Normal decisions, council turns and reflections also include small workshop notes for
qualified smiths: eligible metals ranked by base XP per bar, the character's own last-seen
bar/ore/coal supplies, batch/travel facts and the next locked metal tier. Levels and XP come
from game configs. These are choices and resource facts, not a mandated recipe or an XP/hour
promise; the notes also make the own-ore smelting link visible when pre-made bars are absent.

New template milestones use automatic game checks (stock, wear, kill, combat, skill and coins).
Only legacy non-automatic objectives can close on two council claims. Template additions need a
rejected-reason path, supported production chain and regression cases, not just new prose.

Fishing methods and smelting inputs live in shared `fishing.ts` and `smelting.ts` definitions.
Long fishing orders buy/withdraw a small batch of bait/feathers and re-enter bounded readiness
when it runs out, rather than re-planning the same supply failure. Named cooking steps fetch and
cook that recipe, and cooked delivery/withdrawal targets distinguish food from raw fish. Generic
material blocker memory uses the actual requirement pattern (and relevant usable-skill level), so
new fish/gem/tool supplies can invalidate a blocker whose human label is not a literal item name.

## Settings (environment variables)

| Variable | Default | |
|---|---|---|
| `BUDGET_USD` | `24.77` | Hard cap on total model spend across runs (see `runs/ledger.json`) |
| `PLANNER_MODEL` | `gpt-6-luna` | Model for all calls |
| `BOTS` | all four | Comma-separated subset, e.g. `BOTS=bram,wren` |
| `SHARE_INVENTORY` | `true` | `false` hides teammates' carried items, so they have to ask |
| `SHOT_EVERY_MS` | `600000` | Screenshot interval (10 min) |
| `PORTRAIT_EVERY_MS` | `300000` | Portrait appearance check interval (5 min; minimum 1 min) |
| `DRAW_FPS` | `8` | Cap on the browser clients' redraws; they otherwise draw ~70/s and use a CPU core each |
| `DASHBOARD_PORT` | `7790` | |

## Metrics

Shown on the dashboard and printed by `bun agents/metrics.ts`:

- **decisions/h** and **repeat rate**: how often the model is consulted, and how often it
  just re-picks the same action.
- **triggers / outcomes**: why decisions happen (order done, blocked, stuck, message,
  council) and how orders end.
- **xp/h**, **deaths**, **rest share**.
- **promises**: commitments made, kept and dropped.
- **fits leanings**: the Spearman correlation between the ability-derived leanings and the
  time actually spent per activity (1 = does what suits them, -1 = the opposite).
- **cost** per bot, per hour, and councils held and agreed.

## The website

The dashboard publishes its snapshot (and the achievements list) to the website's Redis when
`REDIS_URL` is in `../.env`; the page at tylerbarron.com/runescape-rascals lives in the
`tylerbarron-dot-com` repo and changes to it are PRs there. A PR that changes how the page
looks gets screenshots from that repo's `npm run pr-screenshots` (production vs. the branch,
posted as a PR comment by the script; see its `AGENT.md`), not images dragged in by hand.

The snapshot goes out in pieces (`lanes.ts`) because the shared 30 MB Redis plan has a 5 GB monthly
network allowance and one 170 KB value rewritten every few seconds used it up. `runescapeRascals:snapshot:fast`
(each character's position, action and HP, plus the liveness stamp; plain JSON, about 1 KB) is checked every
15 seconds. The rest is gzipped into `snapshot:core` and `snapshot:log` (checked every minute) and
`snapshot:history`, `:routes`, `:achievements`, `:scorecard` (every five minutes); the scorecard alone is
most of the old size and rarely changes. A piece is written only when its content changed, except the fast
lane, which is rewritten at least every 45 seconds as a heartbeat. A field added to the snapshot with no
section of its own lands in the core. The site (`snapshot.server.ts`) reassembles the pieces and falls back
to the old single `runescapeRascals:snapshot` key if the new ones are absent. The local
`public/snapshot.json` is still written every 15 seconds. Changing a section's name or fields means
changing both repos.

Portraits and screenshots do not go through Redis when `RASCALS_S3_BUCKET` is set in `../.env` (with
`RASCALS_S3_REGION` and, preferably, `RASCALS_AWS_ACCESS_KEY_ID` / `RASCALS_AWS_SECRET_ACCESS_KEY` for an
IAM user limited to `images/rascals-live/*`; without them the default AWS credentials are used). `assets.ts`
uploads them to the website's bucket, which CloudFront serves from the site's own `/images/*`: portraits as
`portraits/<name>/<kind>-<angle>-<version>.png` (immutable; a new version replaces the character's old
objects after the full set is up, and an unchanged version uploads nothing) and screenshots as
`shots/<name>.jpg` (replaced in place, five-minute cache). The snapshot then carries `assetBase`, which
tells the site to use those URLs; without the bucket settings everything stays in Redis as before.

## Portraits

While the party runs, an appearance check starts after 45 seconds and repeats every five minutes (`PORTRAIT_EVERY_MS`). A separate, bounded renderer reads the latest game saves and redraws only changed appearances into `agents/public/portraits/`. Complete head/body PNG pairs are published to Redis; the snapshot carries their appearance version so the website refreshes changed portraits without a deployment. Unchanged pairs refresh their seven-day expiry. Bundled website portraits remain a fallback. Equipment must reach an autosave before it appears in a portrait, so this is periodic rather than immediate.

`bun agents/portraits/render.ts` renders each character's head and full body (kits, colours and worn items, read from their save) with the game client's own model code, for the website's roster. It builds a copy of the client with a render hook (`agents/portraits/build.ts`), loads the title screen in a headless browser, and never logs in, so the party is untouched. It only re-renders a character whose look changed (`--force` redoes all; `--out <dir>` picks the folder, by default the website repo's `public/images/runescape-rascals/portraits`).

Promise metrics use the last three hours: new promises kept/dropped/open refer only to promises created in that window, matched by ID per character. Earlier promises resolved in the window are counted separately; they never inflate the new-promises fraction.

Each figure is rendered from 16 angles (`ANGLES` in `portraits/manifest.ts`; client yaw 0-2047 in
steps of 128). Angle 0 keeps the original file name (`bram-head.png`), the others add `-<n>`. Redis
keys follow the same rule (`portrait:<bot>:<kind>` and `:<kind>:<n>`), and the snapshot reports
`portraitAngles`, which the website's viewer uses to decide whether it can rotate.

## Routine readiness and recovery

The executor checks known skill, wear and purchase-budget requirements before starting a routine. It allows earlier training steps to satisfy later level requirements. Explicit withdrawals absent from known bank stock are rejected before the trip; earlier deposit steps are allowed to supply later withdrawals. Inputs are checked from fresh game state when each step begins, so a later step can use what earlier steps produced. Missing usable tools and materials can be withdrawn from the character's own known bank stock; missing tools and stackable supplies can be bought when affordable. Preparation withdraws banked coins and banks surplus for inventory room, with at most ten preparation actions per step and a stop if inventory does not change. It does not borrow from another character's bank or assume unavailable stock exists.

Equipment, tool-use, smithing and cooking requirements come from the server's configs. Already-worn gear, achieved skill-level goals and completed banking cleanups count as successful steps. Shop opening retries once after resetting the interface and checking position; purchases can try one other known seller. Repeatedly failing shops cool down for five minutes. All work remains subject to live game checks, interruptions and the existing danger checks.

Regression checks: `bun test agents/readiness.test.ts agents/shop-recovery.test.ts agents/lookup-text.test.ts agents/promise-metrics.test.ts` from the repository root; `bun run --cwd agents typecheck`.

The website basemap (`agents/map/render-basemap.ts`) now covers the complete surface band, including the wilderness: x 1856–3648, z 2688–4032. Its exported JSON supplies the website's coordinate bounds. The website fits its viewport around current party positions and recent trails; historical roads and unrelated landmarks do not expand the view.

Game screenshot capture has a ten-second timeout per canvas read, validates JPEG output, and recovers a replaced character tab in the same capture cycle. Only fresh in-game clients are captured. Local files are replaced atomically; local capture time and the last confirmed Redis publication time are tracked separately, so a failed upload cannot advertise old bytes as a new screenshot. Invalid screenshot intervals are clamped to at least one minute.

## Remembering unavailable options

`blocked-options.ts` stores up to 24 recent deterministic feasibility failures in each character's
memory. Missing own-bank items, unavailable preparation materials, recognized equipment-level
requirements and insufficient funds become explicit unavailable options in the next decision.
Preflight enforces them before proposal messages or memory updates are applied, and execution
rechecks at each step boundary, including resumed routines. Relevant stock, equipped items,
required levels, funds or a new bank observation invalidate the matching observation; unrelated
inventory/skill changes do not. Observations expire after 15 minutes and suppressed attempts do
not extend that deadline. Earlier acquisition or training can enable a later step. Whole-routine
overspending does not blacklist an individually affordable later purchase. Combat, route/shop
transients and other unrecognized failures retain their existing recovery instead of entering
this cache. New observations and preflight suppressions log `option-blocked` / `option-suppressed`
info phases. This reduces repeated impossible attempts; it does not assign milestone owners or
change mission selection.

## Everyday outfits

Wearing armour is a standing preference, not just a completed mission milestone. The character
prompt encourages keeping a chosen outfit on during normal work, and considering recovery of
empty core slots after a death or swap at a convenient safe break. A short per-turn reminder
names only missing head/body/leg slots, using fresh in-game state. Fully equipped characters get
no repeated reminder. Outfit choice still balances useful bonuses, appearance and individuality;
this does not automatically equip/buy gear, interrupt work or require a matching set.

When a website portrait looks unarmoured, check actual worn state and the portrait URL before
assuming a character removed equipment. The small roster images must receive `assetBase` just
like the expanded viewer; otherwise S3 publishing can leave them falling back to old bundled
portraits after the Redis endpoint returns 404.

See the [design baseline](../docs/designs/SITEMAP.md) for source contracts and the spec/review workflow.

## Optional paired combat

A character may propose a short hunt compatible with the mission. The leader sets a non-repeating
routine `invite_assist` targeting the partner (minutes 1), immediately followed by `fight` targeting
the agreed monster (minutes 1–15). An urgent invitation lets the partner choose whether to join.
Acceptance is one `assist` step targeting the leader (minutes 1–15, no repeat), not an automatic
response. Meet locally with food first; rendezvous is limited to60 s and64 tiles on the ground
including wilderness. Existing solo combat must finish before readiness.

The assistant follows and joins only that exact NPC when its actual tile is multicombat. For
example, the indexed Barbarian Village spawn at 3080,3415 is in a multicombat zone, but individual
moving targets are rechecked. Monster suitability and partner choice remain character decisions.
Both keep their own safety rules. Consent expires within 15 min; interruption, routine end and
restart clear it. Shared engagement logs are observations, not shared kills or damage attribution.
See [design and verification](../docs/designs/paired-assist.md) for limits and failure handling.

Wilderness travel and paired combat are permitted. Characters are encouraged to try short,
prepared shallow expeditions, bank valuables first, carry food and useful replaceable gear,
choose a return destination and reassess after 5–10 minutes. This is a preference, not a new
hard geographic cap or a forced change to their mission. Hunters can consider indexed wilderness
monsters; non-wilderness production-chain supply checks remain conservative. Exact targets,
multicombat rules, consent, session bounds and independent retreat still apply; no PvP action is added.

## Whole-order fight reports

Fight summaries and `order_end.fight` now aggregate the entire order across all execution passes.
They report exact-target engagements, observed zero-HP target defeats, unresolved endings,
observed HP loss, observed eating, skill XP/hour and operation timings. A disappearing NPC is
not a confirmed kill, and observed defeat is not kill-credit attribution. Combat/attack timing
may include approach movement inside SDK helpers; explicit navigation and loot/bury have their
own categories. Old log entries retain their original reports. These observations do not change
the existing legacy XP-based first-kill achievements or issue a training-method recommendation.

## Combat food preparation

Characters see nominal carried healing, stronger observed own/teammate supplies and cooking/fishing
opportunities. They choose producer, recipient, method and return plan. Readiness requires food
actually carried before non-starter fights/invites/assist, using a target/duration-based entry budget:
half max HP for easier fights, two equivalents for higher-HP/level or wilderness-only targets,
scaled for short outings and capped at10min. Invite uses the full larger budget. This is a starting
heuristic, not guaranteed survival. The generic five-fish travel reserve is unchanged.

A complete own-bank cooked-fish load is checked for slots and bounded preparation actions before
any withdrawal/weak-food replacement. Otherwise a clear blocker requests better supplies, a
confirmed handoff, free space or a shorter outing. No invented stock or automatic teammate control.
Eating chooses useful healing per action, limiting overheal on ties. Fight reports include consumed
food types/counts and nominal healing capacity; account for supply-production/travel time separately.

The fight action keeps the same live NPC through low-HP recovery, zero-XP ticks and execution-pass rollover.
It does not navigate toward a spawn or loot/retarget an unresolved fight. Independent retreat,
finite execution limits and interruption remain in force. See the [design](../docs/designs/combat-provisions.md).

## Productive failure and delivery recovery

Pickpocketing now uses carried-food entry readiness (half maximum HP nominal healing, scaled
for short2–10min sessions). A living character already within4tiles of a known ground-floor
bank, outside combat, can withdraw explicit cooked food despite low HP. Travel, raw supplies and
active combat retain normal danger checks. This does not guarantee safety against future attacks.

The controller and standalone watchdog flag three repeated blocked orders with positive XP,
grouped by character/action/numeric-normalized reason. Controller warnings inspect its bounded
500-event buffer over30min, emit info and queue character notices once per group/30min, then
request council through the existing cooldown. Startup does not mark warnings sent before councils
are ready; the next order_end checks buffered history. A request does not prove a council ran.
No independent watchdog scheduler or outside alert service is installed.

Planning/council contexts show quantified coal-transfer opportunities from observed separate
stocks. The party chooses an agreeing giver/receiver, bounded quantity, meeting point and capacity;
only actual transfer counts. More mining/banking is not delivery. Bulk notes must be deposited and
withdrawn normally before smelting. No supplier is assigned automatically and bank age/current
stock still need verification. See [progress recovery](../docs/designs/progress-recovery.md).

## Bounded exploration and learning pilot

The controller initializes `state/learning-pilot.json` once for a 24-hour pilot. Restarting preserves
expiry; after expiry retrieval continues read-only. The planner can author one optional ambition per
character, revise/pause/retire it and attach an explicitly unverified interpretation to an existing
executor observation. Automatic retrieval supplies relevant guide records in existing decisions and
councils. There are no extra model workers; decision output allowance is 1200 tokens.

`learning-pilot.ts` owns pure bounded reducers/ranking; `learning.ts` owns validated atomic persistence.
Only accepted decisions update intentions. Order-end events supply immutable observations; proposed
targets and prose do not establish visits, deliveries or mission completion. Current game state wins.
The existing mission, standing priorities and readiness/recovery checks still govern execution.
Invalid saved state disables capture with a warning rather than silently resetting the pilot.
Do not edit the cached file while running. Evaluate sustained projects and evidence-driven changes
after a day; entry counts alone are not success. See [design](../docs/designs/exploration-pilot.md).

Follow-up cleanup derives the current routine's named smithing outputs for broad bank deposits;
unrelated carried gear/tools and food reserve are preserved, and explicit item deposits stay scoped.
Production loops stop when only supply shuffling made progress. Note-qualified bank targets match
pack names, and mixed same-name item forms cannot be handed off ambiguously. Characters without
a current/history ambition receive one optional invitation in a normal decision. Accepted decisions
persist `ambitionInvitedAt` in memory; null declines, lookup/rejected proposals do not consume it.

## Supply coverage and replenishment

`SupplyCoverage` is advisory context, not a second planner or inventory controller. `supply-context.ts`
combines fresh character state, dated bank views, supported intended mission work and routines;
`supply-coverage.ts` calculates45min working targets and a below10min refill threshold. Rates use
recent verified whole-order smelting attempts/food use or clearly labelled planning priors. Food
coverage uses healing HP; proposed offers use actual whole fish, with food/own-work reserves.

The controller checks once/minute and queues notices plus existing-cooldown council requests,
maxonce per recipient/item/15min. Unknown/stale banks require verification, not a promise; banks
older than30min are excluded from available supply. Skills retain supported method intent while
on fallback; finite stock goals cap work to remaining needs. Completed delivery history cannot
cover consumed stock. Characters negotiate supplier/receiver/amount/reserve/meeting/capacity and
verify actual trade. No stock is reserved or moved automatically. Competing requests must be
reconciled; the adviser does not implement durable delivery acknowledgment. Existing readiness
still checks usable ingredients, food and note conversion. See [design](../docs/designs/supply-coverage.md).

## Bounded own-stock production cycles

A pure own-bank production routine ending in banking can continue the character's chosen pipeline
when every production stop is `exhausted`. This means a carried batch ended, rather than all owned
inputs vanished. Explicit quantity/time/skill-level production targets, trades, travel and other
activities do not acquire automatic repeat. Existing explicit repeat remains character-owned.
Continuation needs actual productive progress, fresh state and a dated own-bank recipe proof;
recursive capacity accounts for multi-bar recipes and banked intermediates. Ambiguous carried
notes do not authorize another cycle. No external supply, method change or new raw purchase is
chosen by this mechanism. Pass/step starts respect the30min invocation window; ordinary readiness,
no-progress stops and council/shutdown interruptions remain. Restart resets the invocation window
as existing routine execution did; no durable across-restart deadline is claimed.

`order_end.productionBatch` and readable reports distinguish observed carried inputs, known bank
stock and verified recipe capacity. Capacity is not a promised output. Supply advice recognizes
own upstream production instead of requesting intermediate bars from teammates. Exact known
craft/fletch/smith outputs join broad cleanup; unrelated gear/tools and food reserve remain scoped.
See [design](../docs/designs/production-cycles.md).

Hourly operations reviews and automatic tested local commits: [setup and controls](maintenance/README.md).

### Discovery week

See [the extension contract](../docs/designs/discovery-week.md). The original24h learning pilot can
be renewed once by an explicit operator action authorized by the user. It then runs seven days from
the saved extension timestamp; ordinary startup never renews it. Successful look/conversation evidence
is captured with actual coordinates and dispatch results; characters can attach later test results to
hypotheses. Optional discovery hints use existing actions without replacing the agreed mission.
No new model worker or budget increase; shorter routines/lookups may consume the remaining budget
before the calendar week ends. Review actual outings, tests/results, spend and repeated failures.

### Shared party projects

Live mission selection now offers regional field expeditions: every character surveys and tests a
method or talks to a real NPC, and the party compares at least three activity types. These are
bounded outings rather than level targets; personal training remains available. Actual executor
proofs in plan checks survive restart independently of the learning guide. They do not prove quest
completion or that an interpretation is true. See [shared expeditions](../docs/designs/shared-expeditions.md).

### Prepared combat progression

Current user-authorized mission policy offers the guard→white-knight challenge, replacing repeated
regional checklists. Prepare40cooked swordfish and steel-or-better melee weapons, choose/consent to
a fighting pair, complete corroborated Falador guard then knight encounters and return both fighters
to Falador east bank. Existing readiness, food, retreat and mapped multicombat rules remain. No new
level grind or automatic demon escalation. Actual paired encounter and observed defeat are separate
facts, not shared kill-credit attribution. See [challenge contract](../docs/designs/demon-challenge-brief.md).
The local total model cap is24.77USD after the2026-11-07 authorized5USD addition; ledger spend is retained. API account
credit is external and not inferred or reset by this cap. Completed challenge awaits operator review.
