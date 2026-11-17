// Renders the entire surface map, including the wilderness, from the game server's own world map viewer (/mapview,
// drawn from the cache's worldmap data) as one grey image for the website's map, with the
// world bounds it covers, so markers can be laid over it on game coordinates.
//
//   bun agents/map/render-basemap.ts [out.webp]
//
import { join } from 'path';
import { writeFileSync } from 'fs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:8888';
// Surface band and map columns from MapView.MAP_BANDS (rows 42–62, columns 29–56).
// Other bands are remapped underground areas and are not surface world coordinates.
export const BOUNDS = { x0: 1856, x1: 3648, z0: 2688, z1: 4032 };
const PX = 2; // pixels per tile (the viewer's zoom is twice this)
const W = (BOUNDS.x1 - BOUNDS.x0) * PX;
const H = (BOUNDS.z1 - BOUNDS.z0) * PX;
// The viewer draws zoom buttons along its bottom edge: render taller and crop them off.
const CANVAS_H = H + 64;

const out = process.argv[2] ?? join(import.meta.dir, 'world-map.webp');
const puppeteer: any = (await import(join(import.meta.dir, '..', '..', 'rs-sdk', 'node_modules', 'puppeteer'))).default;
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: CANVAS_H });
await page.goto(`${GAME_URL}/mapview`, { waitUntil: 'networkidle0' });

// Wait for the viewer to load its map data, then aim it: map x = world x - originX, and map
// rows run north to south from originZ + mapHeight.
const view = await page.evaluate(
    async (b: typeof BOUNDS, px: number) => {
        const { MapView } = await import('/client/mapview.js');
        MapView.shouldDrawPlayers = false;
        MapView.shouldDrawHistory = false;
        const mv: any = await new Promise(resolve => {
            const proto = MapView.prototype as any;
            const original = proto.mainredraw;
            proto.mainredraw = function (this: any) {
                (window as any).mv = this;
                resolve(this);
                return original.call(this);
            };
        });
        for (let i = 0; i < 100 && !mv.mapHeight; i++) await new Promise(r => setTimeout(r, 100));
        mv.zoom = mv.targetZoom = px * 2;
        mv.focusX = b.x0 - mv.mapOriginX + ((mv.sWid / mv.zoom) | 0);
        mv.focusZ = mv.mapOriginZ + mv.mapHeight - b.z1 + ((mv.sHei / mv.zoom) | 0);
        mv.showKey = mv.showOverview = false;
        mv.redraw = true;
        return { sWid: mv.sWid, sHei: mv.sHei, zoom: mv.zoom };
    },
    BOUNDS,
    PX
);
if (view.sWid !== W) throw new Error(`viewer is ${view.sWid} wide, expected ${W}`);
await new Promise(r => setTimeout(r, 3000));
// A clipped screenshot resizes the page, which clears the viewer's canvas: take it whole and crop.
const png = await page.screenshot({ encoding: 'base64' });

// Grey and lightened, so black and grey markers drawn over it stay the strongest thing.
const webp: string = await page.evaluate(async (src: string, w: number, h: number) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
        const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
        // Water (blue over red and green) becomes paper; land keeps its detail in light greys.
        const water = b > r + 25 && b > g + 12;
        const v = water ? 250 : Math.round(150 + (0.3 * r + 0.59 * g + 0.11 * b) * (90 / 255));
        px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(data, 0, 0);
    return c.toDataURL('image/webp', 0.82).split(',')[1];
}, png, W, H);
writeFileSync(out, Buffer.from(webp, 'base64'));
writeFileSync(out.replace(/\.webp$/, '.json'), JSON.stringify({ ...BOUNDS, pxPerTile: PX, width: W, height: H }, null, 2) + '\n');
console.log(`${out}: ${W}x${H}, ${Math.round(Buffer.from(webp, 'base64').length / 1024)} KB, world x ${BOUNDS.x0}-${BOUNDS.x1}, z ${BOUNDS.z0}-${BOUNDS.z1}`);
await browser.close();
