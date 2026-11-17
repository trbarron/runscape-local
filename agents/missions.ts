import {huntOffer,huntReading,type HuntCheck} from './hunt';
import {REGIONS,inRegion,fieldReading,FIELD_ACTIONS,type Region,type ExpeditionCheck} from './expedition';
// Missions built from game facts. The party used to invent its own missions and milestones, but it
// only sees the world through a prompt, so proposals were often unreachable or quietly depended on
// things it could not see. Here the game side builds a short menu of missions that are reachable
// from the party's real levels, gear and map, and every milestone carries a check the game
// evaluates from live state, never by vote. The characters choose among them and split the work.
import type { BotWorldState } from '../rs-sdk/sdk/types';
import { SPOTS, type Spot } from './world-index/index';
import { productionChain, FISH_RECIPES, skillOf, owned, sites, safeSite, type MissionWork } from './mission-chain';
import { cookingLevel, smithRecipe, SMITHING_METALS } from './game-requirements';
import { hasAchievement } from './achievements';
import { bankOf } from './banks';
import { shopSelling } from './shops';

export type Check = HuntCheck | ExpeditionCheck
    | { kind: 'skill'; skill: string; level: number; who: 'all' | 'any'; member?: string }
    | { kind: 'stock'; item: string; count: number }
    | { kind: 'wear'; match: string; pieces: number }
    | { kind: 'kill'; monster: string }
    | { kind: 'combat'; level: number }
    | { kind: 'coins'; total: number };

export interface MenuMilestone {
    what: string;
    needs: string;
    check: Check;
    owner?: string;
    next?: MissionWork;
    fallback?: string;
}

export interface MenuMission {
    id: number;
    by: string;
    key: string;
    template: string;
    category: string;
    work: MissionWork[];
    title: string;
    mission: string;
    why: string;
    milestones: MenuMilestone[];
}

/** One character as the checks see them. Item names are lower case. */
export interface Member {
    name: string;
    skills: Record<string, number>;
    combat: number;
    worn: string[];
    carried: Record<string, number>;
    bank: Record<string, number>;
}

export interface Ctx {
    /** User standing policy: party projects, with solo training left to personal routines. */
    sharedProjects?:boolean;
    members: Member[];
    /** How many characters the party has; a check is unknown until all of them have reported. */
    size: number;
    spots?: readonly Spot[];
    has: (achievement: string) => boolean;
}

const lower = (items: { name: string; count: number }[]) => {
    const out: Record<string, number> = {};
    for (const i of items) out[i.name.toLowerCase()] = (out[i.name.toLowerCase()] ?? 0) + i.count;
    return out;
};

export function memberFrom(name: string, s: BotWorldState, bank: Record<string, number> = {}): Member {
    return {
        name,
        skills: Object.fromEntries(s.skills.filter((k) => !/^stat\d+$/i.test(k.name)).map((k) => [k.name, k.baseLevel])),
        combat: s.player?.combatLevel ?? 0,
        worn: s.equipment.map((i) => i.name.toLowerCase()),
        carried: lower(s.inventory),
        bank: lower(Object.entries(bank).map(([name, count]) => ({ name, count }))),
    };
}

export interface Reading {
    met: boolean;
    /** False until every character's state is in, so nothing is ticked on partial information. */
    known: boolean;
    progress: string;
}

const have = (m: Member, item: string) => (m.carried[item] ?? 0) + (m.bank[item] ?? 0);

export function evaluate(check: Check, ctx: Ctx): Reading {
    const known = ctx.members.length >= ctx.size;
    const ms = ctx.members;
    const reading = (met: boolean, progress: string): Reading => ({ met: known && met, known, progress });
    switch (check.kind) {
        case 'expedition': return fieldReading(check);
        case 'hunt': return huntReading(check);
        case 'skill': {
            const assessed = check.member ? ms.filter((m) => m.name === check.member) : ms;
            const levels = assessed.map((m) => skillOf(m, check.skill));
            const ok =
                check.who === 'all' ? levels.length > 0 && levels.every((l) => l >= check.level) : levels.some((l) => l >= check.level);
            return reading(
                ok,
                `${check.skill} ${ms.map((m) => `${m.name} ${skillOf(m, check.skill)}`).join(', ')} (${check.who === 'all' ? 'all need' : 'one needs'} ${check.level})`,
            );
        }
        case 'stock': {
            const total = ms.reduce((n, m) => n + have(m, check.item.toLowerCase()), 0);
            return reading(total >= check.count, `${total} of ${check.count} ${check.item} held or banked across the party`);
        }
        case 'wear': {
            const re = new RegExp(check.match, 'i');
            const counts = ms.map((m) => ({ name: m.name, n: m.worn.filter((w) => re.test(w)).length }));
            const lacking = counts.filter((c) => c.n < check.pieces).map((c) => `${c.name} wears ${c.n}`);
            return reading(
                counts.length > 0 && !lacking.length,
                lacking.length ? `each needs ${check.pieces} pieces: ${lacking.join(', ')}` : 'everyone wears the set',
            );
        }
        case 'kill':
            return {
                met: ctx.has(`kill:${check.monster}`),
                known: true,
                progress: `${check.monster} ${ctx.has(`kill:${check.monster}`) ? 'defeated' : 'not yet defeated'}`,
            };
        case 'combat': {
            const low = ms.length ? Math.min(...ms.map((m) => m.combat)) : 0;
            return reading(
                ms.length > 0 && low >= check.level,
                `lowest combat level ${low} of ${check.level} needed (${ms.map((m) => `${m.name} ${m.combat}`).join(', ')})`,
            );
        }
        case 'coins': {
            const total = ms.reduce((n, m) => n + have(m, 'coins'), 0);
            return reading(total >= check.total, `${total} of ${check.total} coins carried or banked across the party`);
        }
    }
}

// ---- parameterized opportunity library ----------------------------------------------------------
export type Offer = MenuMission | string;
const MARKS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 99];
const SKILL_ACTION: Record<string, string> = {
    Mining: 'mine', Woodcutting: 'chop_trees', Smithing: 'smith', Fishing: 'fish', Cooking: 'cook',
    Firemaking: 'firemake', Fletching: 'fletch', Crafting: 'craft'
};
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const bestMember = (ctx: Ctx, skill: string) =>
    [...ctx.members].sort((a, b) => skillOf(b, skill) - skillOf(a, skill) || a.name.localeCompare(b.name))[0];
const total = (ctx: Ctx, item: string) => ctx.members.reduce((n, m) => n + owned(m, item), 0);
const fallback = 'Do feasible independent supply/training work while a dependency is unavailable; do not wait indefinitely.';
const needs = (work: MissionWork[]) =>
    [...new Set(work.map((w) => `${w.owner}: ${w.action} (${w.target})${w.to ? ` to ${w.to}` : ''}`))].join(' → ');
const make = (
    template: string,
    category: string,
    title: string,
    mission: string,
    why: string,
    milestones: MenuMilestone[],
    work: MissionWork[],
): MenuMission => ({
    id: 0,
    by: 'game',
    template,
    category,
    title,
    mission,
    why,
    milestones,
    work,
    key: `${template}:${JSON.stringify(milestones.map((m) => m.check))}`,
});
function supply(ctx: Ctx, template: string, item: string, count: number, category = 'supplies', title = `The ${cap(item)} Reserve`): Offer {
    const chain = productionChain(ctx, item, count);
    if (chain.blocker) return chain.blocker;
    // A stock mission is only worth choosing when most of it still has to be made.
    if (total(ctx, item) * 2 >= count) return `the party already holds ${total(ctx, item)} of ${count} ${item}; too little work to be a mission`;
    return make(
        template,
        category,
        title,
        `Keep ${count} ${item} ready for the party's supported work.`,
        `A real source, qualified workers, tools, supplies and banking are available; existing stock counts.`,
        [
            {
                what: `The party holds or banks ${count} ${item}`,
                needs: needs(chain.work),
                check: { kind: 'stock', item, count },
                owner: chain.owner,
                next: chain.work[0],
                fallback,
            },
        ],
        chain.work,
    );
}
/** A bar reserve is a stretch only at the best metal a smith can work; otherwise name the harder bar. */
function harderBar(ctx: Ctx, bar: string): string | null {
    const level = SMITHING_METALS.find((m) => m.bar === bar)?.level ?? 0;
    const best = Math.max(0, ...ctx.members.map((m) => skillOf(m, 'Smithing')));
    const harder = SMITHING_METALS.find((m) => m.level > level && m.level <= best);
    return harder ? `${bar} is too easy: ${harder.bar} is within reach at Smithing ${harder.level}` : null;
}
function table(ctx: Ctx): Offer {
    for (const fish of [...FISH_RECIPES].reverse()) {
        const chain = productionChain(ctx, fish.fish, 60);
        if (chain.blocker || total(ctx, fish.fish) >= 60) continue;
        const cookTask = chain.work.find((w) => w.action === 'cook');
        const cook = ctx.members.find((m) => m.name === cookTask?.owner);
        const milestones: MenuMilestone[] = [
            {
                what: `The party holds or banks 60 cooked ${fish.fish}`,
                needs: needs(chain.work),
                check: { kind: 'stock', item: fish.fish, count: 60 },
                owner: chain.owner,
                next: chain.work[0],
                fallback,
            },
        ];
        if (cook && skillOf(cook, 'Cooking') < 99) {
            const level = Math.min(99, skillOf(cook, 'Cooking') + 5);
            milestones.push({
                what: `${cook.name} reaches Cooking ${level}`,
                needs: needs(chain.work),
                check: { kind: 'skill', skill: 'Cooking', level, who: 'any', member: cook.name },
                owner: cook.name,
                next: cookTask,
                fallback,
            });
        }
        return make(
            'cooks-table',
            'food',
            "The Cooks' Table",
            `Keep the party fed: catch and cook ${fish.fish}, bank the food and improve the actual cook's skill.`,
            `The ${fish.method} method has an indexed non-wilderness spot; the assigned cook meets Cooking ${cookingLevel(`raw ${fish.fish}`)}.`,
            milestones,
            chain.work,
        );
    }
    return 'no unstocked fish with a complete supported catching/cooking chain';
}
const TIERS = [
    { metal: 'bronze', defence: 1 },
    { metal: 'iron', defence: 1 },
    { metal: 'steel', defence: 5 },
    { metal: 'mithril', defence: 20 },
];
const METALS = ['bronze', 'iron', 'steel', 'black', 'mithril', 'adamant', 'rune'];
const CORE = ['(?:med|full) helm', '(?:chainbody|platebody)', '(?:platelegs|plateskirt)'];
function forge(ctx: Ctx): Offer {
    for (const tier of TIERS) {
        const rank = METALS.indexOf(tier.metal);
        const acceptable = METALS.slice(rank).join('|');
        const complete = ctx.members.every((m) =>
            CORE.every((piece) => m.worn.some((w) => new RegExp(`^(?:${acceptable}) ${piece}$`, 'i').test(w))),
        );
        if (complete) continue;
        // A mission must improve the weakest outfit; higher/mixed tiers already satisfy it.
        if (ctx.members.some((m) => skillOf(m, 'Defence') < tier.defence))
            return `not everyone can wear ${tier.metal}; train Defence first`;
        const work: MissionWork[] = [];
        for (const member of ctx.members)
            for (const [index, piece] of ['med helm', 'chainbody', 'platelegs'].entries()) {
                if (member.worn.some((w) => new RegExp(`^(?:${acceptable}) ${CORE[index]}$`, 'i').test(w))) continue;
                const chain = productionChain(ctx, `${tier.metal} ${piece}`, 1, member.name);
                if (chain.blocker) return chain.blocker;
                work.push(...chain.work, {
                    owner: member.name,
                    action: 'equip',
                    target: `${tier.metal} ${piece}`,
                    note: 'Fill an empty or weaker slot; keep superior gear and individual extras',
                });
            }
        return make(
            'forge',
            'equipment',
            `The ${cap(tier.metal)} Forge`,
            `Bring every core armour slot up to at least ${tier.metal}, retaining stronger pieces and individual looks.`,
            'Full ore/bar/recipe/tool/station chains are available; mixed higher-tier outfits count.',
            CORE.map((piece, index) => ({
                what: `Everyone wears ${tier.metal}-or-better ${['head', 'body', 'leg'][index]} armour`,
                needs: needs(work),
                check: { kind: 'wear' as const, match: `^(?:${acceptable}) ${piece}$`, pieces: 1 },
                owner: work.find((w) => w.action === 'smith')?.owner ?? work[0]?.owner,
                next: work[0],
                fallback,
            })),
            work,
        );
    }
    return 'all core slots already meet the highest supported upgrade tier';
}
function treasury(ctx: Ctx): Offer {
    const target = Math.ceil((total(ctx, 'coins') + Math.max(5000, Math.min(20000, total(ctx, 'coins') / 4))) / 1000) * 1000;
    // Pickpocketing men is a supported, tool-free Thieving-1 income source; never require money to bootstrap money.
    const owner = bestMember(ctx, 'Thieving');
    if (!owner || !safeSite(ctx, 'bank') || !safeSite(ctx, 'monster', 'man'))
        return 'no supported safe man/bank route for tool-free income';
    const work: MissionWork[] = [
        {
            owner: owner.name,
            action: 'pickpocket',
            target: 'man',
            note: 'Earn coins; bank them. Other members can sell surplus through supported shops.',
        },
    ];
    return make(
        'treasury',
        'trade',
        'The Treasury',
        'Build a practical war chest for tools, food and equipment.',
        `Raise the current ${total(ctx, 'coins')} coins by a bounded amount, rather than doubling indefinitely.`,
        [
            {
                what: `The party holds ${target} coins carried or banked`,
                needs: needs(work),
                check: { kind: 'coins', total: target },
                owner: owner.name,
                next: work[0],
                fallback,
            },
        ],
        work,
    );
}
function skillWork(ctx: Ctx, skill: string, member?: string): { owner: Member; work: MissionWork[] } | string {
    const owner = member ? ctx.members.find((m) => m.name === member) : bestMember(ctx, skill);
    if (!owner) return 'no connected worker';
    const action = SKILL_ACTION[skill];
    const items =
        skill === 'Mining'
            ? ['adamantite ore', 'mithril ore', 'gold ore', 'coal', 'iron ore', 'copper ore']
            : skill === 'Woodcutting'
              ? ['yew logs', 'willow logs', 'oak logs', 'logs']
              : skill === 'Firemaking' || skill === 'Fletching'
                ? ['logs']
              : skill === 'Crafting'
                ? [skillOf(owner, 'Crafting') >= 8 ? 'gold amulet' : skillOf(owner, 'Crafting') >= 6 ? 'gold necklace' : 'gold ring']
              : skill === 'Smithing'
                ? ['rune dagger', 'adamant dagger', 'mithril dagger', 'steel med helm', 'iron med helm', 'bronze dagger'].filter(item => (smithRecipe(item)?.level ?? Infinity) <= skillOf(owner, 'Smithing'))
                : skill === 'Fishing'
                  ? [...FISH_RECIPES].reverse().map((f) => `raw ${f.fish}`)
                  : skill === 'Cooking'
                    ? [...FISH_RECIPES].reverse().map((f) => f.fish)
                    : [];
    for (const item of items) {
        // Stocked outputs do not prove there is a way to train. Require new production for this mark.
        const trainingCtx: Ctx = {
            ...ctx,
            members: ctx.members.map((m) => ({ ...m, carried: { ...m.carried, [item]: 0 }, bank: { ...m.bank, [item]: 0 } })),
        };
        const batch = skill === 'Smithing' || skill === 'Crafting' ? 12 : skill === 'Firemaking' || skill === 'Fletching' ? 20 : 60;
        const chain = productionChain(trainingCtx, item, batch, owner.name);
        if (!chain.blocker && skill === 'Firemaking' && ![...owner.worn, ...Object.keys(owner.carried), ...Object.keys(owner.bank)].some((n) => /^tinderbox$/i.test(n))) {
            const sale = shopSelling('tinderbox');
            if (!sale) continue;
            const earlierCost = chain.work.filter((w) => w.owner === owner.name && w.action === 'buy').reduce((sum, w) => sum + (shopSelling(w.target)?.item.price ?? 0) * (w.amount ?? 1), 0);
            if (owned(owner, 'coins') < earlierCost + sale.item.price) continue;
        }
        if (!chain.blocker && (chain.work.some((w) => w.owner === owner.name && w.action === action) || skill === 'Firemaking' || skill === 'Fletching')) {
            const work = chain.work.filter((w) => !(w.action === 'bank_resources' && /^logs$/i.test(w.target)));
            if (skill === 'Firemaking' && ![...owner.worn, ...Object.keys(owner.carried), ...Object.keys(owner.bank)].some((n) => /^tinderbox$/i.test(n)))
                work.push({ owner: owner.name, action: 'buy', target: 'tinderbox', amount: 1, note: 'Buy the tinderbox needed to burn the gathered logs' });
            if (skill === 'Firemaking') work.push({ owner: owner.name, action, target: 'logs', amount: 20, note: 'Burn logs for Firemaking XP; gather more when this batch runs out' });
            if (skill === 'Fletching') work.push({ owner: owner.name, action, target: skillOf(owner, 'Fletching') < 5 ? 'arrow shaft' : 'shortbow', amount: 20, note: 'Fletch level-eligible products from the gathered logs; the executor obtains a knife' });
            return { owner, work };
        }
    }
    return `no complete training chain for ${skill}`;
}
function mark(ctx: Ctx, skill: string): Offer {
    const plan = skillWork(ctx, skill);
    if (typeof plan === 'string') return plan;
    const next = MARKS.find((n) => n > skillOf(plan.owner, skill));
    if (!next || next - skillOf(plan.owner, skill) > 12) return `no reachable ${skill} mark below or at 99`;
    const action = SKILL_ACTION[skill];
    const task = plan.work.find((w) => w.owner === plan.owner.name && w.action === action)!;
    return make(
        `mark-${skill.toLowerCase()}`,
        'skills',
        `${skill} Workshop`,
        `Help ${plan.owner.name} reach ${skill} ${next}, with supplies handled by a complete production chain.`,
        `${plan.owner.name} is ${skillOf(plan.owner, skill)}; no unsupported method or level above 99 is required.`,
        [
            {
                what: `${plan.owner.name} reaches ${skill} ${next}`,
                needs: needs(plan.work),
                check: { kind: 'skill', skill, level: next, who: 'any', member: plan.owner.name },
                owner: plan.owner.name,
                next: task,
                fallback,
            },
        ],
        plan.work,
    );
}
function craftsmen(ctx: Ctx): Offer {
    const options = ['Mining', 'Smithing', 'Woodcutting', 'Firemaking', 'Fletching', 'Crafting']
        .map((s) => mark(ctx, s))
        .filter((m): m is MenuMission => typeof m !== 'string')
        .slice(0, 2);
    if (options.length < 2) return 'fewer than two trades have supported next marks';
    return make(
        'two-trades',
        'skills',
        'Masters of Two Trades',
        'Build two practical trades through supported supply chains.',
        options.map((m) => m.why).join(' '),
        options.flatMap((m) => m.milestones),
        options.flatMap((m) => m.work),
    );
}
function slayers(ctx: Ctx): Offer {
    const fighter = [...ctx.members].sort((a, b) => b.combat - a.combat)[0];
    if (!fighter) return 'no connected fighter';
    const ordinary = new Set([
        'chicken',
        'cow',
        'goblin',
        'rat',
        'giant rat',
        'spider',
        'giant spider',
        'scorpion',
        'man',
        'woman',
        'guard',
        'barbarian',
        'skeleton',
        'zombie',
        'hill giant',
        'moss giant',
        'lesser demon',
        'dark wizard',
        'unicorn',
        'imp',
        'dwarf',
        'hobgoblin',
        'jail guard',
    ]);
    const foes = [
        ...new Map(
            sites(ctx)
                .filter(
                    (s) =>
                        s.kind === 'monster' &&
                        ordinary.has(s.type.toLowerCase()) &&
                        s.count >= 2 &&
                        !s.tollGate &&
                        s.level != null &&
                        s.level <= fighter.combat &&
                        !ctx.has(`kill:${s.type}`),
                )
                .map((s) => [s.type, s]),
        ).values(),
    ]
        .sort((a, b) => (b.level ?? 0) - (a.level ?? 0))
        .slice(0, 2);
    if (foes.length < 2) return 'fewer than two supported unbeaten monster types within fighting reach';
    const food = productionChain(ctx, 'trout', 20, fighter.name);
    if (food.blocker) return `fighter food: ${food.blocker}`;
    const work = [
        ...food.work,
        {
            owner: fighter.name,
            action: 'withdraw_from_bank',
            target: 'cooked trout',
            amount: 20,
            note: 'Carry the supplied food before fighting; do not leave it banked',
        },
        ...foes.map((s) => ({
            owner: fighter.name,
            action: 'fight',
            target: s.type,
            note: `Consider the indexed ${s.type} near ${s.near} (${s.x}, ${s.z}${s.z >= 3520 ? '; wilderness: bank valuables, carry food and plan return' : ''}); choose a short supplied attempt and retreat under your own safety rules`,
        })),
    ];
    return make(
        'hunters',
        'combat',
        'The Monster Hunters',
        'Defeat new monster types with a supplied fighter, rather than sending weak members into danger.',
        'Known reachable targets and a food chain are available.',
        foes.map((s) => ({
            what: `Defeat the party’s first ${s.type}`,
            needs: needs(work),
            check: { kind: 'kill' as const, monster: s.type },
            owner: fighter.name,
            next: work[0],
            fallback,
        })),
        work,
    );
}
/** Own preparation feasibility for field methods in this region; no remote supplier dependency. */
export function expeditionMethods(ctx:Ctx,region:Region,member:Member):MissionWork[] {
    const local=sites(ctx).filter(s=>!s.tollGate&&!s.via&&s.z<3520&&inRegion({...s,plane:0},region));
    const opts:MissionWork[]=[];
    const attempt=(item:string,action:string,target:string)=>{
        const worker={...member,carried:{...member.carried,[item]:0},bank:{...member.bank,[item]:0}};
        const c=productionChain({...ctx,members:[worker],size:1,spots:local},item,4,member.name);
        if(!c.blocker&&c.work.some(w=>w.action===action))opts.push({owner:member.name,action,target,note:`Optional ${action} test in ${region.name}; prepare own tools/supplies, verify actual location and record result`});
    };
    if(local.some(s=>s.kind==='tree'))for(const item of ['yew logs','willow logs','oak logs','logs']){attempt(item,'chop_trees',item==='logs'?'tree':item.replace(' logs',''));if(opts.some(w=>w.action==='chop_trees'))break;}
    if(local.some(s=>s.kind==='rock'))for(const ore of ['iron ore','copper ore','tin ore']){attempt(ore,'mine',ore.replace(' ore',''));if(opts.some(w=>w.action==='mine'))break;}
    if(local.some(s=>s.kind==='fishing'))for(const f of [...FISH_RECIPES].reverse()) {attempt(`raw ${f.fish}`,'fish',f.fish);if(opts.some(w=>w.action==='fish'))break;}
    // Offer a fight only with an own supported food chain. Actual entry readiness still rechecks.
    const foe=local.filter(s=>s.kind==='monster'&&s.level!=null&&s.level>3&&s.level<=member.combat&&!/^(cow|chicken|goblin|giant rat|rat|imp)s?$/i.test(s.type)).sort((a,b)=>(a.level??0)-(b.level??0))[0];
    const food=foe?productionChain({...ctx,members:[member],size:1},'shrimps',10,member.name):undefined;
    if(foe&&food&&!food.blocker)opts.push({owner:member.name,action:'fight',target:foe.type,note:`Optional provisioned short ${foe.type} test in ${region.name}; avoid starter mobs, keep own retreat rules; arrival is not proof of a safe route`});
    return opts;
}
export function expeditionOffer(ctx:Ctx,region:Region):Offer {
    if(!ctx.sharedProjects)return 'shared-project mission policy is not enabled';
    if(ctx.members.length!==ctx.size||ctx.size!==4)return 'a shared expedition needs all four fresh characters';
    const choices=ctx.members.map(m=>({member:m,methods:expeditionMethods(ctx,region,m)}));
    if(choices.some(c=>!c.methods.length))return `not every character has a supported own-prepared field method in ${region.name}`;
    if(new Set(choices.flatMap(c=>c.methods.map(w=>w.action))).size<3)return `fewer than three supported activity types in ${region.name}`;
    const participants=ctx.members.map(m=>m.name).sort();
    const work:MissionWork[]=choices.flatMap(({member,methods})=>[
        {owner:member.name,action:'travel',target:`${region.x},${region.z}`,note:`Prepare for a bounded ${region.name} outing; choose a reachable indexed site, survey and test, then return to a chosen bank`},
        {owner:member.name,action:'look',target:'',note:`Observe actual ${region.name} surroundings; fresh field evidence required`},...methods]);
    const checks:MenuMilestone[]=choices.map(({member})=>({
        what:`${member.name} surveys ${region.name} and contributes a practical field test`,
        needs:`${member.name}: observe the area with look, then test an eligible resource/method or speak to a real NPC; no level grind. Coordinate three different activity types across the party.`,
        check:{kind:'expedition',region,participants,member:member.name,since:0},owner:member.name,
        next:work.find(w=>w.owner===member.name),fallback:'Resolve preparation/access together or propose a feasible regional alternative; unrelated training does not complete fieldwork'}));
    checks.push({what:'The party compares at least three distinct field activity types',needs:'All four contribute; divide methods by agreement, share observed results and a useful next question.',
        check:{kind:'expedition',region,participants,minMethods:3,since:0},owner:participants[0],next:work[0],fallback:'Choose another supported field activity; repeated variants of one skill count once'});
    return {...make(`expedition-${region.name.toLowerCase().replace(/ /g,'-')}`,'discovery',`${region.name} Field Expedition`,
        `Explore ${region.name} as a party: every character brings back a survey and a practical test, with at least three different activities between you.`,
        'Levels enable the outing; observed discoveries and experiments are the objective. Choose your contributions, provisions, partner and return plan.',checks,work),
        key:`expedition:${region.name}:${participants.join(',')}`};
}
export interface MissionTemplate {
    id: string;
    title: string;
    offer: (ctx: Ctx) => Offer;
}
export const MISSION_LIBRARY: MissionTemplate[] = [
    {id:'combat-challenge',title:'From Guards to White Knights',offer:ctx=>ctx.sharedProjects?huntOffer(ctx):'combat challenge policy not enabled'},
    ...REGIONS.map(region=>({id:`expedition-${region.name.toLowerCase().replace(/ /g,'-')}`,title:`${region.name} Field Expedition`,offer:(ctx:Ctx)=>expeditionOffer(ctx,region)})),
    { id: 'forge', title: 'The Forge', offer: forge },
    { id: 'hunters', title: 'The Monster Hunters', offer: slayers },
    { id: 'cooks-table', title: "The Cooks' Table", offer: table },
    { id: 'two-trades', title: 'Masters of Two Trades', offer: craftsmen },
    { id: 'treasury', title: 'The Treasury', offer: treasury },
    ...['copper ore', 'tin ore', 'iron ore', 'coal', 'silver ore', 'gold ore', 'mithril ore', 'adamantite ore'].map((item) => ({
        id: `ore-${item}`,
        title: `${cap(item)} Reserve`,
        offer: (ctx: Ctx) => supply(ctx, `ore-${item}`, item, 84, 'materials'),
    })),
    ...['logs', 'oak logs', 'willow logs'].map((item) => ({
        id: `wood-${item}`,
        title: `${cap(item)} Reserve`,
        offer: (ctx: Ctx) => supply(ctx, `wood-${item}`, item, 112, 'forestry'),
    })),
    ...['bronze', 'iron', 'steel', 'mithril', 'adamantite'].map((metal) => ({
        id: `bars-${metal}`,
        title: `${cap(metal)} Bar Reserve`,
        offer: (ctx: Ctx) => harderBar(ctx, `${metal} bar`) ?? supply(ctx, `bars-${metal}`, `${metal} bar`, 56, 'manufacturing'),
    })),
    ...['shrimps', 'trout', 'salmon'].map((item) => ({
        id: `food-${item}`,
        title: `${cap(item)} Pantry`,
        offer: (ctx: Ctx) => supply(ctx, `food-${item}`, item, 60, 'food'),
    })),
    ...['Mining', 'Smithing', 'Woodcutting', 'Fishing', 'Cooking', 'Firemaking', 'Fletching', 'Crafting'].map((skill) => ({
        id: `mark-${skill.toLowerCase()}`,
        title: `${skill} Workshop`,
        offer: (ctx: Ctx) => mark(ctx, skill),
    })),
];
/** Stock-reserve templates: low effort next to skill, gear, combat or trade missions. */
const RESERVE = /^(ore|wood|bars|food)-/;
export interface OfferDiagnostic {
    template: string;
    key?: string;
    eligible: boolean;
    offered: boolean;
    why: string;
}
function candidates(ctx: Ctx, exclude: string[]): { eligible: MenuMission[]; why: OfferDiagnostic[] } {
    const eligible: MenuMission[] = [];
    const why: OfferDiagnostic[] = [];
    for (const template of MISSION_LIBRARY) {
        const offer = ctx.members.length < ctx.size ? 'waiting for fresh state from every character' : template.offer(ctx);
        let reason =
            ctx.sharedProjects&&template.id!=='combat-challenge'
                ? 'personal training or stock work; current priority is the prepared combat challenge'
                : typeof offer === 'string'
                ? offer
                : exclude.includes(offer.key) || exclude.includes(offer.title)
                  ? 'this exact objective is current or recent'
                  : offer.milestones.every((m) => evaluate(m.check, ctx).met)
                    ? 'every milestone is already met'
                    : '';
        const ok = !reason && typeof offer !== 'string';
        if (ok) eligible.push(offer as MenuMission);
        why.push({
            template: template.title,
            ...(typeof offer === 'string' ? {} : { key: offer.key }),
            eligible: !!ok,
            offered: false,
            why: reason || 'eligible; awaiting diverse shortlist selection',
        });
    }
    return { eligible, why };
}
export function opportunityMenu(ctx: Ctx, exclude: string[] = []): { menu: MenuMission[]; why: OfferDiagnostic[]; eligibleCount: number } {
    const { eligible, why } = candidates(ctx, exclude);
    // Stock reserves are the easy fallback, and a template just used sorts after fresh ones.
    const reserve = (m: MenuMission) => RESERVE.test(m.template);
    const lastTwo = exclude.slice(0, 2).map((k) => k.split(':')[0]);
    const rank = (m: MenuMission) => (reserve(m) ? 2 : lastTwo.includes(m.template) ? 1 : 0);
    const ordered = [...eligible].sort((a, b) => rank(a) - rank(b));
    const picked: MenuMission[] = [];
    const categories = new Set<string>();
    const checks = new Set<string>();
    const add = (m: MenuMission) => {
        if (picked.includes(m) || picked.length >= 5) return;
        const signatures = m.milestones.map((x) => JSON.stringify(x.check));
        if (signatures.every((s) => checks.has(s))) return;
        picked.push(m);
        categories.add(m.category);
        signatures.forEach((s) => checks.add(s));
    };
    const substantive = ordered.filter((m) => !reserve(m));
    for (const m of substantive) if (!categories.has(m.category)) add(m);
    for (const m of substantive) add(m);
    // Reserves only top up a thin shortlist, never straight after another reserve, and never leave it empty.
    const reserves = ordered.filter(reserve);
    const justDidReserve = lastTwo.some((t) => RESERVE.test(t));
    if (picked.length < 3 && !justDidReserve) for (const m of reserves) if (picked.length < 3) add(m);
    if (!picked.length) for (const m of reserves.slice(0, 1)) add(m);
    for (const d of why) {
        if (picked.some((m) => m.key === d.key)) {
            d.offered = true;
            d.why = 'eligible and selected for the diverse shortlist';
        } else if (d.eligible && eligible.some((m) => m.key === d.key && reserve(m))) d.why = 'eligible, but a stock reserve is only a fallback for a thin shortlist';
    }
    return { menu: picked.map((m, i) => ({ ...m, id: i + 1 })), why, eligibleCount: eligible.length };
}
export const buildMenu = (ctx: Ctx, exclude: string[] = []) => opportunityMenu(ctx, exclude).menu;
export const explainMenu = (ctx: Ctx, exclude: string[] = []) => opportunityMenu(ctx, exclude).why;

/** Revalidate old concrete objectives as well as new metadata; existing stock can satisfy a chain. */
export function missionBlockers(goal: { milestones: { done: boolean; auto?: { check?: Check } }[] }, ctx: Ctx): string[] {
    if (ctx.members.length < ctx.size) return [];
    const blockers: string[] = [];
    for (const m of goal.milestones) {
        if (m.done || !m.auto?.check) continue;
        const check = m.auto.check;
        if(check.kind==='expedition'&&check.since===0) {
            // Revalidate a new proposal, but keep accepted trips through recoverable preparation
            // loss. Their remaining tasks can use another supported method or conversation.
            const offer=expeditionOffer({...ctx,sharedProjects:true},check.region);
            if(typeof offer==='string')blockers.push(offer);
        }
        if (check.kind === 'stock') {
            const chain = productionChain(ctx, check.item, check.count);
            if (chain.blocker) blockers.push(chain.blocker);
        }
        if (check.kind === 'skill') {
            if (check.level > 99 || check.level < 1) blockers.push(`invalid ${check.skill} target ${check.level}`);
            else if (!evaluate(check, ctx).met) {
                const training = skillWork(ctx, check.skill, check.member);
                if (typeof training === 'string') blockers.push(training);
            }
        }
    }
    return [...new Set(blockers)];
}

/** Desired supported work survives stock depletion; old flattened work is filtered by open skill. */
export function missionSupplyWork(goal: {work?:MissionWork[];milestones:{done:boolean;owner?:string;auto?:{check?:Check}}[]}|undefined,ctx:Ctx): (MissionWork & {supplyUnitsCap?:number})[] {
    if(!goal)return [];
    return goal.milestones.flatMap(m=>{
        const check=m.auto?.check;if(m.done||!check)return [];
        if(check.kind==='skill') {
            const owner=check.member??m.owner;
            const worker=ctx.members.find(x=>x.name===owner);
            if(!worker||skillOf(worker,check.skill)>=check.level)return [];
            const action=SKILL_ACTION[check.skill];
            const actions=check.skill==='Smithing'?['smelt','smith']:check.skill==='Crafting'?['smelt','craft']:check.skill==='Cooking'?['fish','cook']:check.skill==='Fletching'||check.skill==='Firemaking'?['chop_trees',action]:[action];
            const recorded=(goal.work??[]).filter(w=>w.owner===worker.name&&actions.includes(w.action));
            const intended=recorded.filter(w=>w.action!=='smelt'||(check.skill==='Smithing'
                ?recorded.some(p=>p.action==='smith'&&smithRecipe(p.target)?.bar===`${w.target==='adamant'?'adamantite':w.target} bar`)
                :check.skill==='Crafting'&&w.target==='gold'));

            if(intended.length)return intended;
            const chain=skillWork({...ctx,members:[worker],size:1},check.skill,worker.name);
            return typeof chain==='string'?[]:chain.work;
        }
        // Stock objectives need a complete fresh view to assess aggregate stock and finite shortfall.
        if(check.kind==='stock'&&ctx.members.length===ctx.size&&!evaluate(check,ctx).met) {
            const chain=productionChain(ctx,check.item,check.count);return chain.blocker?[]:chain.work.map(w=>({...w,...(w.amount!==undefined?{supplyUnitsCap:w.amount}:{})}));
        }
        return [];
    });
}

/** Rebuild task suggestions from fresh facts while keeping the chosen checks/targets stable. */
export function refreshMissionWork(
    goal: { work?: MissionWork[]; milestones: { done: boolean; owner?: string; next?: MissionWork; auto?: { check?: Check } }[] },
    ctx: Ctx,
): void {
    if (ctx.members.length < ctx.size) return;
    // Hunt charter preparation/consent instructions are stage-specific; generic wear refresh
    // would incorrectly replace its weapon task with an armour-forge chain.
    if(goal.milestones.some(m=>m.auto?.check?.kind==='hunt'))return;
    const work: MissionWork[] = [];
    for (const m of goal.milestones) {
        const check = m.auto?.check;
        if (m.done || !check) continue;
        let plan: MissionWork[] = [];
        if(check.kind==='expedition') {
            const offer=expeditionOffer({...ctx,sharedProjects:true},check.region);
            if(typeof offer!=='string') {
                plan=offer.work.filter(w=>!check.member||w.owner===check.member);
                if(check.member&&(check.proofs??[]).some(p=>p.kind==='survey'&&p.bot===check.member))plan=plan.filter(w=>FIELD_ACTIONS.has(w.action));
                if(!check.member) {
                    const tried=new Set((check.proofs??[]).filter(p=>p.kind==='trial').map(p=>p.action));
                    plan=plan.filter(w=>FIELD_ACTIONS.has(w.action)&&!tried.has(w.action));
                }
            }
        } else if (check.kind === 'stock') {
            const chain = productionChain(ctx, check.item, check.count);
            if (!chain.blocker) plan = chain.work;
        } else if (check.kind === 'skill') {
            const training = skillWork(ctx, check.skill, check.member);
            if (typeof training !== 'string') plan = training.work;
        } else if (check.kind === 'wear') {
            const offer = forge(ctx);
            if (typeof offer !== 'string') plan = offer.work;
        } else if (check.kind === 'coins') {
            const offer = treasury(ctx);
            if (typeof offer !== 'string') plan = offer.work;
        } else if (check.kind === 'kill') {
            const offer = slayers(ctx);
            if (typeof offer !== 'string') plan = offer.work;
        }
        if (plan.length) {
            m.next = plan[0];
            if(check.kind==='expedition'&&!check.member)m.owner=plan[0].owner;
            work.push(...plan);
        }
    }
    if (work.length) {
        const seen = new Set<string>();
        goal.work = work.filter((task) => {
            const key = JSON.stringify([task.owner, task.action, task.target, task.to]);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
}

/** The live context: every connected character's state and last-seen bank. */
export function liveContext(
    agents: Iterable<{ name: string; sdk: { getState(): BotWorldState | null; getStateAge?(): number } }>,
    size: number,
): Ctx {
    const members: Member[] = [];
    for (const a of agents) {
        const s = a.sdk.getState();
        if (s?.inGame && s.skills.length && (a.sdk.getStateAge?.() ?? 0) <= 30_000)
            members.push(memberFrom(a.name, s, bankOf(a.name)?.items));
    }
    return { members, size, has: hasAchievement,sharedProjects:true };
}
