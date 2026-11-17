// Pure feasibility memory: no event, store, SDK or game imports with runtime side effects.
import { cleanLookupText } from './lookup-text';

export interface OptionStep {
    action: string;
    args: { target?: string | null; amount?: number | null };
}
export interface OptionFacts {
    inventory: { name: string; count: number }[];
    equipment?: { name: string; count: number }[];
    skills: { name: string; baseLevel: number }[];
    bank?: { t: number; items: Record<string, number> };
}
export interface BlockedOption {
    action: string;
    target: string;
    amount?: number | null;
    source: 'own-bank' | 'materials' | 'levels' | 'coins' | 'recipe';
    dependency: string;
    reason: string;
    fingerprint: string;
    materialMatch?: { pattern: string; flags: string; skill?: string };
    observedAt: number;
    expiresAt: number;
}
export const BLOCK_OPTION_MS = 15 * 60_000;
const MAX_OPTIONS = 24;
const norm = (s: string) => cleanLookupText(s).toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Same cooked/noted and substring naming rules as readiness withdrawal checks.
const pattern = (target: string) => {
    const named = norm(target)
        .replace(/^(.*?)\s*\(cooked\)\s*$/, 'cooked $1')
        .replace(/\bnoted?\b/g, '')
        .trim();
    const cooked = /^cooked\s+/.test(named);
    const plain = escape(named.replace(/^cooked\s+/, '').replace(/s$/, ''));
    return new RegExp(cooked ? `^${plain}s?$` : plain, 'i');
};
const stock = (items: { name: string; count: number }[], name: string) =>
    items.filter((i) => pattern(name).test(cleanLookupText(i.name))).reduce((n, i) => n + i.count, 0);
const fingerprint = (option: BlockedOption, facts: OptionFacts) => {
    if (option.source === 'recipe') return JSON.stringify([option.action, option.target]);
    if (option.source === 'levels')
        return JSON.stringify(
            option.dependency.split('|').map((name) => [name, facts.skills.find((s) => norm(s.name) === name)?.baseLevel ?? 1]),
        );
    const name = option.source === 'coins' ? 'coins' : option.dependency;
    const count = (items: { name: string; count: number }[]) =>
        option.materialMatch
            ? items
                  .filter((i) => new RegExp(option.materialMatch!.pattern, option.materialMatch!.flags).test(i.name))
                  .reduce((sum, i) => sum + i.count, 0)
            : stock(items, name);
    return JSON.stringify([
        count(facts.inventory),
        count(facts.equipment ?? []),
        count(Object.entries(facts.bank?.items ?? {}).map(([name, count]) => ({ name, count }))),
        option.materialMatch?.skill ? facts.skills.find((s) => s.name === option.materialMatch!.skill)?.baseLevel : undefined,
    ]);
};
const matches = (option: BlockedOption, step: OptionStep) =>
    option.action === step.action &&
    option.target === norm(step.args.target ?? '') &&
    (option.source !== 'coins' || option.amount === (step.args.amount ?? null));

/** Only remember deterministic constraints; transient shop/route/combat failures keep their own recovery. */
export function rememberBlockedOption(
    options: BlockedOption[],
    step: OptionStep,
    reason: string,
    facts: OptionFacts,
    now = Date.now(),
    materialMatch?: { pattern: string; flags: string; skill?: string },
): boolean {
    let source: BlockedOption['source'];
    let dependency: string;
    const material = reason.match(
        /^(?:preparation: )?needs \d+ (.+?); not enough usable stock in your own bank and no automatic purchase available$/i,
    );
    const levels = [...reason.matchAll(/([a-z]+) \d+ \(you are \d+\)/gi)].map((m) => norm(m[1]));
    if (/^unknown (?:smithing|crafting|fletching) recipe\b/i.test(reason)) {
        source = 'recipe';
        dependency = norm(step.args.target ?? '');
    } else if (step.action === 'withdraw_from_bank' && /^(?:preparation: )?your known bank has no /i.test(reason)) {
        source = 'own-bank';
        dependency = norm(step.args.target ?? '');
        if (!dependency) return false;
    } else if (material) {
        source = 'materials';
        dependency = norm(material[1]);
    } else if (levels.length) {
        source = 'levels';
        dependency = [...new Set(levels)].sort().join('|');
    } else if (
        /^(?:preparation: )?preparation costs \d+ coins; carried and banked coins are insufficient$|^purchases exceed carried and banked coins by \d+$/i.test(
            reason,
        )
    ) {
        source = 'coins';
        dependency = 'coins';
    } else return false;
    pruneBlockedOptions(options, facts, now);
    const option: BlockedOption = {
        action: step.action,
        target: norm(step.args.target ?? ''),
        amount: step.args.amount ?? null,
        source,
        dependency,
        reason,
        ...(source === 'materials' && materialMatch ? { materialMatch } : {}),
        fingerprint: '',
        observedAt: now,
        expiresAt: now + BLOCK_OPTION_MS,
    };
    option.fingerprint = fingerprint(option, facts);
    // Suppressed attempts never extend an observation's lifetime.
    if (options.some((o) => matches(o, step) && o.source === source && o.dependency === dependency)) return false;
    options.push(option);
    if (options.length > MAX_OPTIONS) options.splice(0, options.length - MAX_OPTIONS);
    return true;
}

export function pruneBlockedOptions(options: BlockedOption[], facts: OptionFacts, now = Date.now()): void {
    const valid = options.filter((o) => o.expiresAt > now && o.fingerprint === fingerprint(o, facts));
    options.splice(0, options.length, ...valid);
}
export function blockedOption(options: BlockedOption[], step: OptionStep, facts: OptionFacts, now = Date.now()): BlockedOption | undefined {
    pruneBlockedOptions(options, facts, now);
    return options.find((o) => matches(o, step));
}
export function renderBlockedOptions(options: BlockedOption[], facts: OptionFacts, now = Date.now()): string {
    pruneBlockedOptions(options, facts, now);
    if (!options.length) return '(none)';
    return (
        options
            .map(
                (o) =>
                    `- ${o.action}${o.target ? ` (${o.target})` : ''} [${o.source}]: ${o.reason}. Reconsider after relevant facts change or in ${Math.max(1, Math.ceil((o.expiresAt - now) / 60_000))} min.`,
            )
            .join('\n') +
        '\nDo not repeat these options unchanged. Choose stock you actually own, buy an affordable alternative, arrange a delivery, verify changed stock, train the missing level, or do independent feasible work. Earlier acquisition/training steps may make a later step possible; code checks again when that step starts.'
    );
}
