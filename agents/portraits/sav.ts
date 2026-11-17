// Reads what a portrait needs from a character's save file (data/players/main/<name>.sav): the
// engine's own format (rs-sdk/server/engine/src/engine/entity/PlayerLoading.ts), version 7 and up.
import { readFileSync } from 'fs';
import { join } from 'path';

const SAVES = join(import.meta.dir, '..', '..', 'data', 'players', 'main');
/** The worn inventory's id in rs-sdk/server/content/pack/inv.pack. */
const WORN_INV = 94;

export interface Look {
    gender: number;
    body: number[];
    colors: number[];
    /** Worn object ids by wear slot. */
    worn: Record<number, number>;
}

class Reader {
    pos = 0;
    constructor(readonly b: Buffer) {}
    g1 = () => this.b[this.pos++];
    g2 = () => ((this.b[this.pos++] << 8) | this.b[this.pos++]) >>> 0;
    g4 = () => {
        const v = this.b.readInt32BE(this.pos);
        this.pos += 4;
        return v;
    };
    varInt = () => {
        let byte = this.g1();
        let result = 0;
        while (byte & 0x80) {
            result = (result | (byte & 0x7f)) << 7;
            byte = this.g1();
        }
        return (result | byte) >>> 0;
    };
}

export function readLook(name: string): Look {
    const r = new Reader(readFileSync(join(SAVES, `${name}.sav`)));
    if (r.g2() !== 0x2004) throw new Error(`${name}.sav: not a save file`);
    const version = r.g2();
    if (version < 7) throw new Error(`${name}.sav: save version ${version} is older than this reader supports`);
    r.pos = 9; // x, z and level
    const body = Array.from({ length: 7 }, r.g1);
    const colors = Array.from({ length: 5 }, r.g1);
    const gender = r.g1();
    r.g2(); // run energy
    r.g4(); // play time
    for (let i = 0; i < 21; i++) {
        r.g4(); // xp
        r.g1(); // current level
    }
    const varps = r.g2();
    for (let i = 0; i < varps; i++) {
        r.g2();
        r.varInt();
    }
    const worn: Record<number, number> = {};
    const inventories = r.g1();
    for (let i = 0; i < inventories; i++) {
        const type = r.g2();
        const size = r.g2();
        for (let slot = 0; slot < size; slot++) {
            const id = r.g2() - 1;
            if (id === -1) continue;
            if (r.g1() === 255) r.g4();
            if (type === WORN_INV) worn[slot] = id;
        }
    }
    return { gender, body, colors, worn };
}
