# Dashboard basemap contract

Source behavior and known limits.

## Scope

A presentation map covering a larger rectangle than the resource index.

## Interface

render-basemap.ts uses the game MapView through a browser to write WebP and sibling JSON bounds. export-routes.ts exports known route paths.

## Invariants

Bounds are x=1856..3648 and z=2688..4032 at two pixels per tile. Presentation coverage is independent of free-to-play eligibility, reachability and executor capability.

## Side Effects

Rendering opens a browser and writes image metadata. The renderer expects a .webp output path. Route export writes its selected output JSON.

## Verification

Inspect the rendered map and bounds together, and check dashboard viewport cropping in the separate website repository. Browser cleanup on failure and output-extension validation remain limitations of the current utility.
