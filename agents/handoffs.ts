// Every completed hand-over between party members (who, to whom, what, how many, when), so a
// claim like "we moved 1,000 in one trade" can be checked against what really happened.
import { load, save } from './store';

export interface HandoffRecord {
    from: string;
    to: string;
    item: string;
    amount: number;
    t: number;
}

const log = load<HandoffRecord[]>('handoffs', []);

export function recordHandoff(r: Omit<HandoffRecord, 't'>): void {
    log.push({ ...r, t: Date.now() });
    // The 200 most recent, plus the largest ever, so a big one is not forgotten.
    const largest = [...log].sort((a, b) => b.amount - a.amount)[0];
    const kept = log.slice(-200);
    if (largest && !kept.includes(largest)) kept.unshift(largest);
    log.splice(0, log.length, ...kept);
    save('handoffs', log);
}

/** One line for the party facts: the largest single hand-overs so far. */
export function renderHandoffs(n = 3): string {
    if (!log.length) return 'Largest single hand-overs between you: none yet.';
    const ago = (t: number) => {
        const min = Math.round((Date.now() - t) / 60_000);
        return min < 120 ? `${min} min ago` : `${Math.round(min / 60)} hours ago`;
    };
    const top = [...log].sort((a, b) => b.amount - a.amount).slice(0, n);
    return `Largest single hand-overs between you (one trade each): ${top.map(h => `${h.from} gave ${h.to} ${h.amount.toLocaleString('en-US')} ${h.item} (${ago(h.t)})`).join('; ')}.`;
}

/** Every completed sale to a shop, so "earned N coins selling at X" can be checked. */
export interface SaleRecord {
    by: string;
    shop: string;
    items: string;
    coins: number;
    t: number;
}
const sales = load<SaleRecord[]>('sales', []);

export function recordSale(r: Omit<SaleRecord, 't'>): void {
    sales.push({ ...r, t: Date.now() });
    save('sales', sales.slice(-300));
}

/** One line for the party facts: coins earned per shop, all time. */
export function renderSales(): string {
    if (!sales.length) return 'Coins earned selling to shops: none recorded yet.';
    const byShop = new Map<string, number>();
    for (const s of sales) byShop.set(s.shop, (byShop.get(s.shop) ?? 0) + s.coins);
    return `Coins earned selling to shops (recorded): ${[...byShop].map(([shop, n]) => `${shop} ${n.toLocaleString('en-US')}`).join('; ')}.`;
}
