// Static world knowledge: places, banks and landmarks. Coordinates come from rs-sdk/learnings.

export interface Place {
    x: number;
    z: number;
    note: string;
}

export const PLACES = {
    lumbridge: { x: 3222, z: 3218, note: 'spawn point' },
    lumbridge_trees: { x: 3195, z: 3220, note: 'regular trees, safe' },
    draynor_fishing: { x: 3087, z: 3230, note: 'shrimp/anchovy net spots, next to dark wizards' },
    varrock_mine: { x: 3285, z: 3365, note: 'copper/tin/iron, far from spawn' },
    general_store: { x: 3212, z: 3247, note: 'Lumbridge general store: buys anything; sells tinderboxes' },
    bobs_axes: { x: 3230, z: 3203, note: "Bob's Brilliant Axes: bronze axes and pickaxes" },
    lumbridge_men: { x: 3222, z: 3218, note: 'men to pickpocket (about 3 coins each)' },
    lumbridge_range: { x: 3230, z: 3196, note: "free cooking range, just south of Bob's" },
    lumbridge_furnace: { x: 3225, z: 3256, note: 'furnace: copper + tin ore make bronze bars' },
    varrock_anvil: { x: 3188, z: 3421, note: 'anvils in the Varrock west smithy, next to the bank' },
    knife_spawn: { x: 3224, z: 3202, note: 'a knife respawns on the ground here (needed for fletching)' },
    cow_field: { x: 3253, z: 3290, note: 'cows, safe for beginners' },
    chicken_coop: { x: 3237, z: 3295, note: 'chickens, very safe' },
    goblins: { x: 3252, z: 3230, note: 'goblins and rats' },
    barbarian_village: { x: 3082, z: 3420, note: 'barbarians (combat 7) to fight, west of Varrock' },
    unicorns: { x: 3283, z: 3355, note: 'unicorns (combat 15), just south of the Varrock mine' },
    varrock_guards: { x: 3263, z: 3407, note: 'guards (combat 20-37), north-east Varrock near the east bank' }
} satisfies Record<string, Place>;


export const BANKS: ({ name: string } & Place)[] = [
    { name: 'Draynor bank', x: 3092, z: 3243, note: 'ground floor' },
    { name: 'Varrock east bank', x: 3253, z: 3420, note: 'east side of Varrock' },
    { name: 'Varrock west bank', x: 3185, z: 3436, note: 'west side of Varrock, next to the anvils' },
    { name: 'Falador east bank', x: 3013, z: 3355, note: 'east side of Falador' },
    { name: 'Falador west bank', x: 2946, z: 3368, note: 'west side of Falador' },
    { name: 'Edgeville bank', x: 3094, z: 3492, note: 'Edgeville, just south of the wilderness' },
    { name: 'Al Kharid bank', x: 3269, z: 3167, note: 'inside Al Kharid, through the 10-coin toll gate' }
];

/** Places with monsters that attack low-level characters on sight. */
export const DANGERS: ({ name: string } & Place)[] = [
    { name: 'Draynor dark wizards', x: 3087, z: 3240, note: 'around Draynor village and its fishing spot' },
    { name: 'Varrock dark wizards', x: 3225, z: 3370, note: 'a stone circle just south of Varrock' }
];

/** Draynor's dark wizards kill characters below about this combat level. */
export const DRAYNOR_MIN_COMBAT = 15;

/** Named spots for location labels; `short` is the label drawn on the dashboard map. */
export const LANDMARKS: { name: string; short: string; x: number; z: number }[] = [
    { name: 'Tutorial Island', short: 'Tutorial Island', x: 3094, z: 3106 },
    { name: 'Lumbridge', short: 'Lumbridge', x: 3222, z: 3218 },
    { name: 'Lumbridge trees', short: 'Trees', x: 3195, z: 3220 },
    { name: 'Lumbridge cow field', short: 'Cows', x: 3253, z: 3290 },
    { name: 'Lumbridge chickens', short: 'Chickens', x: 3237, z: 3295 },
    { name: 'Lumbridge goblins', short: 'Goblins', x: 3252, z: 3230 },
    { name: 'Lumbridge general store', short: 'General store', x: 3212, z: 3247 },
    { name: "Bob's axe shop", short: "Bob's axes", x: 3230, z: 3203 },
    { name: 'Lumbridge furnace', short: 'Furnace', x: 3225, z: 3256 },
    { name: 'Varrock smithy', short: 'Anvils', x: 3188, z: 3421 },
    { name: 'Draynor Village', short: 'Draynor bank', x: 3092, z: 3243 },
    { name: 'Draynor fishing spot', short: 'Draynor fishing', x: 3087, z: 3230 },
    { name: 'Al Kharid', short: 'Al Kharid', x: 3290, z: 3180 },
    { name: 'Varrock mine', short: 'Varrock mine', x: 3285, z: 3365 },
    { name: 'Varrock west bank', short: 'Varrock W bank', x: 3185, z: 3436 },
    { name: 'Varrock east bank', short: 'Varrock E bank', x: 3253, z: 3420 },
    { name: 'Varrock dark wizards', short: 'Dark wizards', x: 3225, z: 3370 },
    { name: 'Varrock', short: 'Varrock', x: 3210, z: 3430 },
    { name: 'Varrock Swordshop', short: 'Swords', x: 3205, z: 3399 },
    { name: "Horvik's Armour Shop", short: 'Armour', x: 3229, z: 3437 },
    { name: "Lowe's Archery Emporium", short: 'Bows', x: 3232, z: 3423 },
    { name: 'Varrock guards', short: 'Guards', x: 3263, z: 3407 },
    { name: 'Unicorns', short: 'Unicorns', x: 3283, z: 3355 },
    { name: 'Barbarian Village', short: 'Barbarians', x: 3082, z: 3420 },
    { name: 'Falador', short: 'Falador', x: 2951, z: 3380 }
];

export function nearestLandmark(x: number, z: number): string {
    return LANDMARKS.reduce((a, b) => (Math.hypot(a.x - x, a.z - z) <= Math.hypot(b.x - x, b.z - z) ? a : b)).name;
}

export function locationLabel(x: number, z: number): string {
    let best = { name: '', d: Infinity };
    for (const l of LANDMARKS) {
        const d = Math.hypot(l.x - x, l.z - z);
        if (d < best.d) best = { name: l.name, d };
    }
    return best.d <= 45 ? best.name : `the road near ${best.name}`;
}
