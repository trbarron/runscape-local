import { ORE_PAIRS, partnerNeed } from './smelting';
// Deterministic production feasibility. No gameplay calls: a chain is evidence for a mission,
// not an order silently executed on a character's behalf.
import type { Member, Ctx } from './missions';
import { SPOTS, NEEDS, type Spot } from './world-index/index';
import { FISHING } from './fishing';
import { shopSelling } from './shops';
import { cookingLevel, smithRecipe, toolUseLevel, JEWELLERY_LEVELS, CUT_LEVELS } from './game-requirements';

export interface MissionWork {
    owner: string;
    action: string;
    target: string;
    amount?: number;
    to?: string;
    skill?: string;
    level?: number;
    note: string;
}
export interface Chain {
    work: MissionWork[];
    owner: string;
    blocker?: string;
}
export const FISH_RECIPES = [
    { fish: 'shrimps', method: 'shrimps', fishing: 1 },
    { fish: 'anchovies', method: 'anchovies', fishing: 15 },
    { fish: 'sardine', method: 'sardine', fishing: 5 },
    { fish: 'herring', method: 'herring', fishing: 10 },
    { fish: 'trout', method: 'trout', fishing: 20 },
    { fish: 'pike', method: 'pike', fishing: 25 },
    { fish: 'salmon', method: 'salmon', fishing: 30 },
    { fish: 'tuna', method: 'tuna', fishing: 35 },
    { fish: 'lobster', method: 'lobster', fishing: 40 },
    { fish: 'swordfish', method: 'swordfish', fishing: 50 },
];
export const BAR_RECIPES: Record<string, { level: number; ores: [string, number][] }> = Object.fromEntries(
    Object.entries(ORE_PAIRS).map(([metal, [main, partner, level]]) => {
        const ores: [string, number][] = [[main.source.replace(/[\^$\\]/g, ''), metal === 'steel' ? 2 : 1]];
        if (partner) ores.push([partner.source.replace(/[\^$\\]/g, ''), partnerNeed(metal)]);
        return [metal, { level, ores }];
    }),
);
export const skillOf = (m: Member, skill: string) => m.skills[skill] ?? 1;
export const owned = (m: Member, item: string) => (m.carried[item] ?? 0) + (m.bank[item] ?? 0);
export const sites = (ctx: Ctx) => ctx.spots ?? SPOTS;
export const safeSite = (ctx: Ctx, kind: Spot['kind'], type?: string) =>
    sites(ctx).some((s) => s.kind === kind && (!type || s.type === type) && s.z < 3520 && !s.tollGate);
const qualified = (ctx: Ctx, skill: string, level: number, preferred?: string, avoid?: string) =>
    [...ctx.members]
        .filter((m) => skillOf(m, skill) >= level)
        .sort(
            (a, b) =>
                Number(b.name === preferred) - Number(a.name === preferred) ||
                Number(a.name === avoid) - Number(b.name === avoid) ||
                skillOf(b, skill) - skillOf(a, skill) ||
                a.name.localeCompare(b.name),
        )[0];

/** Build supply and transfer steps, charging purchases to the actual buyer's own coins. */
export function productionChain(ctx: Ctx, item: string, amount: number, preferred?: string): Chain {
    const work: MissionWork[] = [];
    const spending = new Map<string, number>();
    const reserved = new Map<string, number>();
    const purchased = new Map<string, number>();
    let localOwner: string | undefined;
    const choose = (skill: string, level: number, preferred?: string, avoid?: string) =>
        qualified(localOwner ? { ...ctx, members: ctx.members.filter(m => m.name === localOwner) } : ctx, skill, level, preferred, avoid);
    const ownLeft = (m: Member, item: string) => Math.max(0, owned(m, item) - (reserved.get(`${m.name}:${item}`) ?? 0));
    const add = (owner: string, action: string, target: string, note: string, amount?: number, to?: string) =>
        work.push({ owner, action, target, note, ...(amount ? { amount } : {}), ...(to ? { to } : {}) });
    const use = (m: Member, item: string, n: number) => reserved.set(`${m.name}:${item}`, (reserved.get(`${m.name}:${item}`) ?? 0) + n);
    const tool = (m: Member, item: string, count = 1): string | null => {
        const normalized = item.replace(/s$/, '');
        const toolSkill = item === 'bronze pickaxe' ? 'Mining' : item === 'bronze axe' ? 'Woodcutting' : undefined;
        const matches = (name: string) =>
            toolSkill
                ? (toolSkill === 'Mining' ? /pickaxe$/i : /(?<!pick)axe$/i).test(name) && skillOf(m, toolSkill) >= toolUseLevel(name)
                : name.replace(/s$/, '') === normalized;
        const held =
            [...new Set([...Object.keys(m.bank), ...Object.keys(m.carried)])]
                .filter(matches)
                .reduce((sum, name) => sum + owned(m, name), 0) + Number(m.worn.some(matches));
        const key = `${m.name}:${normalized}`;
        const missing = Math.max(0, count - held - (purchased.get(key) ?? 0));
        if (!missing) return null;
        const sale = shopSelling(item);
        if (!sale) return `${m.name} lacks ${item} and no supported shop sells it`;
        const cost = sale.item.price * missing + (spending.get(m.name) ?? 0);
        if (cost > owned(m, 'coins')) return `${m.name} cannot fund ${missing} ${item} from their own coins`;
        purchased.set(key, (purchased.get(key) ?? 0) + missing);
        spending.set(m.name, cost);
        add(m.name, 'buy', sale.item.name, `Buy at ${sale.shop.name} using own carried/banked coins`, missing);
        return null;
    };
    const taskTarget = (name: string) => (FISH_RECIPES.some((f) => f.fish === name) ? `cooked ${name}` : name);
    const acquire = (wanted: string, n: number, recipient?: Member, makeNew = false): Member | string => {
        // Try the recipient's complete own-bank/production chain before adding
        // a teammate rendezvous. Failed probes must restore every reservation,
        // purchase budget and suggested step before the shared fallback.
        if (recipient && !localOwner && ctx.members.length > 1) {
            const length = work.length;
            const snapshots = [spending, reserved, purchased].map(m => new Map(m));
            localOwner = recipient.name;
            let result: Member | string;
            try { result = acquire(wanted, n, recipient, makeNew); }
            finally { localOwner = undefined; }
            if (typeof result !== 'string') return result;
            work.length = length;
            [spending, reserved, purchased].forEach((m, i) => { m.clear(); for (const [k, v] of snapshots[i]) m.set(k, v); });
        }
        // Existing stock can satisfy any link; distinct banks need an explicit transfer.
        let remaining = n;
        let owner = recipient;
        const holders = (makeNew ? [] : ctx.members.filter(m => !localOwner || m.name === localOwner)).sort(
            (a, b) => Number(b.name === recipient?.name) - Number(a.name === recipient?.name) || ownLeft(b, wanted) - ownLeft(a, wanted),
        );
        for (const holder of holders) {
            const take = Math.min(remaining, ownLeft(holder, wanted));
            if (!take) continue;
            owner ??= holder;
            use(holder, wanted, take);
            if ((holder.bank[wanted] ?? 0) > 0)
                add(holder.name, 'withdraw_from_bank', taskTarget(wanted), 'Withdraw own stock before use or delivery', take);
            if (holder.name !== owner.name)
                add(
                    holder.name,
                    'give',
                    taskTarget(wanted),
                    `Deliver to ${owner.name} at a mutually safe bank; confirm receiving room`,
                    take,
                    owner.name,
                );
            remaining -= take;
            if (!remaining) return owner;
        }
        const resource = Object.entries(NEEDS).find(([, need]) => need.what === wanted && ['Mining', 'Woodcutting'].includes(need.skill));
        if (resource) {
            const [type, need] = resource;
            const worker = choose(need.skill, need.level, recipient?.name);
            if (!worker || !safeSite(ctx, need.skill === 'Mining' ? 'rock' : 'tree', type))
                return `no qualified worker and reachable ${type} ${need.skill === 'Mining' ? 'rocks' : 'trees'}`;
            const blocked = tool(worker, need.skill === 'Mining' ? 'bronze pickaxe' : 'bronze axe');
            if (blocked) return blocked;
            add(worker.name, need.skill === 'Mining' ? 'mine' : 'chop_trees', type, `Gather ${remaining} ${wanted}`, remaining);
            owner ??= recipient ?? worker;
            if (worker.name !== owner.name)
                add(worker.name, 'give', taskTarget(wanted), `Supply ${owner.name} at a safe bank`, remaining, owner.name);
            return owner;
        }
        const raw = wanted.startsWith('raw ');
        const fish = FISH_RECIPES.find((f) => f.fish === wanted.replace(/^raw /, ''));
        if (fish) {
            if (raw) {
                const method = FISHING[fish.method];
                const angler = choose('Fishing', fish.fishing, recipient?.name);
                if (!angler || !safeSite(ctx, 'fishing', method.spot))
                    return `no qualified angler or reachable ${method.spot} fishing spot for ${wanted}`;
                if (method.via) {
                    const fare = 60;
                    const available = ownLeft(angler, 'coins') - (spending.get(angler.name) ?? 0);
                    if (available < fare) return `${angler.name} needs 60 own coins for the Karamja ferry (30 each way), has ${available}`;
                    spending.set(angler.name, (spending.get(angler.name) ?? 0) + fare);
                }
                for (const [name] of method.tools) {
                    const blocked = tool(angler, name, /bait|feather/.test(name) ? Math.max(30, remaining) : 1);
                    if (blocked) return blocked;
                }
                add(angler.name, 'fish', fish.method, `Catch ${remaining} ${wanted}`, remaining);
                owner ??= recipient ?? angler;
                if (angler.name !== owner.name)
                    add(angler.name, 'give', taskTarget(wanted), `Supply ${owner.name} at a safe bank`, remaining, owner.name);
                return owner;
            }
            const cook = choose(
                'Cooking',
                cookingLevel(`raw ${fish.fish}`),
                recipient?.name,
                choose('Fishing', fish.fishing)?.name,
            );
            if (!cook || !safeSite(ctx, 'range')) return `no qualified cook or reachable range for ${wanted}`;
            const supplied = acquire(`raw ${fish.fish}`, remaining, cook);
            if (typeof supplied === 'string') return supplied;
            add(cook.name, 'cook', `raw ${fish.fish}`, `Cook and bank ${remaining} ${fish.fish}; replace burnt portions`, remaining);
            owner ??= recipient ?? cook;
            if (cook.name !== owner.name)
                add(cook.name, 'give', taskTarget(wanted), `Supply ${owner.name} at a safe bank`, remaining, owner.name);
            return owner;
        }
        const label = wanted.match(/^(\w+) bar$/)?.[1];
        const metal = label === 'runite' ? 'rune' : label === 'adamantite' ? 'adamant' : label;
        if (metal && BAR_RECIPES[metal]) {
            const recipe = BAR_RECIPES[metal];
            const smelter = choose('Smithing', recipe.level, recipient?.name);
            if (!smelter || !safeSite(ctx, 'furnace')) return `no qualified smelter or reachable furnace for ${wanted}`;
            for (const [ore, count] of recipe.ores) {
                const supplied = acquire(ore, remaining * count, smelter);
                if (typeof supplied === 'string') return supplied;
            }
            add(smelter.name, 'smelt', metal, `Smelt ${remaining} ${wanted}; replenish ore if iron fails`, remaining);
            owner ??= recipient ?? smelter;
            if (smelter.name !== owner.name)
                add(smelter.name, 'give', taskTarget(wanted), `Supply ${owner.name} at a safe bank`, remaining, owner.name);
            return owner;
        }
        const jewellery = wanted.match(/^(gold|sapphire|emerald|ruby|diamond) (ring|necklace|amulet)$/i);
        if (jewellery) {
            const gem = jewellery[1].toLowerCase();
            const product = jewellery[2].toLowerCase();
            const level = JEWELLERY_LEVELS[product][gem];
            const crafter = choose('Crafting', level, recipient?.name);
            if (!crafter) return `no qualified crafter for ${wanted} (Crafting ${level})`;
            const mould = tool(crafter, `${product} mould`);
            if (mould) return mould;
            if (gem !== 'gold') {
                const suppliedGem = acquire(gem, remaining, crafter);
                if (typeof suppliedGem === 'string') return `no complete gem supply for ${wanted}: ${suppliedGem}`;
            }
            const bars = acquire('gold bar', remaining, crafter);
            if (typeof bars === 'string') return bars;
            add(crafter.name, 'craft', wanted, `Craft ${remaining} ${wanted} at a furnace`, remaining);
            owner ??= recipient ?? crafter;
            if (crafter.name !== owner.name)
                add(crafter.name, 'give', taskTarget(wanted), `Supply ${owner.name} at a safe bank`, remaining, owner.name);
            return owner;
        }
        const recipe = smithRecipe(wanted);
        if (recipe) {
            const smith = choose('Smithing', recipe.level, recipient?.name);
            if (!smith || !safeSite(ctx, 'anvil')) return `no qualified smith or reachable anvil for ${wanted}`;
            const hammer = tool(smith, 'hammer');
            if (hammer) return hammer;
            const supplied = acquire(recipe.bar, remaining * recipe.count, smith);
            if (typeof supplied === 'string') return supplied;
            add(smith.name, 'smith', wanted, `Make ${remaining} ${wanted}`, remaining);
            owner ??= recipient ?? smith;
            if (smith.name !== owner.name)
                add(smith.name, 'give', taskTarget(wanted), `Supply ${owner.name} at a safe bank`, remaining, owner.name);
            return owner;
        }
        if (CUT_LEVELS[wanted] !== undefined) {
            const crafter = choose('Crafting', CUT_LEVELS[wanted], recipient?.name);
            if (!crafter) return `no qualified crafter to cut ${wanted} (Crafting ${CUT_LEVELS[wanted]})`;
            const uncut = acquire(`uncut ${wanted}`, remaining, crafter);
            if (typeof uncut === 'string') return `no complete uncut ${wanted} supply: ${uncut}`;
            const chisel = tool(crafter, 'chisel');
            if (chisel) return chisel;
            add(crafter.name, 'craft', `cut ${wanted}`, `Cut ${remaining} ${wanted} from uncut gems`, remaining);
            owner ??= recipient ?? crafter;
            if (crafter.name !== owner.name)
                add(crafter.name, 'give', taskTarget(wanted), `Supply ${owner.name} at a safe bank`, remaining, owner.name);
            return owner;
        }
        return `no supported production chain for ${wanted}`;
    };
    if (ctx.members.length < ctx.size) return { work, owner: '', blocker: 'waiting for fresh state from every character' };
    if (!safeSite(ctx, 'bank')) return { work, owner: '', blocker: 'no reachable bank for supply and delivery' };
    const recipient = ctx.members.find((m) => m.name === preferred);
    const existing = ctx.members.reduce((sum, m) => sum + owned(m, item.toLowerCase()), 0);
    if (!recipient && existing >= amount)
        return { work: [], owner: ctx.members.find((m) => owned(m, item.toLowerCase()) > 0)?.name ?? ctx.members[0].name };
    // A party-stock objective does not require consolidating every existing item in one bank.
    // Produce only its shortfall; internal ingredient links still withdraw/transfer actual stock.
    const result = acquire(item.toLowerCase(), recipient ? amount : amount - existing, recipient, !recipient);
    if (typeof result === 'string') return { work: [], owner: '', blocker: result };
    add(result.name, 'bank_resources', taskTarget(item), 'Keep the finished supply in its owner’s bank');
    return { work, owner: result.name };
}
