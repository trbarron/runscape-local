// Live test of the scripted skills on a separate test character, so the party is not
// disturbed. Materials come from the admin ::give command, so the test account needs staff
// level 3 (the first run registers it and prints the one command to grant that).
//
//   bun agents/test-skills.ts                    # every skill below
//   bun agents/test-skills.ts cook smelt         # just these
//
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { BotSDK } from '../rs-sdk/sdk/index';
import { BotActions } from '../rs-sdk/sdk/actions';
import { initPathfinding } from '../rs-sdk/sdk/pathfinding';
import { executionContext, abortable } from '../rs-sdk/sdk/execution-context';
import { SKILLS } from './skills';

const NAME = 'rascaltest';
const GAME_URL = 'http://localhost:8888';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Each case: materials to give first, the skill, its target, and how long one pass may run. */
const CASES: { skill: string; give?: [string, number][]; target?: string; seconds?: number }[] = [
    { skill: 'pickpocket', give: [['shrimp', 6]], seconds: 60 },
    { skill: "cook", give: [["raw_shrimp", 21]] },
    { skill: 'firemake', give: [['tinderbox', 1], ['logs', 3]] },
    { skill: 'fletch', give: [['logs', 2]], target: 'arrow shaft' },
    { skill: 'smelt', give: [['copper_ore', 3], ['tin_ore', 3]], target: 'bronze' },
    { skill: 'smith', give: [['hammer', 1]], target: 'bronze dagger' },
    { skill: 'sell_to_shop', give: [['logs', 3]] },
    { skill: 'sell_to_shop', target: 'bronze dagger' },
    { skill: 'buy_tools', target: 'hammer' },
    { skill: 'buy', give: [['coins', 300]], target: 'iron sword', seconds: 150 },
    { skill: 'equip', target: 'iron sword' },
    { skill: 'buy', target: 'bronze chainbody', seconds: 120 },
    { skill: 'equip', target: 'bronze chainbody' },
    { skill: 'sell_to_shop', give: [['bronze_dagger', 2]], target: 'bronze dagger', seconds: 120 },
    { skill: 'fight', target: 'unicorn', seconds: 120 },
    { skill: 'fight', give: [['shrimps', 15]], target: 'barbarian', seconds: 180 }
];

function password(): string {
    const file = join(import.meta.dir, 'accounts.json');
    const accounts: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : {};
    if (!accounts[NAME]) {
        accounts[NAME] = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
        writeFileSync(file, JSON.stringify(accounts, null, 4) + '\n', { mode: 0o600 });
    }
    return accounts[NAME];
}

// "@Varrock east bank" walks there first, to test a skill from where a character really is.
const args = process.argv.slice(2);
const start = args.find(a => a.startsWith('@'))?.slice(1);
// "fight=chicken" runs one skill with that target instead of the listed cases.
// '%{"target":"lowest_hp"}' sets fight tactics for the run, as a character's card would.
const tacticsArg = args.find(a => a.startsWith('%'));
const tactics = tacticsArg ? JSON.parse(tacticsArg.slice(1)) : undefined;
// "+coins:20" gives materials before the ad-hoc cases.
const extra = args.filter(a => a.startsWith('+')).map(a => [a.slice(1).split(':')[0], +(a.split(':')[1] ?? 1)] as [string, number]);
const adhoc = args.filter(a => a.includes('=') && !a.startsWith('::')).map((a, i) => ({ skill: a.split('=')[0], target: a.slice(a.indexOf('=') + 1), seconds: 150, give: i ? [] : extra }));
const only = args.filter(a => !a.startsWith('@') && !a.startsWith('+') && !a.startsWith('::') && !a.startsWith('%') && !a.includes('='));
const listed = only.length ? CASES.filter(c => only.includes(c.skill)) : adhoc.length ? [] : CASES;
const cases = [...(start ? [{ skill: 'travel', target: start, seconds: 180 }] : []), ...adhoc, ...listed];

initPathfinding();
const puppeteer: any = (await import(join(import.meta.dir, '..', 'rs-sdk', 'node_modules', 'puppeteer'))).default;
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--mute-audio', '--disable-background-timer-throttling'] });
const page = await browser.newPage();
const pw = password();
await page.goto(`${GAME_URL}/bot?bot=${NAME}&password=${pw}`);
const sdk = new BotSDK({ botUsername: NAME, password: pw, gatewayUrl: 'ws://localhost:7780', connectionMode: 'control', autoReconnect: true, autoLaunchBrowser: false, showChat: false });
const bot = new BotActions(sdk);
await sdk.connect();
// The gateway can hand over the previous session's cached state first: wait for a fresh frame
// from this run's client before trusting anything (or sending commands, which would be dropped).
const fresh = () => !!sdk.getState()?.inGame && sdk.getState()!.skills.length > 0 && sdk.getStateAge() < 2000;
for (let i = 0; i < 90 && !fresh(); i++) await sleep(1000);
if ((sdk.getState()?.player?.worldZ ?? 0) < 3150) await bot.skipTutorial();
await sleep(2000);

// Start from an empty pack so leftovers from earlier runs cannot fill it (gives into a full
// pack silently fail).
for (const item of [...sdk.getInventory()].reverse()) {
    await sdk.sendDropItem(item.slot);
    await sleep(400);
}
await sleep(1000);
console.log(`pack cleared (${sdk.getInventory().length} left)`);

// Is ::give allowed for this account? Staff level is read at login, and a login within ~100s
// of the last run reattaches to that session, so after granting it wait two minutes first.
const probe = sdk.countInventoryItems(/^tinderbox$/i);
await sdk.say('::give tinderbox');
await sleep(5000);
if (sdk.countInventoryItems(/^tinderbox$/i) <= probe) {
    console.log(`\n${NAME} cannot use ::give yet. Grant staff level 3 once, then rerun:\n  docker exec rs-sdk sqlite3 /opt/server/data/db.sqlite "update account set staffmodlevel = 3 where username = '${NAME}';"\n`);
    await browser.close();
    process.exit(1);
}

// "::addxp smithing 14000" style arguments run as admin commands first (e.g. to reach a level).
for (const cmd of args.filter(a => a.startsWith('::'))) {
    await sdk.say(cmd);
    await sleep(2000);
}
if (args.some(a => a.startsWith('::'))) console.log(`levels: ${sdk.getState()!.skills.filter(k => k.baseLevel > 1).map(k => `${k.name} ${k.baseLevel}`).join(', ')}`);

const xp = () => new Map(sdk.getState()!.skills.map(s => [s.name, s.experience]));
const inv = () => {
    const m = new Map<string, number>();
    for (const i of sdk.getInventory()) m.set(i.name, (m.get(i.name) ?? 0) + i.count);
    return m;
};

let failures = 0;
for (const t of cases) {
    // The server takes one command per tick: space them out.
    for (const [item, n] of t.give ?? []) {
        await sdk.say(`::give ${item} ${n}`);
        await sleep(1200);
    }
    await sleep(1500);
    const def = SKILLS[t.skill];
    const args = { target: t.target ?? null };
    const blocked = def.requires?.(sdk.getState()!, args);
    if (blocked) {
        console.log(`✗ ${t.skill}: blocked before starting (${blocked})`);
        failures++;
        continue;
    }
    const xp0 = xp();
    const inv0 = inv();
    const notes: string[] = [];
    const controller = new AbortController();
    const deadline = Date.now() + (t.seconds ?? 90) * 1000;
    const started = Date.now();
    let result: string | void = undefined;
    try {
        result = await executionContext.run({ signal: controller.signal }, () =>
            abortable(def.run({ bot, sdk, name: NAME, deadline, signal: controller.signal, tactics, notes }, args))
        );
    } catch (e: any) {
        result = `threw: ${e?.message ?? e}`;
    }
    const gainedXp = sdk.getState()!.skills.filter(s => s.experience > (xp0.get(s.name) ?? 0)).map(s => `+${s.experience - (xp0.get(s.name) ?? 0)} ${s.name}`);
    const changes: string[] = [];
    for (const [n, c] of inv()) if (c !== (inv0.get(n) ?? 0)) changes.push(`${c - (inv0.get(n) ?? 0) > 0 ? '+' : ''}${c - (inv0.get(n) ?? 0)} ${n}`);
    for (const [n, c] of inv0) if (!inv().has(n)) changes.push(`-${c} ${n}`);
    const ok = !result && (gainedXp.length > 0 || changes.length > 0 || t.skill === 'travel');
    if (!ok) failures++;
    const at = sdk.getState()?.player;
    for (const note of notes) console.log(`  ${note}`);
    console.log(`${ok ? '✓' : '✗'} ${t.skill} (${Math.round((Date.now() - started) / 1000)}s, at ${at?.worldX}, ${at?.worldZ}): ${[...gainedXp, ...changes].join(', ') || 'no change'}${result ? ` | stopped: ${result}` : ''}`);
}

await browser.close();
process.exit(failures ? 1 : 0);
