import { cleanLookupText } from './lookup-text';
// The shops the party can reach, with stock and prices read from rs-sdk's wiki (generated from
// the server's own shop data), so the catalogue matches the game rather than memory.
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const WIKI = join(import.meta.dir, '..', 'rs-sdk', 'wiki', 'shops');

export interface ShopItem {
    name: string;
    /** What the shop charges, in coins. */
    price: number;
    /** What the shop pays for one, in coins. */
    buys: number;
}

export interface Shop {
    name: string;
    x: number;
    z: number;
    /** The shopkeeper's name when it is not "Shop keeper". */
    keeper?: RegExp;
    /** A general store buys anything; a specialty shop only buys what it sells. */
    general?: boolean;
    items: ShopItem[];
}

const SHOP_DEFS: (Omit<Shop, 'items'> & { file: string })[] = [
    { name: 'Lumbridge general store', file: 'lumbridge-general-store', x: 3212, z: 3247, general: true },
    { name: "Bob's Brilliant Axes", file: 'bobs-brilliant-axes', x: 3230, z: 3203, keeper: /^bob$/i },
    { name: 'Varrock general store', file: 'varrock-general-store', x: 3217, z: 3413, general: true },
    { name: 'Varrock Swordshop', file: 'varrock-swordshop', x: 3205, z: 3399 },
    { name: "Horvik's Armour Shop", file: 'horviks-armour-shop', x: 3229, z: 3437, keeper: /^horvik$/i },
    { name: "Lowe's Archery Emporium", file: 'lowes-archery-emporium', x: 3232, z: 3423, keeper: /^lowe$/i },
    { name: "Peksa's Helmet Shop", file: 'helmet-shop', x: 3076, z: 3429, keeper: /^peksa$/i },
    { name: "Aubury's Rune Shop", file: 'auburys-rune-shop', x: 3253, z: 3402, keeper: /^aubury$/i },
    { name: "Dommik's Crafting Store", file: 'dommiks-crafting-store', x: 3322, z: 3194, keeper: /^dommik$/i },
    { name: "Thessalia's Fine Clothes", file: 'thessalia-fine-clothes', x: 3204, z: 3417, keeper: /^thessalia$/i },
    { name: "Cassie's Shield Shop", file: 'cassies-shield-shop', x: 2979, z: 3383, keeper: /^cassie$/i },
    // Spawn positions of each keeper come from the server's own map files; stock from the wiki.
    { name: "Zeke's Superior Scimitars", file: 'zekes-superior-scimitars', x: 3288, z: 3190, keeper: /^zeke$/i },
    { name: "Louie's Armoured Legs Bazaar", file: 'louies-armoured-legs-bazaar', x: 3316, z: 3175, keeper: /^louie legs$/i },
    { name: "Ranael's Super Skirt Store", file: 'ranaels-super-skirt-store', x: 3316, z: 3164, keeper: /^ranael$/i },
    { name: 'Gem Trader', file: 'gem-trader', x: 3288, z: 3212, keeper: /^gem trader$/i },
    { name: "Brian's Battleaxe Bazaar", file: 'brians-battleaxe-bazaar', x: 3028, z: 3250, keeper: /^brian$/i },
    { name: "Wayne's Chains", file: 'waynes-chains-chainmail-specialist', x: 2973, z: 3312, keeper: /^wayne$/i },
    { name: "Flynn's Mace Market", file: 'flynns-mace-market', x: 2951, z: 3386, keeper: /^flynn$/i },
    { name: "Herquin's Gems", file: 'herquins-gems', x: 2944, z: 3334, keeper: /^herquin$/i },
    { name: "Grum's Gold Exchange", file: 'grums-gold-exchange', x: 3013, z: 3248, keeper: /^grum$/i },
    { name: "Betty's Magic Emporium", file: 'bettys-magic-emporium', x: 3012, z: 3259, keeper: /^betty$/i },
    { name: 'Port Sarim Food Store', file: 'food-store', x: 3014, z: 3204, keeper: /^wydin$/i },
    { name: 'Fancy Clothes Store', file: 'fancy-clothes-store', x: 3281, z: 3398, keeper: /^fancy dress shop owner$/i },
    { name: "Rommik's Crafty Supplies", file: 'rommiks-crafty-supplies', x: 2946, z: 3205, keeper: /^rommik$/i },
    { name: "Zaff's Superior Staffs", file: 'staffshop', x: 3203, z: 3433, keeper: /^zaff$/i },
    { name: "Gaius' Two Handed Shop", file: 'gaius-two-handed-shop', x: 2885, z: 3449, keeper: /^gaius$/i },
    { name: 'Falador general store', file: 'falador-general-store', x: 2957, z: 3386, general: true },
    { name: 'Rimmington general store', file: 'rimmington-general-store', x: 2947, z: 3216, general: true },
    { name: 'Al Kharid general store', file: 'al-kharid-general-store', x: 3316, z: 3184, general: true },
    { name: 'Edgeville general store', file: 'edgeville-general-store', x: 3080, z: 3511, general: true },
    { name: "Gerrant's Fishy Business", file: 'gerrants-fishy-business', x: 3014, z: 3224, keeper: /^gerrant$/i }
];

function readStock(file: string): ShopItem[] {
    const path = join(WIKI, `${file}.md`);
    if (!existsSync(path)) return [];
    const items: ShopItem[] = [];
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
        const m = line.match(/^\| \[([^\]]+)\][^|]*\| \d+ \| (\d+) gp \| (\d+) gp \|/);
        if (m) items.push({ name: m[1], price: +m[2], buys: +m[3] });
    }
    return items;
}

export const SHOPS: Shop[] = SHOP_DEFS.map(({ file, ...s }) => ({ ...s, items: readStock(file) }));

const norm = (s: string) => cleanLookupText(s).toLowerCase().replace(/s$/, '');

/** The cheapest shop selling an item, by exact name first, then by a name that contains it. */
export function shopSelling(item: string): { shop: Shop; item: ShopItem } | null {
    const want = norm(item);
    for (const exact of [true, false]) {
        const hits = SHOPS.flatMap(shop => shop.items.filter(i => (exact ? norm(i.name) === want : norm(i.name).includes(want))).map(i => ({ shop, item: i })));
        if (hits.length) return hits.sort((a, b) => a.item.price - b.item.price)[0];
    }
    return null;
}

/** The specialty shop that pays most for an item, if any stocks it. */
export function bestBuyer(item: string): { shop: Shop; item: ShopItem } | null {
    const want = norm(item);
    const hits = SHOPS.filter(s => !s.general).flatMap(shop => shop.items.filter(i => norm(i.name) === want).map(i => ({ shop, item: i })));
    return hits.sort((a, b) => b.item.buys - a.item.buys)[0] ?? null;
}

const METALS = ['bronze', 'iron', 'steel', 'black', 'mithril', 'adamant', 'rune'];

/**
 * One line per shop for the atlas, grouping metal tiers: "swords (bronze 26, iron 91, ...)".
 * Prices are what the shop charges; a specialty shop buys its own goods back for about 60%.
 */
export function renderShops(): string {
    return SHOPS.map(s => {
        const groups = new Map<string, string[]>();
        const single: string[] = [];
        for (const i of s.items) {
            const metal = METALS.find(m => i.name.toLowerCase().startsWith(`${m} `));
            if (!metal) {
                single.push(`${i.name.toLowerCase()} ${i.price}`);
                continue;
            }
            const kind = i.name.slice(metal.length + 1).toLowerCase();
            groups.set(kind, [...(groups.get(kind) ?? []), `${metal} ${i.price}`]);
        }
        const stock = [...[...groups].map(([kind, tiers]) => `${kind} (${tiers.join(', ')})`), ...single].join('; ');
        const buys = s.general ? 'buys almost anything, for little' : 'buys back what it sells';
        return `- ${s.name} (${s.x}, ${s.z}), prices in coins: ${stock}. ${buys[0].toUpperCase()}${buys.slice(1)}.`;
    }).join('\n');
}
