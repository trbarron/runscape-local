import type { BotWorldState } from '../rs-sdk/sdk/types';

export function onTutorialIsland(p: { worldX: number; worldZ: number }): boolean {
    return p.worldX >= 3050 && p.worldX <= 3150 && p.worldZ >= 3050 && p.worldZ < 3150;
}

export function atFerryDock(p: { worldX: number; worldZ: number }): boolean {
    return Math.hypot(p.worldX - 2956, p.worldZ - 3145) <= 14
        || Math.hypot(p.worldX - 3030, p.worldZ - 3217) <= 14;
}

/** A reachable hold ladder and inaccessible gangplank distinguish the hull from nearby shore. */
export function inFerryHold(s: BotWorldState): boolean {
    return !!s.player && s.player.level === 0 && atFerryDock(s.player)
        && s.nearbyLocs.some(l => l.name === "Ship's ladder" && l.reachable === true
            && l.distance <= 12 && l.optionsWithIndex.some(o => /^climb-up$/i.test(o.text)))
        && s.nearbyLocs.some(l => /^gangplank$/i.test(l.name) && l.reachable === false && l.distance <= 12)
        && !s.nearbyLocs.some(l => /^gangplank$/i.test(l.name) && l.reachable === true && l.distance <= 12);
}

export interface FerryExitOps {
    state(): BotWorldState;
    climb(): Promise<boolean>;
    cross(): Promise<boolean>;
    wait(test: (s: BotWorldState) => boolean): Promise<void>;
    cancelled(): boolean;
}

/** Never boards from shore; handles a saved login below deck before trying to disembark. */
export async function leaveDockedFerry(o: FerryExitOps): Promise<string | void> {
    let s = o.state();
    if (!s.player || !atFerryDock(s.player)) return;
    if (o.cancelled()) return 'ferry exit cancelled or pass time expired';
    if (inFerryHold(s)) {
        if (!await o.climb()) return 'could not climb the ship ladder out of the hold';
        await o.wait(s => s.player?.level === 1);
        s = o.state();
        if (s.player?.level !== 1) return 'ship ladder did not reach the deck';
    }
    if (s.player?.level !== 1) return;
    const ready = (s: BotWorldState) => s.nearbyLocs.some(l => l.level === 1
        && /^gangplank$/i.test(l.name) && l.reachable === true && l.distance <= 12
        && l.optionsWithIndex.some(o => /^cross$/i.test(o.text)));
    await o.wait(ready);
    if (o.cancelled()) return 'ferry exit cancelled or pass time expired';
    if (!ready(o.state())) return 'the docked ship gangplank did not appear in the arrival frame';
    if (!await o.cross()) return 'could not cross the docked ship gangplank';
    await o.wait(s => s.player?.level === 0 && !inFerryHold(s));
    if (o.state().player?.level !== 0 || inFerryHold(o.state())) return 'gangplank did not reach the shore';
}
