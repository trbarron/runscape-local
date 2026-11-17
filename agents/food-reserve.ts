/** A few cooked fish kept in the pack so travel and production never start with nothing to eat. */
export const FOOD_RESERVE = 5;

/** Cooked fish by plain name; raw fish is "Raw ...", so the anchors exclude it. */
export const COOKED_FISH = /^(shrimps|anchovies|sardine|herring|trout|pike|salmon|tuna|lobster|swordfish)$/i;

type Stack = { name: string; count: number };

export const foodHeld = (inventory: Stack[]): number => inventory.filter(i => COOKED_FISH.test(i.name)).reduce((n, i) => n + i.count, 0);

/** What to deposit, as [name, amount] with -1 meaning all. With `keep`, the first FOOD_RESERVE cooked fish stay in the pack. */
export function depositPlan(inventory: Stack[], wanted: (name: string) => boolean, keep: boolean): { name: string; amount: number }[] {
    const totals = new Map<string, number>();
    for (const i of inventory) if (wanted(i.name)) totals.set(i.name, (totals.get(i.name) ?? 0) + i.count);
    let reserve = keep ? FOOD_RESERVE : 0;
    const plan: { name: string; amount: number }[] = [];
    for (const [name, count] of totals) {
        if (!COOKED_FISH.test(name) || !reserve) {
            plan.push({ name, amount: -1 });
            continue;
        }
        const kept = Math.min(reserve, count);
        reserve -= kept;
        if (count > kept) plan.push({ name, amount: count - kept });
    }
    return plan;
}

/** The cooked fish to top the reserve up with from an open bank: the most plentiful kind, never more than fits. */
export function reserveWithdrawal(inventory: Stack[], bank: Stack[], free: number): { name: string; amount: number } | null {
    const amount = Math.min(FOOD_RESERVE - foodHeld(inventory), free);
    if (amount <= 0) return null;
    const best = bank.filter(i => COOKED_FISH.test(i.name) && i.count > 0).sort((a, b) => b.count - a.count)[0];
    return best ? { name: best.name, amount: Math.min(amount, best.count) } : null;
}
