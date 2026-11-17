import { expect, test } from 'bun:test';
import type { BotWorldState } from '../rs-sdk/sdk/types';
import { inFerryHold, leaveDockedFerry, onTutorialIsland } from './ferry-navigation';

function fixture() {
    const calls: string[] = [];
    let s = { player: { worldX: 2953, worldZ: 3142, level: 0 }, nearbyLocs: [
        { name: "Ship's ladder", distance: 1, reachable: true, level: 0, optionsWithIndex: [{ text: 'Climb-up' }] },
        { name: 'Gangplank', distance: 3, reachable: false, level: 0, optionsWithIndex: [{ text: 'Cross' }] },
    ] } as BotWorldState;
    const ops = {
        state: () => s,
        cancelled: () => false,
        climb: async () => { calls.push('climb'); s.player!.level = 1; s.nearbyLocs = [
            { name: 'Gangplank', distance: 2, reachable: true, level: 1, optionsWithIndex: [{ text: 'Cross' }] },
        ] as BotWorldState['nearbyLocs']; return true; },
        cross: async () => { calls.push('cross'); s.player!.level = 0; s.player!.worldZ = 3147; s.nearbyLocs = []; return true; },
        wait: async (p: (s: BotWorldState) => boolean) => { calls.push('wait'); expect(p(s)).toBe(true); },
    };
    return { ops, calls, state: s };
}

test('Karamja is not Tutorial Island', () => {
    expect(onTutorialIsland({worldX:2953,worldZ:3142})).toBe(false);
    expect(onTutorialIsland({worldX:3094,worldZ:3107})).toBe(true);
});
test('below-deck ground plane climbs before crossing; fresh deck locations replace old hull locations', async () => {
    const f = fixture(); expect(inFerryHold(f.state)).toBe(true);
    expect(await leaveDockedFerry(f.ops)).toBeUndefined();
    expect(f.calls.filter(x => x !== 'wait')).toEqual(['climb','cross']);
    expect(f.state.player!.level).toBe(0); expect(inFerryHold(f.state)).toBe(false);
});
test('shore-side ground plane never boards the ship', async () => {
    const f = fixture(); f.state.nearbyLocs[1].reachable = true;
    expect(await leaveDockedFerry(f.ops)).toBeUndefined(); expect(f.calls).toEqual([]);
});
test('failed ladder does not attempt gangplank or claim recovery', async () => {
    const f = fixture(); f.ops.climb = async () => false;
    expect(await leaveDockedFerry(f.ops)).toContain('could not climb'); expect(f.calls).toEqual([]);
});
test('cancelled recovery performs no movement', async () => {
    const f = fixture(); f.ops.cancelled = () => true;
    expect(await leaveDockedFerry(f.ops)).toContain('cancelled'); expect(f.calls).toEqual([]);
});
test('a deck login crosses without climbing; an unrelated upstairs room is untouched', async () => {
    const f = fixture(); await f.ops.climb(); f.calls.length = 0;
    expect(await leaveDockedFerry(f.ops)).toBeUndefined(); expect(f.calls.filter(x => x !== 'wait')).toEqual(['cross']);
    f.state.player!.level = 1; f.state.player!.worldX = 3200;
    f.calls.length = 0; expect(await leaveDockedFerry(f.ops)).toBeUndefined(); expect(f.calls).toEqual([]);
});
