// Compiled into a scratch copy of the game client (see build.ts); never imported by the agents.
// Renders a player from raw appearance data with the client's own model code and returns a PNG.
import ClientPlayer from '#/dash3d/ClientPlayer.js';
import Pix3D from '#/dash3d/Pix3D.js';
import PixMap from '#/graphics/PixMap.js';
import type Model from '#/dash3d/Model.js';

export interface Spec {
    gender: number;
    /** The save file's seven body kits: hair, jaw, torso, arms, hands, legs, feet (255 = none). */
    body: number[];
    colors: number[];
    /** Worn objects by appearance slot (0 hat, 1 cape, 2 amulet, 3 weapon, 4 torso, 5 shield, 7 legs, 9 hands, 10 feet). */
    worn: Record<string, number>;
    /** Appearance slots the worn objects hide (the server's wearpos2 and wearpos3). */
    hide: number[];
    head: boolean;
    /** Camera: yaw, pitch, distance and a vertical shift. */
    yaw: number;
    xan: number;
    zoom: number;
    dy: number;
    /** The region of the 256 x 256 render to keep, and the size to scale it to. */
    crop: { x: number; y: number; w: number; h: number };
    out: { w: number; h: number };
}

const SIZE = 256;
const KIT_SLOT = [8, 11, 4, 6, 9, 7, 10];
const STAND = 808;
const KEY = 0xff00ff;

(window as any).renderPortrait = async (s: Spec): Promise<string | null> => {
    const p = new ClientPlayer();
    p.gender = s.gender;
    p.appearance.fill(0);
    s.body.forEach((kit, i) => {
        if (kit !== 255 && kit >= 0) p.appearance[KIT_SLOT[i]] = 0x100 + kit;
    });
    for (const [slot, id] of Object.entries(s.worn)) p.appearance[+slot] = 0x200 + id;
    for (const slot of s.hide) p.appearance[slot] = 0;
    s.colors.forEach((c, i) => (p.colour[i] = c));
    p.baseId = 0n;
    for (let part = 0; part < 12; part++) {
        p.baseId <<= 4n;
        if (p.appearance[part] >= 256) p.baseId += BigInt(p.appearance[part]) - 256n;
    }
    for (let part = 0; part < 5; part++) p.baseId = (p.baseId << 3n) + BigInt(p.colour[part]);
    p.baseId = (p.baseId << 1n) + BigInt(p.gender);
    p.ready = true;
    p.secondaryAnim = STAND;
    p.secondaryAnimFrame = 0;
    p.readyanim = STAND;

    // The models download on demand: ask until they are all there.
    let model: Model | null = null;
    for (let i = 0; i < 200 && !model; i++) {
        model = s.head ? p.getHeadModel() : p.getTempModel2();
        if (!model) await new Promise(r => setTimeout(r, 100));
    }
    if (!model) return null;
    if (s.head) {
        model.calculateNormals(64, 768, -50, -10, -50, true);
        model.calcBoundingCylinder();
    }

    const pm = new PixMap(SIZE, SIZE);
    pm.setPixels();
    pm.data.fill(KEY);
    Pix3D.setRenderClipping();
    const eyeY = ((Pix3D.sinTable[s.xan] * s.zoom) >> 16) + s.dy;
    const eyeZ = (Pix3D.cosTable[s.xan] * s.zoom) >> 16;
    model.objRender(0, s.yaw, 0, s.xan, 0, eyeY, eyeZ);

    // The renderer has no alpha: the key colour becomes transparent.
    const full = document.createElement('canvas');
    full.width = full.height = SIZE;
    const ctx = full.getContext('2d')!;
    const img = ctx.createImageData(SIZE, SIZE);
    for (let i = 0; i < pm.data.length; i++) {
        const v = pm.data[i];
        const o = i * 4;
        if ((v & 0xffffff) === KEY) continue;
        img.data[o] = (v >> 16) & 255;
        img.data[o + 1] = (v >> 8) & 255;
        img.data[o + 2] = v & 255;
        img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);

    const out = document.createElement('canvas');
    out.width = s.out.w;
    out.height = s.out.h;
    const octx = out.getContext('2d')!;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(full, s.crop.x, s.crop.y, s.crop.w, s.crop.h, 0, 0, s.out.w, s.out.h);
    return out.toDataURL('image/png');
};
