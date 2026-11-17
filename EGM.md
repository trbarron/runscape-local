# Repository contract

Source architecture contract; deployment evidence is local.

## Scope

The first-party party controller lives in agents/. The game and SDK are dependencies in rs-sdk/. The public website is maintained in a separate repository.

## Interface

Docker serves the game; the controller connects through SDK clients and browser sessions. Design changes enter through AGENT.md and docs/designs/WORKFLOW.md.

## Invariants

Map visibility is not proof that an agent can reach or use a resource. Treat game state as authoritative; plans and last-seen banks can be stale.

## Side Effects

Starting the controller connects accounts and changes the game. Design review itself must not start it.

## Verification

Read agents/LAYERS.md and the ignored local agents/HANDOFF.md when operating an instance. Check affected source and use the package checks documented in agents/README.md for implementation changes.
