import type { BotWorldState } from '../rs-sdk/sdk/types';
import type { BankView } from './banks';
import { equipmentBlocker, SMITHING_METALS } from './game-requirements';
import { ORE_PAIRS, partnerNeed } from './smelting';

/** Small factual comparison for the character's own workshop choices. */
export function smithingNotes(s: BotWorldState, bank?: BankView, now = Date.now()): string {
    const level = s.skills.find(k => k.name === 'Smithing')?.baseLevel ?? 1;
    if (level < 15 || !bank) return '';
    const count = (pattern: RegExp) => Object.entries(bank.items)
        .filter(([name]) => pattern.test(name)).reduce((n, [, v]) => n + v, 0);
    const options = SMITHING_METALS.filter(m => m.level <= level).map(m => {
        const metal = m.metal === 'adamantite' ? 'adamant' : m.metal === 'runite' ? 'rune' : m.metal;
        const [main, partner] = ORE_PAIRS[metal];
        const mainNeed = metal === 'steel' ? 2 : 1;
        const partnerCount = partner ? partnerNeed(metal) : 0;
        const available = Math.floor(Math.min(count(main) / mainNeed, partner ? count(partner) / partnerCount : Infinity));
        const stocked = count(new RegExp(`^${m.bar}$`, 'i'));
        const inputs = `${mainNeed} ${main.source.replace(/[\^$]/g, '')}${partner ? ` + ${partnerCount} ${partner.source.replace(/[\^$]/g, '')}` : ''}`;
        return { ...m, available, stocked, inputs, batch: Math.min(available, Math.floor(21 / (mainNeed + partnerCount))) };
    }).filter(m => m.available > 0 || m.stocked > 0).sort((a,b) => b.xpPerBar - a.xpPerBar).slice(0,3);
    if (!options.length) return '';
    const lines = options.map(m => `- ${m.metal}: ${m.xpPerBar} base Smithing XP/bar; ${m.stocked} banked bar${m.stocked === 1 ? '' : 's'}; own bank has inputs for ${m.available} more (${m.inputs} per bar${m.metal === 'iron' ? '; iron smelting can fail' : ''}).${m.batch ? ` Example ore batch: ${m.batch} bars worth of inputs, smelt until exhausted, then smith until exhausted and bank outputs; repeat while own inputs last. This reserves 7 slots for food/tools/other items; reduce for a fuller pack. ${m.metal === 'iron' ? 'Iron output is uncertain.' : ''}` : ''}`);
    const next = SMITHING_METALS.find(m => m.level > level);
    return `WORKSHOP NOTES (your bank observation, ${Math.max(0, Math.round((now-bank.t)/60_000))} min old)
${lines.join('\n')}
These ore supplies support a smelt → smith chain even when the bank has no finished bars. Counts are supply totals; work in inventory-sized batches. Banking after each single item adds repeated travel. Within a metal, XP is paid per bar consumed, so multi-bar pieces give more XP per item.${next ? ` Next metal unlock: ${next.metal} at Smithing ${next.level} (${next.xpPerBar} base XP/bar, starting with daggers; other pieces can need higher levels).` : ''}
XP per bar is a comparison, not a measured XP/hour rate.`;
}

/** Optional, game-feasible avenues; never replace the agreed mission or a character's outfit. */
export function opportunityNotes(s: BotWorldState, bank?: BankView): string {
    const held = [...s.inventory, ...Object.entries(bank?.items ?? {}).map(([name, count]) => ({ name, count }))];
    const worn = new Set(s.equipment.map(i => i.name.toLowerCase()));
    const gear = [...new Set(held.filter(i => i.count > 0 && /^adamant (dagger|sword|longsword|mace|scimitar|med helm|full helm|chainbody|platebody|platelegs|plateskirt|sq shield|kiteshield)$/i.test(i.name)
        && !worn.has(i.name.toLowerCase()) && !equipmentBlocker(s, i.name)).map(i => i.name))];
    const lines: string[] = [];
    if (gear.length) lines.push(`Owned wearable adamant options: ${gear.join(', ')}. Consider a useful upgrade at a safe break if it suits your look; keep stronger gear and your individuality. Bank stock is last observed, not guaranteed current.`);
    const fresh = ['Firemaking', 'Fletching'].filter(name => (s.skills.find(k => k.name === name)?.baseLevel ?? 99) < 20);
    if (fresh.length) lines.push(`For variety when compatible with your mission: ${fresh.join(' or ')} toward the next workshop mark, then 20. Use normal logs: firemake with a tinderbox, or fletch arrow shafts at Fletching 1 / shortbows at 5 with a knife. Gather/withdraw logs in bounded batches; check your own tools, funding and supplies first.`);
    return lines.length ? `OPTIONAL OPPORTUNITIES\n${lines.join('\n')}` : '';
}
