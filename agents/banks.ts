// What each character has in the bank, as last seen with the bank open. The game only shows a
// bank's contents while it is open, so this is the freshest honest view between visits.
import type { BotSDK } from '../rs-sdk/sdk/index';
import { load, save } from './store';

export interface BankView {
    t: number;
    items: Record<string, number>;
}

const banks = load<Record<string, BankView>>('banks', {});

/** Call while the bank is open. */
export function noteBank(bot: string, sdk: BotSDK): void {
    const b = sdk.getState()?.bank;
    if (!b?.isOpen) return;
    const items: Record<string, number> = {};
    for (const i of b.items) items[i.name] = (items[i.name] ?? 0) + i.count;
    banks[bot] = { t: Date.now(), items };
    save('banks', banks);
}

export const bankOf = (bot: string): BankView | undefined => banks[bot];
