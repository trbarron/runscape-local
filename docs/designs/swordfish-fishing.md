# Swordfish fishing by ferry

Status: implemented on 2026-10-27 and loaded into the running controller by the 18:54 EDT reload recorded in the handoff; verified live on a separate test character (2026-10-27 evening) after three executor fixes below. This feature adds a supported route for the existing swordfish cooking recipe.

## Behavior

The world-index builder recognizes free-to-play cage/harpoon NPCs on Karamja and retains their clustered location even though a mainland pathfinder cannot walk to the island. The spot is marked `via: Karamja`, at Musa Point (2925, 3180), count 3. The ferry is boarded from the Port Sarim dock at (3028, 3216), where the executor talks to Captain Tobias. It places the character on the ship deck; the executor crosses the gangplank to shore before walking to the spot. The Karamja Customs officer is around (2953, 3147); the return ferry also requires crossing its gangplank at Port Sarim.

The fishing catalogue gives exact requirements to each species: shrimps 1, anchovies 15, sardine 5, herring 10, trout 20, pike 25, salmon 30, tuna 35, lobster 40 and swordfish 50. Tuna and swordfish both use a harpoon at the same NPC option, while lobster uses a pot at the same cluster. The mission chain can now assign swordfish fishing only to a Fishing 50 member and checks that the worker's own carried and banked coins cover 60 gp for a 30 gp outbound and return fare, in addition to any tool purchases.

At runtime, the swordfish fishing action withdraws its own ferry fare from its bank if needed, sails from Port Sarim, fishes the indexed spot, then returns through Customs. It stops before sailing if Karamjan rum is in the inventory because customs confiscates it. Island-return errors are reported as blockers.

## Verification and limits

`bun agents/world-index/build.ts` regenerated the index and produced one cage/harpoon cluster with three NPCs marked `via: Karamja`. `bun run --cwd agents typecheck` passed. Later focused mission and mission-chain tests passed (see the handoff), but none asserts the 60 gp ferry reserve; that is verified by source reading only. Live voyages on the `rascaltest` character (Fishing 50, 200 coins, harpoon via admin commands, started at the Port Sarim dock) found three defects, all fixed in `skills.ts`: Captain Tobias wanders and the server discards a talk sent right after arrival (retry); NPC speech arrives as "Click here to continue" pages before the choice, and the client can report a menu before the NPC has spoken (a conversation driver clicks pages and choices in order, and each voyage verifies the player actually moved before retrying); the return conversation with the Customs officer has the same shape. After the fixes, four consecutive round trips each cost exactly 60 coins and caught swordfish and tuna. The party's controller has not loaded these fixes yet. A source change alone does not reload a process; the handoff records the load.

A future live check should confirm boarding, the 30 gp charge in each direction, swordfish catching at level 50, return from the exact indexed cluster, behavior with insufficient banked fare and preservation of Karamjan rum. If the check changes code, rerun typecheck and update this verification record.
