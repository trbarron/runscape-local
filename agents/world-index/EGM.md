# World resource index contract

Status: observed baseline at source commit `7b446a5`, 2026-10-27. This is a scoped architecture contract, not a lossless reimplementation specification.

## Scope

Static, generated resource discovery used by navigation and mission feasibility.

## Interface

index.ts exports SPOTS, PLACE_NAMES, NEEDS, nearest, lookup, nearbyOptions and reachability helpers. build.ts generates index.json from game configurations.

## Invariants

The build covers eligible free-to-play ground-plane locations below z=4000 and reachable clusters, plus marked Karamja fishing locations reachable by the Port Sarim ferry. Cluster centres can need snapping. nearest excludes toll locations by default; lookup has different filtering semantics. Wilderness is still represented. A `via` field identifies resources requiring the ferry; do not treat those as mainland walking destinations.

## Side Effects

Building replaces the generated index. Importing initializes pathfinding and loads the index; read source without importing it for documentation work.

## Verification

After resource changes rebuild using the documented command and inspect affected types and coordinates. Validate both resource presence and executor support: an indexed resource alone does not establish an executable chain.


## Current change

The 2026-10-27 working tree includes the ferry-backed Musa Point fishing spot described in [the swordfish spec](../../docs/designs/swordfish-fishing.md). The header commit identifies the original observed baseline; it has been loaded since the 18:54 EDT reload recorded in the handoff; the live route is unverified.
