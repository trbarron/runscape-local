import { cleanLookupText } from './lookup-text';
// Standing requests between party members: "Mike wants 200 tin ore, from Bram or anyone".
// A want stays listed for everyone until it is delivered or dropped, so asking once is enough,
// and the giver delivers when it suits them. Gives count against matching wants by themselves.
import { load, save } from './store';
import { emit } from './events';

export interface Want {
    id: number;
    by: string;
    /** A teammate's name, or 'anyone'. */
    from: string;
    item: string;
    amount: number;
    delivered: number;
    why: string;
    made: number;
    status: 'open' | 'done' | 'dropped';
}

const state = load<{ next: number; wants: Want[] }>('wants', { next: 1, wants: [] });
const persist = () => {
    // Open wants plus the 20 most recently closed.
    const closed = state.wants.filter(w => w.status !== 'open').slice(-20);
    state.wants = [...state.wants.filter(w => w.status === 'open'), ...closed].sort((a, b) => a.id - b.id);
    save('wants', state);
};

const norm = (s: string) => cleanLookupText(s).toLowerCase().replace(/s$/, '');

export const openWants = () => state.wants.filter(w => w.status === 'open');

/** Adds a want, or tops up an open one for the same item and giver. */
export function addWant(by: string, w: { item: string; amount: number; from: string; why: string }): Want | null {
    const item = cleanLookupText(w.item);
    if (!item || !(w.amount > 0)) return null;
    const from = w.from?.trim().toLowerCase() || 'anyone';
    const same = openWants().find(x => x.by === by && x.from === from && norm(x.item) === norm(item));
    if (same) {
        same.amount = Math.max(same.amount, same.delivered + Math.round(w.amount));
        same.why = w.why?.trim().slice(0, 120) || same.why;
        persist();
        return same;
    }
    const want: Want = { id: state.next++, by, from, item, amount: Math.round(w.amount), delivered: 0, why: w.why?.trim().slice(0, 120) ?? '', made: Date.now(), status: 'open' };
    state.wants.push(want);
    persist();
    emit(by, 'want', { id: want.id, summary: `wants ${want.amount} ${want.item} from ${want.from}${want.why ? ` (${want.why})` : ''}` });
    return want;
}

export function dropWant(by: string, id: number): void {
    const w = state.wants.find(x => x.id === id && x.by === by && x.status === 'open');
    if (!w) return;
    w.status = 'dropped';
    persist();
    emit(by, 'want', { id, summary: `dropped want #${id} (${w.item})` });
}

/** A give from one member to another counts against the receiver's matching open wants. */
export function noteDelivery(from: string, to: string, item: string, count: number): void {
    let left = count;
    for (const w of openWants().filter(x => x.by === to && (x.from === 'anyone' || x.from === from) && (norm(item).includes(norm(x.item)) || norm(x.item).includes(norm(item))))) {
        if (left <= 0) break;
        const take = Math.min(left, w.amount - w.delivered);
        w.delivered += take;
        left -= take;
        if (w.delivered >= w.amount) {
            w.status = 'done';
            emit(to, 'want', { id: w.id, summary: `want #${w.id} filled: ${w.amount} ${w.item}, last from ${from}` });
        }
    }
    persist();
}

/** The wants a member should see: their own, and those others have put to them or to anyone. */
export function renderWants(name: string, heldBy: (item: string) => string = () => ''): string {
    const age = (t: number) => `${Math.round((Date.now() - t) / 60_000)} min ago`;
    const held = (item: string) => {
        const h = heldBy(item);
        return h ? `; held: ${h}` : '';
    };
    const mine = openWants().filter(w => w.by === name);
    const theirs = openWants().filter(w => w.by !== name && (w.from === name || w.from === 'anyone'));
    const lines = [
        ...theirs.map(w => `- #${w.id} ${w.by} wants ${w.amount - w.delivered} ${w.item} from ${w.from === name ? 'you' : 'anyone'}${w.why ? `: ${w.why}` : ''} (asked ${age(w.made)})${held(w.item)}`),
        ...mine.map(w => `- #${w.id} you want ${w.amount} ${w.item} from ${w.from}, ${w.delivered} delivered so far (asked ${age(w.made)})${held(w.item)}`)
    ];
    return lines.length ? lines.join('\n') : '(none)';
}
