// Character sheets for the party, in D&D 5e terms. There are no assigned roles and no
// listed "favourite activity": each character has race, class, background and ability
// scores (standard array plus racial bonus), and the soft pull towards an activity is
// derived from those abilities. The party negotiates who does what from there.

export type Ability = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';
export type Activity = 'mining' | 'combat' | 'woodcutting' | 'fishing' | 'thieving' | 'crafting' | 'errands';

export interface Character {
    username: string;
    race: string;
    class: string;
    background: string;
    level: number;
    abilities: Record<Ability, number>;
    alignment: string;
    trait: string;
    ideal: string;
    bond: string;
    flaw: string;
    /** What they want, most important first. Soft: it colours choices, it does not dictate them. */
    drives: string[];
    /** How they tend to behave when the party is deciding something. */
    style: string;
}

// Standard array 15,14,13,12,10,8 assigned by the class, then racial bonuses.
export const CHARACTERS: Character[] = [
    {
        username: 'bram',
        race: '',
        class: 'Fighter',
        background: 'Soldier (a former mine guard)',
        level: 1,
        // array: STR 15, CON 14, WIS 13, INT 12, DEX 10, CHA 8; dwarf +2 CON
        abilities: { STR: 15, DEX: 10, CON: 16, INT: 12, WIS: 13, CHA: 8 },
        alignment: 'lawful neutral',
        trait: 'Gruff and economical with words; trusts what can be measured.',
        ideal: 'A job done properly is its own reward.',
        bond: 'Owes trish a life debt from a collapsed tunnel and never says so.',
        flaw: 'Hates being told what to do, and hoards things nobody needs.',
        drives: ['mastery of a craft', 'self-reliance', 'wealth'],
        style: 'Slow to agree and hard to move once decided; argues from what can be measured.'
    },
    {
        username: 'wren',
        race: '',
        class: 'Rogue',
        background: 'Charlatan (a roadside fixer)',
        level: 1,
        // array: DEX 15, CHA 14, WIS 13, INT 12, CON 10, STR 8; halfling +2 DEX
        abilities: { STR: 8, DEX: 17, CON: 10, INT: 12, WIS: 13, CHA: 14 },
        alignment: 'chaotic good',
        trait: 'Quick-tongued, curious, and always has a plan that is half-finished.',
        ideal: 'Everyone eats if anyone eats.',
        bond: 'Wants mike to take the plans seriously, and keeps trying to earn it.',
        flaw: 'Easily distracted, and promises more than is remembered.',
        drives: ['freedom and fun', 'looking after the group', 'new places'],
        style: 'Quick to suggest and quick to change course; bored by plans with nothing new in them.'
    },
    {
        username: 'mike',
        race: '',
        class: 'Wizard',
        background: 'Sage (a one-time guild alchemist)',
        level: 1,
        // array: INT 15, WIS 14, CON 13, DEX 12, CHA 10, STR 8; gnome +2 INT
        abilities: { STR: 8, DEX: 12, CON: 13, INT: 17, WIS: 14, CHA: 10 },
        alignment: 'lawful good',
        trait: 'Precise and dry-witted; happiest turning raw materials into something better, and tries every recipe once.',
        ideal: 'Anything worth doing is worth learning to do properly.',
        bond: 'Would rather teach a recipe than guard it: wants the whole party able to feed and arm itself, whoever stands at the furnace.',
        flaw: 'Over-plans, and gets short with the party when things slip.',
        drives: ['knowledge', 'making things', 'order and safety'],
        style: 'Wants a plan before agreeing and dislikes gambles, but judges plans by what they make and learn, not by talk.'
    },
    {
        username: 'trish',
        race: '',
        class: 'Paladin',
        background: 'Folk Hero (stood up to a bandit lord once)',
        level: 1,
        // array: STR 15, CHA 14, CON 13, WIS 12, DEX 10, INT 8; human +1 to all
        abilities: { STR: 16, DEX: 11, CON: 14, INT: 9, WIS: 13, CHA: 15 },
        alignment: 'neutral good',
        trait: 'Cheerful, battered and loud; treats every obstacle as a personal challenge.',
        ideal: 'Stand in front so the others do not have to.',
        bond: 'Would walk into a dragon for wren, and has said so more than once.',
        flaw: 'Reckless, forgets to eat, and gets bored without something to hit.',
        drives: ['glory', 'protecting the others', 'adventure'],
        style: 'Speaks up first and loud; happy to take risks that mean standing in front of danger.'
    }
];

export const modifier = (score: number) => Math.floor((score - 10) / 2);
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

// How strongly each ability pulls a character towards an activity (weights sum to 1).
// Errands (banking, selling, buying) are how you get things done, not something to be
// drawn to, so they have no pull.
const PULL: Record<Exclude<Activity, 'errands'>, Partial<Record<Ability, number>>> = {
    mining: { CON: 0.7, WIS: 0.3 }, // endurance and patience
    combat: { STR: 0.6, CHA: 0.4 }, // force and presence
    woodcutting: { STR: 0.4, CON: 0.3, DEX: 0.3 },
    fishing: { WIS: 0.5, DEX: 0.5 }, // patience and a steady hand
    thieving: { DEX: 0.7, CHA: 0.3 }, // quick hands and a straight face
    crafting: { INT: 0.5, WIS: 0.25, DEX: 0.25 } // cooking, smelting, smithing, fletching, firemaking
};

/** Activities ranked by how naturally the abilities pull towards them. */
export function leanings(c: Character): { activity: Activity; pull: number }[] {
    return (Object.keys(PULL) as (keyof typeof PULL)[])
        .map(activity => ({
            activity,
            pull: Object.entries(PULL[activity]).reduce((s, [a, w]) => s + modifier(c.abilities[a as Ability]) * (w as number), 0)
        }))
        .sort((a, b) => b.pull - a.pull);
}

const LABEL: Record<Activity, string> = {
    mining: 'mining',
    combat: 'fighting',
    woodcutting: 'woodcutting',
    fishing: 'fishing',
    thieving: 'thieving',
    crafting: 'crafting and cooking',
    errands: 'banking, selling and planning'
};
export const leaningLabel = (a: Activity) => LABEL[a];

/** Soft, in-fiction phrasing of the ranking. Never a rule. */
export function renderLeanings(c: Character): string {
    const ranked = leanings(c);
    const top = ranked.slice(0, 2).map(r => LABEL[r.activity]);
    const bottom = ranked.slice(-1).map(r => LABEL[r.activity]);
    return `Your abilities make you naturally drawn to ${top.join(' and ')}, and least drawn to ${bottom.join('')}. These are leanings, not rules: you can do anything, it just comes easier or harder.`;
}

/** Character sheet for the planner prompt. */
export function renderSheet(c: Character): string {
    const abilities = (Object.entries(c.abilities) as [Ability, number][]).map(([k, v]) => `${k} ${v} (${signed(modifier(v))})`).join(', ');
    return [
        `${c.username}: ${[c.race, c.class].filter(Boolean).join(" ")}, level ${c.level}. Background: ${c.background}.`,
        `Abilities: ${abilities}`,
        `Alignment: ${c.alignment}`,
        `Personality: ${c.trait}`,
        `Ideal: ${c.ideal}`,
        `Bond: ${c.bond}`,
        `Flaw: ${c.flaw}`,
        `Drives (most important first): ${c.drives.join(', ')}`,
        `In group decisions: ${c.style}`,
        renderLeanings(c)
    ].join('\n');
}
