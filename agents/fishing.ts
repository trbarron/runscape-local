// Shared executable fishing methods: mission eligibility and the executor use the same catalogue.
/** Fishing methods: which spot type offers them, the option to click, and the tools needed. */
export const FISHING: Record<string, { spot: string; option: RegExp; tools: [string, RegExp][]; level: number; catches: string; via?: 'Karamja' }> = {
    net: {
        spot: 'net/bait',
        option: /^net$/i,
        tools: [['small fishing net', /small fishing net/i]],
        level: 1,
        catches: 'shrimp, anchovies',
    },
    shrimps: { spot: 'net/bait', option: /^net$/i, tools: [['small fishing net', /small fishing net/i]], level: 1, catches: 'shrimps' },
    anchovies: { spot: 'net/bait', option: /^net$/i, tools: [['small fishing net', /small fishing net/i]], level: 15, catches: 'anchovies' },
    bait: {
        spot: 'net/bait',
        option: /^bait$/i,
        tools: [
            ['fishing rod', /^fishing rod$/i],
            ['fishing bait', /fishing bait/i],
        ],
        level: 5,
        catches: 'sardine, herring',
    },
    sardine: { spot: 'net/bait', option: /^bait$/i, tools: [['fishing rod', /^fishing rod$/i], ['fishing bait', /fishing bait/i]], level: 5, catches: 'sardine' },
    herring: { spot: 'net/bait', option: /^bait$/i, tools: [['fishing rod', /^fishing rod$/i], ['fishing bait', /fishing bait/i]], level: 10, catches: 'herring' },
    lure: {
        spot: 'lure/bait',
        option: /^lure$/i,
        tools: [
            ['fly fishing rod', /fly fishing rod/i],
            ['feathers', /^feathers?$/i],
        ],
        level: 20,
        catches: 'trout, salmon',
    },
    trout: { spot: 'lure/bait', option: /^lure$/i, tools: [['fly fishing rod', /fly fishing rod/i], ['feathers', /^feathers?$/i]], level: 20, catches: 'trout' },
    salmon: { spot: 'lure/bait', option: /^lure$/i, tools: [['fly fishing rod', /fly fishing rod/i], ['feathers', /^feathers?$/i]], level: 30, catches: 'salmon' },
    'river bait': {
        spot: 'lure/bait',
        option: /^bait$/i,
        tools: [
            ['fishing rod', /^fishing rod$/i],
            ['fishing bait', /fishing bait/i],
        ],
        level: 25,
        catches: 'pike',
    },
    pike: { spot: 'lure/bait', option: /^bait$/i, tools: [['fishing rod', /^fishing rod$/i], ['fishing bait', /fishing bait/i]], level: 25, catches: 'pike' },
    harpoon: { spot: 'cage/harpoon', option: /^harpoon$/i, tools: [['harpoon', /harpoon/i]], level: 35, catches: 'tuna', via: 'Karamja' },
    tuna: { spot: 'cage/harpoon', option: /^harpoon$/i, tools: [['harpoon', /harpoon/i]], level: 35, catches: 'tuna', via: 'Karamja' },
    swordfish: { spot: 'cage/harpoon', option: /^harpoon$/i, tools: [['harpoon', /harpoon/i]], level: 50, catches: 'swordfish', via: 'Karamja' },
    cage: { spot: 'cage/harpoon', option: /^cage$/i, tools: [['lobster pot', /lobster pot/i]], level: 40, catches: 'lobster', via: 'Karamja' },
    lobster: { spot: 'cage/harpoon', option: /^cage$/i, tools: [['lobster pot', /lobster pot/i]], level: 40, catches: 'lobster', via: 'Karamja' },
};
export const fishMethod = (target: string | null) => {
    const t = (target ?? 'net').trim().toLowerCase();
    return FISHING[t] ? t : (Object.keys(FISHING).find((k) => t.includes(k) || FISHING[k].catches.includes(t.replace(/s$/, ''))) ?? 'net');
};
