# Fishing and skill workshops

Status: implemented on 2026-10-27 and loaded into the running controller by the 18:54 EDT reload recorded in the handoff; complete live production chains are unverified. This adds the three reviewed skill paths alongside the ferry route in [swordfish fishing](swordfish-fishing.md).

## Fishing by catch

Fishing actions now have exact catch targets and levels: shrimps 1, anchovies 15, sardine 5, herring 10, trout 20, pike 25, salmon 30, tuna 35, lobster 40 and swordfish 50. Existing method aliases remain available for older orders. Mission recipes use species targets so the planner's target, level check and milestone item agree. Karamja species use the ferry route and 60 gp fare reservation described in the swordfish spec.

## Firemaking and Fletching

Both workshops source logs through the existing Woodcutting chain, capped at 20 logs per work batch so gathered inputs fit the inventory. Firemaking checks for a tinderbox and plans a supported shop purchase when needed, charging it to the same owner's available funds after planned axe purchases. Fletching uses the executor's existing knife-spawn pickup and makes shortbows from the gathered logs. The game skill milestone remains the completion check; a work batch is a progress step, not a guarantee that 20 logs reach the next 10-level mark.

## Crafting

Crafting workshops choose gold ring, necklace or amulet recipes the member can use. The production chain accounts for the mould, Crafting level, gold bars, and a qualified miner/smelter plus reachable gold ore and furnace when bars are not already held. Gem jewellery uses owned cut gems; when those are absent, owned uncut gems can be cut with a chisel first. The chain does not currently promise to buy uncut gems from finite shop stock or supply gem deposits, so it rejects those cases rather than inventing an unlimited source.

## Verification and limits

The 30-template count and unique template IDs are reflected in existing mission test expectations. TypeScript typecheck and the later focused mission tests passed (see the handoff). Live work execution was not verified. As of the 18:40 EDT handoff entry, no complete Crafting entry offer was eligible. Focused future verification should cover catch-specific level blockers, no/low log inventory, tinderbox funding after axe purchases, missing gem/mould/bar inputs, and actual skill gain over repeated batches.
