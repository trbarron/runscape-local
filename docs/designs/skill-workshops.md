# Fishing and skill workshops

Source contract; active mission and deployment evidence are local.

## Fishing by catch

Fishing actions now have exact catch targets and levels: shrimps 1, anchovies 15, sardine 5, herring 10, trout 20, pike 25, salmon 30, tuna 35, lobster 40 and swordfish 50. Existing method aliases remain available for older orders. Mission recipes use species targets so the planner's target, level check and milestone item agree. Karamja species use the ferry route and 60 gp fare reservation described in the swordfish spec.

## Firemaking and Fletching

Both workshops source logs through the existing Woodcutting chain, capped at 20 logs per work batch so gathered inputs fit the inventory. Firemaking checks for a tinderbox and plans a supported shop purchase when needed, charging it to the same owner's available funds after planned axe purchases. Fletching uses the executor's existing knife-spawn pickup and uses level-appropriate shafts or shortbows from gathered logs. The game skill milestone remains the completion check; a work batch is a progress step, not a guarantee that 20 logs reach the next 10-level mark.

## Crafting

Crafting workshops choose gold ring, necklace or amulet recipes the member can use. The production chain accounts for the mould, Crafting level, gold bars, and a qualified miner/smelter plus reachable gold ore and furnace when bars are not already held. Gem jewellery uses owned cut gems; when those are absent, owned uncut gems can be cut with a chisel first. The chain does not currently promise to buy uncut gems from finite shop stock or supply gem deposits, so it rejects those cases rather than inventing an unlimited source.

## Verification and limits

Readiness rechecks tool, level, supply and station facts during execution. A valid
chain is not proof of safe travel or eventual skill completion. Use fishing,
readiness, mission-chain and workshop tests when these contracts change.
