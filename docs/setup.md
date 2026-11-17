# Local setup

Install Git, Bun and Docker with Compose. The upstream checkout is intentionally
excluded from this repository. Recreate the reviewed SDK baseline and local door
recovery fixes before starting the server:

```sh
git clone https://github.com/MaxBittker/rs-sdk.git rs-sdk
git -C rs-sdk checkout b565f2d920bf6f5ec427bc6f66dc6fd64a2e15c1
git -C rs-sdk apply ../patches/rs-sdk-door-retry.patch
(cd rs-sdk && bun install)
(cd agents && bun install)
```

Create `.env` locally with `OPENAI_API_KEY` before running the party. Accounts,
saves, runtime state, logs, model overrides and environment files stay local and
are excluded from Git. Never commit credentials or private browser endpoints.
For an operated instance, create an ignored local handoff from
[the template](../agents/HANDOFF.example.md). Keep session reports and presentations
outside the public source tree.

## Run the server

```sh
docker compose up -d            # start (restarts automatically with Docker)
docker compose logs -f          # logs
docker compose down             # stop (data/ is kept)
```

Rebuild after reviewing upstream changes and reapplying local patches:

```sh
# Review upstream compatibility and reapply local patches before upgrading.
docker compose up -d --build
```

Ports are published on `127.0.0.1` only (8080/8888 web, 7780 gateway, 43594 game).
Nothing is exposed on the LAN or the internet.

## Share over Tailscale

One-time setup on this machine (Tailscale must be logged in):

```sh
tailscale serve --bg 8080       # https://<machine>.<tailnet>.ts.net -> localhost:8080
tailscale serve status
```

That HTTPS endpoint carries everything a remote user needs: the web/bot client and the
SDK gateway (`wss://<host>/gateway`). To give someone access, either invite them to the
tailnet or use **Share** on this machine in the Tailscale admin console
(https://login.tailscale.com/admin/machines). Revoke access there too.

To stop sharing: `tailscale serve --https=443 off`.

## Accounts

There's no server-wide password: any tailnet member who can reach the server can
create a new account just by logging in with an unused name. Each account's password
only protects that account. The real gate is Tailscale access.

## Connecting a bot

**On this machine:**

```sh
cd rs-sdk
bun bots/create-bot.ts mybot --local
cd server/webclient && bun src/lite/runner.ts mybot     # leave running (headless client)
# in another terminal, from rs-sdk/:
bun bots/mybot/script.ts
```

**From another tailnet device** (they clone rs-sdk and run `bun install`):

```sh
bun bots/create-bot.ts mybot --server=<machine>.<tailnet>.ts.net
```

Or open `https://<machine>.<tailnet>.ts.net/bot?bot=mybot&password=...` in a browser
instead of running the lite client.

Note: `bot.env` has `TELEMETRY=true` by default, which sends SDK bug reports to the
upstream shared server. Set `TELEMETRY=false` to keep everything local.

## Tuning

Edit `environment:` in `docker-compose.yml`, then run `docker compose up -d`:

- `NODE_TICKRATE`: ms per tick (200 = 3x real RS speed, which is 600).
  At runtime you can also use `::speed <ms>` in game (min 20, not persisted).
- `NODE_XPRATE`: XP multiplier (1 = normal; the upstream demo server uses 25).
- `GE_ENABLED=false` disables the Grand Exchange.
- `NODE_PROFANITY_FILTER=false` disables the chat filter.

## Start the party

Once the server is available, follow [the party service instructions](../agents/README.md#run).
Use [operations](operations.md) for local configuration, save verification and recovery.
