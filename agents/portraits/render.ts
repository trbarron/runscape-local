// Renders each character's head and full body from their save file (kits, colours and worn items)
// using the game client's own model code, so the website can show who is who.
//
//   bun agents/portraits/render.ts [--out <dir>] [--bots bram,wren] [--force]
//
// It builds a copy of the client with a render hook (build.ts), loads the game's title screen in a
// headless browser with that copy swapped in, and calls the hook once per image. Nothing logs in, so
// the party never sees it, and the live game and its clients are untouched. A character is only
// re-rendered when their look changed since the last run (or with --force).
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { BUNDLE, build } from './build';
import { ANGLES, angleFile, readManifest, saveManifest, needsPortrait } from './manifest';
import { hiddenBy } from './objs';
import { readLook, type Look } from './sav';

const RS = join(import.meta.dir, '..', '..', 'rs-sdk');
const GAME_URL = process.env.GAME_URL ?? 'http://localhost:8888';
const BOTS = ['bram', 'wren', 'mike', 'trish'];

const flag = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i < 0 ? undefined : (process.argv[i + 1] ?? '');
};
const OUT = (flag('out') ?? join(homedir(), 'gh', 'tyler-barron-dot-com', 'tylerbarron-rr', 'public', 'images', 'runescape-rascals', 'portraits')).replace(/^~/, homedir());
/** The client's yaw runs 0-2047 for a full turn; angle 0 is the front. */
const YAW_STEP = 2048 / ANGLES;

const bots = (flag('bots') ?? BOTS.join(',')).split(',').filter(Boolean);
const force = process.argv.includes('--force');

// The cameras and crops, tuned by eye on the 256 px render. The head crop is centred on the face and
// shared by everyone so faces stay the same size; the body crop keeps the figures' heights comparable.
const HEAD = { head: true, yaw: 0, xan: 20, zoom: 500, dy: -30, crop: { x: 18, y: -22, w: 220, h: 220 }, out: { w: 128, h: 128 } };
const BODY = { head: false, yaw: 0, xan: 15, zoom: 640, dy: 95, crop: { x: 96, y: 40, w: 63, h: 177 }, out: { w: 63, h: 177 } };

function spec(look: Look) {
    const worn: Record<string, number> = {};
    const hide = new Set<number>();
    for (const [slot, id] of Object.entries(look.worn)) {
        if (+slot > 11) continue; // rings and arrows are not drawn
        worn[slot] = id;
        for (const h of hiddenBy(id)) hide.add(h);
    }
    return { gender: look.gender, body: look.body, colors: look.colors, worn, hide: [...hide] };
}

const manifest = readManifest(OUT);
mkdirSync(OUT, { recursive: true });
const todo = bots
    .map(name => ({ name, s: spec(readLook(name)) }))
    .map(b => ({ ...b, hash: createHash('sha1').update(JSON.stringify({ ...b.s, angles: ANGLES })).digest('hex') }))
    .filter(b => force || needsPortrait(b.name, b.hash, manifest, OUT));

if (todo.length === 0) {
    console.log('portraits are up to date');
    process.exit(0);
}

await build();
const puppeteer: any = (await import(join(RS, 'node_modules', 'puppeteer'))).default;
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--mute-audio'] });
try {
    const page = await browser.newPage();
    const client = readFileSync(BUNDLE);
    await page.setRequestInterception(true);
    page.on('request', (r: any) => (/\/bot\/client\.js/.test(r.url()) ? r.respond({ status: 200, contentType: 'text/javascript', body: client }) : r.continue()));
    await page.goto(`${GAME_URL}/bot`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).renderPortrait && (window as any).gameClient, { timeout: 60_000 });
    await new Promise(r => setTimeout(r, 15_000)); // the title screen finishes loading the game's cache
    for (const { name, s, hash } of todo) {
        for (const [kind, camera] of [['head', HEAD], ['body', BODY]] as const) {
            for (let angle = 0; angle < ANGLES; angle++) {
                const url: string | null = await page.evaluate((x: unknown) => (window as any).renderPortrait(x), { ...s, ...camera, yaw: Math.round(angle * YAW_STEP) });
                if (!url) throw new Error(`${name}: the ${kind} model never finished loading (angle ${angle})`);
                writeFileSync(join(OUT, angleFile(name, kind, angle)), Buffer.from(url.split(',')[1], 'base64'));
            }
        }
        manifest[name] = { version: hash, renderedAt: Date.now(), angles: ANGLES };
        console.log(`${name}: rendered${Object.keys(s.worn).length ? ` (wearing ${Object.keys(s.worn).length} item${Object.keys(s.worn).length > 1 ? 's' : ''})` : ''}`);
    }
    saveManifest(manifest, OUT);
} finally {
    await browser.close();
}
