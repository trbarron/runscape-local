// Live test of a bank-note hand-over between two test characters: the giver withdraws a stack
// as notes, trades it in one slot, and the receiver deposits it back into ordinary items. The
// same calls the party's give and bank steps make, on accounts outside the party.
//
//   bun agents/test-trade.ts [count]
//
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { BotSDK } from '../rs-sdk/sdk/index';
import { BotActions } from '../rs-sdk/sdk/actions';
import { initPathfinding } from '../rs-sdk/sdk/pathfinding';
import { SKILLS, type Ctx } from './skills';

const GIVER = 'rascaltest';
const RECEIVER = 'rascaltest2';
const GAME_URL = 'http://localhost:8888';
const BANK = { x: 3253, z: 3420 }; // Varrock east bank
const COUNT = +(process.argv[2] ?? 20);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function password(name: string): string {
    const file = join(import.meta.dir, 'accounts.json');
    const accounts: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : {};
    if (!accounts[name]) {
        accounts[name] = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
        writeFileSync(file, JSON.stringify(accounts, null, 4) + '\n', { mode: 0o600 });
    }
    return accounts[name];
}

initPathfinding();
const puppeteer: any = (await import(join(import.meta.dir, '..', 'rs-sdk', 'node_modules', 'puppeteer'))).default;
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--mute-audio', '--disable-background-timer-throttling'] });

async function login(name: string) {
    const pw = password(name);
    const page = await browser.newPage();
    await page.goto(`${GAME_URL}/bot?bot=${name}&password=${pw}`);
    const sdk = new BotSDK({ botUsername: name, password: pw, gatewayUrl: 'ws://localhost:7780', connectionMode: 'control', autoReconnect: true, autoLaunchBrowser: false, showChat: false });
    const bot = new BotActions(sdk);
    await sdk.connect();
    for (let i = 0; i < 90 && !(sdk.getState()?.inGame && sdk.getStateAge() < 2000); i++) await sleep(1000);
    if ((sdk.getState()?.player?.worldZ ?? 0) < 3150) await bot.skipTutorial();
    await sleep(2000);
    const ctx: Ctx = { bot, sdk, name, deadline: Date.now() + 600_000, signal: new AbortController().signal };
    return { sdk, bot, ctx };
}

const step = async (who: { ctx: Ctx }, action: string, target: string | null) => {
    const r = await SKILLS[action].run(who.ctx, { target, amount: null } as any);
    console.log(`${who.ctx.name}: ${action} ${target ?? ''} -> ${r ?? 'ok'}`);
};
const count = (sdk: BotSDK, re: RegExp) => sdk.getInventory().filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);

const giver = await login(GIVER);
const receiver = await login(RECEIVER);
console.log('both logged in');

// Stock the giver's bank with plain cooked shrimp, then take them out as notes.
await giver.sdk.say(`::give shrimp ${Math.min(COUNT, 27)}`);
await sleep(3000);
await Promise.all([giver.bot.walkTo(BANK.x, BANK.z, 3), receiver.bot.walkTo(BANK.x + 1, BANK.z, 3)]);
await step(giver, 'bank_resources', 'Shrimps');
await step(receiver, 'bank_resources', null).catch(() => {});
const banked = Number((giver.sdk.getBankItems?.() ?? []).find((i: any) => /^shrimps$/i.test(i.name))?.count ?? 0);
await step(giver, 'withdraw_from_bank', 'cooked shrimps noted');
const notes = giver.sdk.getInventory().filter(i => /^shrimps$/i.test(i.name));
console.log(`giver pack: ${notes.map(i => `${i.count} in slot ${i.slot}`).join(', ')} (bank had ${banked})`);

// One trade for the whole stack.
const before = count(receiver.sdk, /^shrimps$/i);
const total = count(giver.sdk, /^shrimps$/i);
const [given, served] = await Promise.all([
    giver.bot.trade(RECEIVER, { give: [{ item: /^shrimps?$/i, amount: total }], requestTimeout: 30_000, timeout: 45_000 }),
    receiver.bot.serveTrades({ from: new RegExp(`^${GIVER}$`, 'i'), maxTrades: 1, timeout: 60_000 })
]);
await sleep(2000);
const got = receiver.sdk.getInventory().filter(i => /^shrimps$/i.test(i.name));
console.log(`trade: giver ${given.success ? 'ok' : given.message}; receiver ${served.message}; receiver pack: ${got.map(i => `${i.count} in one slot`).join(', ') || 'none'} (+${count(receiver.sdk, /^shrimps$/i) - before})`);

// The receiver deposits the notes: they become ordinary Shrimps in the receiver's bank.
await step(receiver, 'bank_resources', 'Shrimps');
await receiver.bot.openBank();
await sleep(1000);
const inBank = (receiver.sdk.getBankItems() ?? []).find((i: any) => /^shrimps$/i.test(i.name));
await receiver.bot.closeBank();
console.log(`receiver bank: ${inBank ? `${inBank.count} Shrimps` : 'no Shrimps'}`);
const ok = given.success && got.length === 1 && (inBank?.count ?? 0) >= total;
console.log(ok ? `PASS: ${total} moved in one slot and deposited` : 'FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
