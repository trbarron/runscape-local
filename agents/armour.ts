// Who is wearing armour, read from each character's live worn items: the standing mission milestone
// "everyone wears a helmet, body armour and leg armour" is checked against this, not by vote.
import { agents } from './party';

import { ARMOUR_SLOTS } from './armour-habit';

export interface ArmourStatus {
    /** Characters with all three pieces on. */
    armoured: string[];
    /** What each of the others still lacks. */
    missing: Record<string, string[]>;
    /** False while any character's state is not in yet, so nobody is counted as bare by mistake. */
    known: boolean;
}

export function armourStatus(): ArmourStatus {
    const armoured: string[] = [];
    const missing: Record<string, string[]> = {};
    let known = true;
    for (const [name, a] of agents) {
        const st = a.sdk.getState();
        if (!st?.inGame || !st.player?.maxHp || a.sdk.getStateAge() > 30_000) {
            known = false;
            continue;
        }
        const worn = new Set(st.equipment.map(e => e.slot));
        const lacks = ARMOUR_SLOTS.filter(([slot]) => !worn.has(slot)).map(([, label]) => label);
        if (lacks.length) missing[name] = lacks;
        else armoured.push(name);
    }
    return { armoured, missing, known };
}

/** One line for the plan: how far the party is from everyone being armoured. */
export function armourProgress(): string {
    const s = armourStatus();
    const total = s.armoured.length + Object.keys(s.missing).length;
    const lacks = Object.entries(s.missing).map(([n, l]) => `${n} lacks ${l.join(', ')}`).join('; ');
    return `${s.armoured.length} of ${total} fully armoured${lacks ? ` (${lacks})` : ''}; read from what you wear, no vote`;
}

/** Extra worn slots: back (cape), shield hand, hands and feet. */
const EXTRA_SLOTS = [1, 5, 9, 10];

export interface OutfitStatus {
    /** Characters wearing no cape, shield, gloves or boots yet. */
    plain: string[];
    /** Characters whose helmet, body and legs are the same pieces as another's. */
    twins: string[];
    known: boolean;
}

export function outfitStatus(): OutfitStatus {
    const plain: string[] = [];
    const sets = new Map<string, string[]>();
    let known = true;
    for (const [name, a] of agents) {
        const st = a.sdk.getState();
        if (!st?.inGame || !st.player?.maxHp || a.sdk.getStateAge() > 30_000) {
            known = false;
            continue;
        }
        if (!st.equipment.some(e => EXTRA_SLOTS.includes(e.slot))) plain.push(name);
        const key = [0, 4, 7].map(slot => st.equipment.find(e => e.slot === slot)?.name ?? '-').join('|');
        sets.set(key, [...(sets.get(key) ?? []), name]);
    }
    const twins = [...sets.values()].filter(n => n.length > 1).flat();
    return { plain, twins, known };
}

/** One line for the plan: who still looks plain or like a teammate. */
export function outfitProgress(): string {
    const s = outfitStatus();
    const parts = [s.plain.length ? `no cape, shield, gloves or boots yet: ${s.plain.join(', ')}` : '', s.twins.length ? `same helmet, body and legs as a teammate: ${s.twins.join(', ')}` : ''].filter(Boolean);
    return parts.join('; ') || 'everyone is distinct';
}
