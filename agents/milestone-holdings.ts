// For each open milestone, who holds the items its text names. The party's banks are listed in full
// in PARTY FACTS, but matching a milestone's wording to four separate piles is left to whoever reads
// it, and a gap that is only a handoff (one member's bank holds what another must bank) goes unseen.
import type { Member } from './missions';
import type { Milestone } from './memory';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function milestoneHoldings(members: Member[], milestones: Milestone[]): string {
    const names = new Set<string>();
    for (const m of members) for (const n of [...Object.keys(m.carried), ...Object.keys(m.bank), ...m.worn]) names.add(n);
    const lines: string[] = [];
    for (const ms of milestones) {
        if (ms.done || ms.auto) continue; // game-checked milestones already show their own progress
        const text = `${ms.what} ${ms.needs}`.toLowerCase();
        const mentioned = [...names]
            .filter(n => n.length >= 4 && new RegExp(`\\b${escape(n)}s?\\b`).test(text))
            .sort((a, b) => b.length - a.length)
            // A longer item name already covers its parts ("steel med helm" covers "steel").
            .filter((n, i, all) => !all.slice(0, i).some(longer => longer.includes(n)));
        const rows = mentioned.map(n => {
            const per = members
                .map(m => {
                    const carried = (m.carried[n] ?? 0) + m.worn.filter(w => w === n).length;
                    const banked = m.bank[n] ?? 0;
                    return carried || banked ? `${m.name} ${[carried ? `${carried} carried or worn` : '', banked ? `${banked} banked` : ''].filter(Boolean).join(' and ')}` : '';
                })
                .filter(Boolean);
            return `${n}: ${per.join(', ') || 'nobody holds any'}`;
        });
        if (rows.length) lines.push(`M${ms.id} names ${rows.join('; ')}`);
    }
    return lines.join('\n');
}
