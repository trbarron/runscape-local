// Which appearance slots a worn object hides (its wearpos2 and wearpos3), read from the game's
// object configs: the server leaves those kits out of a character's appearance (a full helm hides
// the hair and the beard, a platebody the arms).
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const CONTENT = join(import.meta.dir, '..', '..', 'rs-sdk', 'server', 'content');
// ObjType.getWearPosId in the engine.
const WEAR_POS: Record<string, number> = { hat: 0, back: 1, front: 2, righthand: 3, torso: 4, lefthand: 5, arms: 6, legs: 7, head: 8, hands: 9, feet: 10, jaw: 11, ring: 12, quiver: 13 };

function* objFiles(dir: string): Generator<string> {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) yield* objFiles(p);
        else if (e.name.endsWith('.obj')) yield p;
    }
}

let hides: Map<string, number[]> | null = null;
let ids: Map<number, string> | null = null;

/** The appearance slots hidden by the object with this id. */
export function hiddenBy(id: number): number[] {
    if (!ids) {
        ids = new Map();
        for (const line of readFileSync(join(CONTENT, 'pack', 'obj.pack'), 'utf-8').split('\n')) {
            const m = line.match(/^(\d+)=(.+)$/);
            if (m) ids.set(+m[1], m[2].trim());
        }
    }
    if (!hides) {
        hides = new Map();
        for (const f of objFiles(join(CONTENT, 'scripts'))) {
            let name = '';
            for (const line of readFileSync(f, 'utf-8').split('\n')) {
                const head = line.match(/^\[(.+)\]/);
                if (head) name = head[1];
                const m = line.match(/^wearpos([23])=(\w+)/);
                if (m && name && WEAR_POS[m[2]] !== undefined) hides.set(name, [...(hides.get(name) ?? []), WEAR_POS[m[2]]]);
            }
        }
    }
    return hides.get(ids.get(id) ?? '') ?? [];
}
