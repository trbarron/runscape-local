# World resource index contract

Source behavior and known limits.

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
