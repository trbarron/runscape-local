// Shared smelting inputs used by execution, readiness and mission production chains.
export const ORE_PAIRS: Record<string, [RegExp, RegExp | null, number]> = {
    bronze: [/^copper ore$/i, /^tin ore$/i, 1],
    iron: [/^iron ore$/i, null, 15],
    silver: [/^silver ore$/i, null, 20],
    steel: [/^coal$/i, /^iron ore$/i, 30],
    gold: [/^gold ore$/i, null, 40],
    mithril: [/^mithril ore$/i, /^coal$/i, 50],
    adamant: [/^adamantite ore$/i, /^coal$/i, 70],
    rune: [/^runite ore$/i, /^coal$/i, 85],
};
const COAL_PER: Record<string, number> = { mithril: 4, adamant: 6, rune: 8 };
export const partnerNeed = (metal: string) => COAL_PER[metal] ?? 1;
