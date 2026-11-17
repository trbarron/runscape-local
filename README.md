# Runescape Rascals

> **Archived.** The party ran from October to November 2026 and is no longer
> operated or maintained. The code is kept as a record of the experiment; it is
> not updated against newer RS-SDK releases and issues will not be addressed.

An experiment in getting four AI characters to live, learn and work together in a
persistent RuneScape world. Bram, Wren, Mike and Trish gather resources, make
equipment, explore and negotiate shared goals through a self-hosted
[RS-SDK](https://github.com/MaxBittker/rs-sdk) game server.

The aim is a party that can pursue something worthwhile together with less human
intervention over time. Level gains and full banks are useful observations, but
the more interesting questions are whether the characters coordinate dependencies,
share useful knowledge, revise stale beliefs and recover when a plan stops working.

[View the party dashboard](https://tylerbarron.com/runescape-rascals) to explore
character activity, conversations and shared mission progress as of the party's
final session on 10 November 2026.

## How it works

Each character has a persistent identity, memory and view of the world. A language
model chooses a bounded routine; code handles movement, inventory, crafting and
other repeated actions. Characters return to planning when work finishes, encounters
a blocker or needs reconsideration. A recurring council negotiates shared work.

The project separates three responsibilities:

- **Characters choose and act.** They decide what to do, negotiate help and carry
  out routines within the executor's readiness and safety checks.
- **Maintenance improves the system.** A coding assistant can inspect outcomes,
  diagnose failures and make authorized, tested repairs. An optional scheduler
  runs reviews separately from the party.
- **The human sets direction.** The operator chooses constraints and budgets,
  evaluates whether the objective is still worthwhile and decides when to intervene.

The dashboard makes activity, conversations and mission progress visible. Game
observations establish outcomes; a plan, promise or busy character does not by
itself establish progress toward the shared goal.

## What this repository contains

The party controller, planning and execution code, coordination and learning
mechanisms, tests, local server configuration and dashboard publisher. The game
and SDK are separate dependencies. The public website is maintained separately;
it observes the party rather than controlling it.

This remains an experimental system. Bank observations can go stale, coordination
can fail, and process recovery does not guarantee useful teamwork. The documents
below describe implemented behavior and known limits, rather than claiming
unattended autonomy or current deployment health.

## Explore or run it

The instructions below describe how the system was run. They are kept for
reference and have not been verified since the project was archived.

- [Local setup](docs/setup.md): dependencies, game server and optional private access.
- [Party guide](agents/README.md): startup, configuration, code layout and validation.
- [Architecture and behavior](docs/designs/SITEMAP.md): implementation contracts.
- [Layer responsibilities](agents/LAYERS.md): who owns decisions and what counts as evidence.
- [Operations](docs/operations.md): local state, reviews and safe recovery.
- [Contributor guidance](AGENT.md): making changes without disturbing an existing party.

Accounts, saves, credentials and operational history stay local. The repository
contains the software and its contracts, not a running party's private state.

## Foundation

Built on [Max Bittker's RS-SDK](https://github.com/MaxBittker/rs-sdk), which provides
the game environment and programmatic interface. This repository focuses on the
persistent party and the systems around its decisions.
