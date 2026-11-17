# Existing system baseline

Status: observed architecture at source commit `7b446a5` plus the 2026-10-27 working tree. This backs out design intent from implementation; it is not a complete specification for rebuilding the game or controller.

## Responsibilities and interfaces

The game server owns authoritative characters, inventory, equipment, skills and achievements. SDK observations and successful actions establish game facts. Legacy/freeform milestones can close through two council claims; this separate evidence class does not establish game-verified completion. The controller uses one decision/execution loop per character. The council chooses shared objectives and records commitments. Deterministic preparation and executor code translate supported actions into SDK calls. The dashboard and website present observations rather than controlling completion.

[Layer responsibilities](../../agents/LAYERS.md) remain the detailed ownership reference. [The handoff](../../agents/HANDOFF.md) records deployed state; design documents alone do not establish what a running process loaded. [Mission coordination](mission-coordination.md) documents the planning boundary.

## Persistence and publication

Local state lives under agents/state. The store loads fallback defaults with a shallow merge and writes temporary files followed by rename. It provides neither cross-file transactions nor a locking or schema migration framework. Bank contents are last-seen observations taken while the bank is open, so feasibility can use stale information.

Events append JSONL and feed a bounded in-memory buffer. Importing the event module creates a run directory; documentation and source review must avoid runtime imports. The message board bounds post length and rate but is not a reliable delivery/acceptance protocol. Wanted items and completed transfers likewise do not form an accepted/ready/acknowledged state machine.

Publication separates fast observations, core/log snapshots and slower history. Redis values expire after seven days. Write gates advance after successful writes. Portrait Redis publication uses MULTI, while S3 uploads and stale asset removal occur in batches without a transaction spanning the snapshot and all assets. The website consumer is in another repository and is outside this bootstrap audit.

## Cadence and lifecycle

Character decisions execute bounded actions and routines. The orchestrator restarts failed character loops with backoff (five crashes in ten minutes is the limit). Above it, a separate process supervisor (`supervisor.ts`, run under launchd by `service.ts`) restarts the whole controller on exit or a stale heartbeat, and verifies fresh saves and client disconnect before relaunch. It keeps a lock and two heartbeat files under agents/state, plus `agents/runs/supervisor.jsonl` and `service.log`; see [runtime continuity](runtime-continuity.md), which also documents yielded/stuck/partial outcomes (`execution-outcomes.ts`) and bounded production withdrawals (`production-batch.ts`). The 360 s launchd stop allowance exceeds the 150 s save wait. Shutdown closes clients and waits up to 150 seconds for fresh saves; it can still exit after warning about a missing fresh save. Operators must verify saves before a restart that depends on them.

The local dashboard defaults to port 7790 and refreshes its snapshot every 15 seconds. Game screenshots start after 45 seconds and schedule the next capture ten minutes after completion by default, with an environment override and a one-minute minimum. Portrait refresh starts after 45 seconds and schedules the next poll five minutes after completion by default, with a one-minute configuration minimum. Failed captures retain previous images; local capture time and confirmed remote publication are distinct facts.

## Capability boundaries and known gaps

Static resource coverage, map coverage, tool ownership, skill levels and executor support are separate constraints. The current working tree indexes one cage/harpoon cluster at Musa Point (three NPCs), marked as reachable by the Port Sarim ferry. The fishing action has a dedicated swordfish target requiring Fishing 50; it sails out and back for 30 coins each way and protects Karamjan rum from customs confiscation. Cooking owned raw swordfish remains supported at Cooking 45. See [swordfish fishing](swordfish-fishing.md) for implementation details and verification limits.

Ownership assignment provides accountability, not a semantic validation of the owner's commitment or a guarantee of execution. Models can choose unrelated actions. Last-seen stock, changing prices, travel hazards, cooking burns and partial trades can invalidate a planned chain.

Portrait invalidation hashes appearance and angle count but not every renderer/configuration input. The watcher sends SIGTERM on timeout without a guaranteed hard-kill escalation. S3-only publication configuration and image invalidation deserve dedicated implementation review before claiming full delivery guarantees. Map rendering has failure cleanup and output-extension limitations documented in its contract.

## Verification and scope

This bootstrap reads source and writes documentation only; it does not restart the party or run game actions. Package contracts cover first-party controller, portraits, world index and map utilities. SDK internals, credentials, saves, generated assets, live logs and the external website are excluded. Scout coverage and exceptions are recorded in the review artifact. Future changes need focused acceptance checks and an explicit distinction between source implementation, running-process loading and observed game outcomes.
