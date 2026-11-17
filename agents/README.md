# The party

Four autonomous characters (bram, wren, mike, trish) playing on the local rs-sdk server.
Each has a D&D character sheet. They negotiate who does what, then carry it out with
scripted skills. A cheap model (GPT-6 Luna) makes the decisions, and code does the playing.

## Responsibilities and review handoffs

[Layer responsibilities](LAYERS.md) defines the boundaries between the maintenance reviewer,
mission/council coordination, each character, execution, the game and the website. Start a review
from the ignored local `agents/HANDOFF.md`; use [the template](HANDOFF.example.md)
for a new instance. Detailed evidence belongs in ignored local reports. Runtime characters consume `planner.ts` prompts, not these Markdown files.

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

On macOS, the user LaunchAgent `com.trb.runscape-rascals` owns the persistent service.
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


## Behavior contracts

[Layer ownership](LAYERS.md) defines authority and evidence boundaries. The
[design index](../docs/designs/SITEMAP.md) covers mission coordination, production,
combat, learning and supervision. Those documents describe supported mechanisms;
the active mission and operator restrictions are local state, not universal defaults.

## Validation

From `agents/`, run `bun run typecheck` and focused `bun test <file>` checks for
implementation changes. Some tests initialize event modules and create synthetic
run logs. Do not identify production by the newest run directory. Documentation
changes need source and link checks, without runtime imports or a restart.

See [operations](../docs/operations.md) for private configuration, scorecard history
and graceful reload requirements, and [scheduled maintenance](maintenance/README.md)
for the optional external reviewer.
