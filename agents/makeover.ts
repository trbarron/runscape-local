// One-off: change a character's look through the game's own shops, because a save file edit does not
// stick (the server writes the old look back). The Falador hairdresser sells a haircut and a shave
// (1000 coins each) and Thessalia in Varrock a top and legwear (500 each), so the whole of look C
// costs 3000 coins. Run it with the character logged out of the party (BOTS=... on the orchestrator).
//
//   bun agents/makeover.ts <account> [--give 3000] [--steps hair,shave,top,legs] [--dry]
//
// --give uses the admin ::give command, which needs staff level 3 on the account (see test-skills.ts).
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { BotSDK } from '../rs-sdk/sdk/index';
import { BotActions } from '../rs-sdk/sdk/actions';
import { initPathfinding } from '../rs-sdk/sdk/pathfinding';

const CONTENT = join(import.meta.dir, '..', 'rs-sdk', 'server', 'content');
const GAME_URL = process.env.GAME_URL ?? 'http://localhost:8888';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Look C, as the shops spell it: a style (the "%if1" the interface sets) and a colour index, per shop. */
const LOOK = {
    hair: { iface: 'player_kit_hair_man', style: 'man_head_shorthair', colour: 7, cost: 1000 },
    shave: { iface: 'player_kit_hair_jaw', style: 'man_jaw_split', colour: 7, cost: 1000 },
    top: { iface: 'player_kit_tailor_torso_man', style: 'man_torso_shirt', arms: 'man_arms_basic', colour: 4, cost: 500 },
    legs: { iface: 'player_kit_tailor_legs_man', style: 'man_legs_basic2', colour: 2, cost: 500 }
};

// ---- reading what each interface button does, from the game's own scripts -------------------------

const pack = new Map<string, number>(); // "iface:com" -> component id; "iface" -> interface id
for (const line of readFileSync(join(CONTENT, 'pack', 'interface.pack'), 'utf-8').split('\n')) {
    const m = line.match(/^(\d+)=(.+)$/);
    if (m) pack.set(m[2].trim(), +m[1]);
}

function* rs2Files(dir: string): Generator<string> {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) yield* rs2Files(p);
        else if (e.name.endsWith('.rs2')) yield p;
    }
}

/** For one interface: the component that sets each "%ifN" variable to each value, and the confirm button. */
function buttons(iface: string): { sets: Map<string, number>; confirm: number } {
    const sets = new Map<string, number>(); // "if1=6" -> component id
    let confirm = -1;
    const header = new RegExp(`^\\[if_button,${iface}:(\\w+)\\]\\s*(.*)$`);
    for (const f of rs2Files(join(CONTENT, 'scripts', 'areas'))) {
        const lines = readFileSync(f, 'utf-8').split('\n');
        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(header);
            if (!m) continue;
            const body = (m[2] || lines[i + 1] || '').trim();
            const id = pack.get(`${iface}:${m[1]}`);
            if (id === undefined) continue;
            const set = body.match(/^%(if\d)\s*=\s*(\d+);/);
            if (set) sets.set(`${set[1]}=${set[2]}`, id);
            else if (/^confirm$/.test(m[1]) || (!m[2] && /^if \(%if/.test(body))) confirm = id;
        }
    }
    return { sets, confirm };
}

/** The value a style takes in "if (%ifN = V) { setidkit(style, ...) }", from the same scripts. */
function styleValue(style: string, variable = 'if1'): number {
    for (const f of rs2Files(join(CONTENT, 'scripts', 'areas'))) {
        const text = readFileSync(f, 'utf-8');
        const m = text.match(new RegExp(`%${variable} = (\\d+)\\) \\{\\s*setidkit\\(${style},`));
        if (m) return +m[1];
    }
    throw new Error(`no shop sets ${style}`);
}

// ---- driving the character -------------------------------------------------------------------------

const args = process.argv.slice(2);
const NAME = args.find(a => !a.startsWith('--') && !/^\d/.test(a));
if (!NAME) throw new Error('usage: bun agents/makeover.ts <account> [--give N] [--steps hair,shave,top,legs] [--dry]');
const flag = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i < 0 ? undefined : (args[i + 1] ?? '');
};
const steps = (flag('steps') ?? 'hair,shave,top,legs').split(',') as (keyof typeof LOOK)[];
const give = +(flag('give') ?? 0);
const dry = args.includes('--dry');

const accounts = JSON.parse(readFileSync(join(import.meta.dir, 'accounts.json'), 'utf-8')) as Record<string, string>;
const password = accounts[NAME];
if (!password) throw new Error(`no password for ${NAME} in agents/accounts.json`);

initPathfinding();
const puppeteer: any = (await import(join(import.meta.dir, '..', 'rs-sdk', 'node_modules', 'puppeteer'))).default;
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--mute-audio', '--disable-background-timer-throttling'] });
try {
    const page = await browser.newPage();
    await page.goto(`${GAME_URL}/bot?bot=${NAME}&password=${encodeURIComponent(password)}`);
    const sdk = new BotSDK({ botUsername: NAME, password, gatewayUrl: 'ws://localhost:7780', connectionMode: 'control', autoReconnect: true, autoLaunchBrowser: false, showChat: false });
    const bot = new BotActions(sdk);
    await sdk.connect();
    const fresh = () => !!sdk.getState()?.inGame && sdk.getState()!.skills.length > 0 && sdk.getStateAge() < 2000;
    for (let i = 0; i < 90 && !fresh(); i++) await sleep(1000);
    if (!fresh()) throw new Error('never got fresh game state');
    await sleep(2000);
    const coins = () => sdk.countInventoryItems(/^coins$/i);
    const here = () => `${sdk.getState()!.player!.worldX},${sdk.getState()!.player!.worldZ}`;
    console.log(`${NAME} at ${here()} with ${coins()} coins`);

    const need = steps.reduce((n, s) => n + LOOK[s].cost, 0);
    if (give) {
        await sdk.say(`::give coins ${give}`);
        await sleep(3000);
        console.log(`gave ${give}: now ${coins()} coins`);
    }
    if (coins() < need) throw new Error(`needs ${need} coins in the pack for ${steps.join(', ')}, has ${coins()}`);

    const walk = async (x: number, z: number, near = 6) => {
        for (let t = 0; t < 40; t++) {
            const p = sdk.getState()!.player!;
            if (Math.abs(p.worldX - x) + Math.abs(p.worldZ - z) <= near) return;
            const r = await bot.walkTo(x, z, Math.min(3, near), { timeout: 60_000 });
            if (!r.success) console.log(`  walk: ${r.message}`);
            // Shop doors can stay shut: open the nearest one and try again.
            if (t >= 2) await bot.openDoor().then(d => console.log(`  door: ${d.success ? 'opened' : d.message}`)).catch(() => {});
        }
        throw new Error(`could not reach ${x},${z} from ${here()}`);
    };
    /** Clicks through the NPC's pages, taking each wanted option when it is offered, until the interface opens. */
    const converse = async (wanted: RegExp[], iface: string) => {
        const id = pack.get(iface)!;
        const pending = [...wanted];
        for (let t = 0; t < 120; t++) {
            const st = sdk.getState()!;
            if (st.modalOpen && st.modalInterface === id) return;
            const d = sdk.getDialog();
            if (d?.isOpen && d.options.length) {
                const pick = pending.length ? d.options.find(o => pending[0].test(o.text)) : undefined;
                const next = pick ?? d.options.find(o => /continue/i.test(o.text));
                if (pick) pending.shift();
                if (next) {
                    console.log(`  dialog: ${next.text}`);
                    await sdk.sendClickDialog(next.index);
                    await sleep(900);
                    continue;
                }
                console.log(`  dialog offers ${d.options.map(o => `"${o.text}"`).join(', ')} and nothing wanted`);
            }
            await sleep(500);
        }
        throw new Error(`${iface} did not open (modal ${sdk.getState()!.modalInterface})`);
    };
    const click = async (id: number, what: string) => {
        console.log(`  click ${what} (${id})`);
        if (!dry) await sdk.sendClickComponent(id);
        await sleep(700);
    };

    // The shop's choices for one change: [var, value] pairs to click, then confirm.
    const choose = async (key: keyof typeof LOOK) => {
        const look: any = LOOK[key];
        const b = buttons(look.iface);
        const picks: [string, string][] = [];
        const styleVar = 'if1';
        picks.push([`${styleVar}=${styleValue(look.style)}`, `style ${look.style}`]);
        if (look.arms) picks.push([`if2=${styleValue(look.arms, 'if2')}`, `arms ${look.arms}`]);
        // The colour variable is the last one the interface uses: if2 for the hair shops, if3 for the tailor.
        const colourVar = key === 'top' || key === 'legs' ? 'if3' : 'if2';
        picks.push([`${colourVar}=${look.colour + 1}`, `colour ${look.colour}`]);
        for (const [k, what] of picks) {
            const id = b.sets.get(k);
            if (id === undefined) throw new Error(`${look.iface}: no button sets ${k}`);
            await click(id, what);
        }
        if (b.confirm < 0) throw new Error(`${look.iface}: no confirm button found`);
        await click(b.confirm, 'confirm');
    };

    const before = coins();
    for (const step of steps) {
        const t = Date.now();
        if (step === 'hair' || step === 'shave') {
            await walk(2946, 3379);
            const r = await bot.talkTo(/^hairdresser$/i);
            console.log(`${step}: talk -> ${r.success} ${r.message ?? ''}`);
            await converse([step === 'hair' ? /haircut/i : /shave/i], LOOK[step].iface);
            await choose(step);
        } else {
            await walk(3205, 3416, 2); // Thessalia is indoors: stand next to her, through the door
            const r = await bot.talkTo(/^thessalia$/i);
            console.log(`${step}: talk -> ${r.success} ${r.message ?? ''}`);
            await converse([/what have you got/i, /tell me more/i, step === 'top' ? /change my top/i : /change my legwear/i], LOOK[step].iface);
            await choose(step);
        }
        await sleep(3000);
        console.log(`${step}: done in ${Math.round((Date.now() - t) / 1000)} s, coins ${before} -> ${coins()}`);
    }
    console.log('finished: log out and read the save to confirm');
    await sleep(2000);
} finally {
    await browser.close();
}
