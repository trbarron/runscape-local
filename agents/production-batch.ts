import {isProduction,productionOutput} from './production-cycle';
import type { BotWorldState } from '../rs-sdk/sdk/types';
import { cleanLookupText } from './lookup-text';
import { heldNeed, workRequirements } from './skills';
import type { PlannedStep } from './readiness';

/** Acquiring a reusable tool inside a production pass is preparation, not output. */
export function measuredWorkProgress(action: string, gained: Map<string, number>, xp: Record<string, number>): boolean {
    return Object.values(xp).some(n => n > 0) || [...gained].some(([name, count]) => count > 0
        && (!isProduction(action) || !/^(knife|hammer|tinderbox|chisel|.+ mould|.*pickaxe|.*axe)$/i.test(name)));
}

/** Bound a withdrawal batch, preserving the downstream production goal. */
export function productionWithdrawal(s: BotWorldState, steps: PlannedStep[], index: number): number | null {
    const step = steps[index];
    if (step.action !== 'withdraw_from_bank' || !step.args.target || /\bnoted?\b/i.test(step.args.target)) return null;
    let next = index + 1;
    while (steps[next]?.action === 'withdraw_from_bank') next++;
    const work = steps[next];
    if (!work || !/^(smelt|smith|cook|craft|fletch|firemake)$/.test(work.action)) return null;
    const req = workRequirements(s, work.action, work.args);
    if (req.blocker) return null;
    const target = cleanLookupText(step.args.target).replace(/^cooked /i, '');
    const material = req.items.find(n => !n.tool && n.match.test(target));
    if (!material || material.stackable) return null;
    const reusable = /^(hammer|tinderbox|knife|chisel|.+ mould)$/i;
    const inputs = req.items.filter(n => !n.tool && !n.stackable && !reusable.test(n.name));
    const heldSlots = s.inventory.filter(i => inputs.some(n => n.match.test(i.name)) && i.count === 1).length;
    const missingTools = req.items.filter(n => (n.tool || reusable.test(n.name)) && !heldNeed(s, n)).length;
    const slots = Math.max(0, 28 - s.inventory.length + heldSlots - missingTools);
    const perUnit = inputs.reduce((n, input) => n + input.count, 0);
    if (!perUnit) return null;
    const units = Math.floor(slots / perUnit);
    // Zero units needs ordinary readiness to clear surplus; never convert it
    // into a successful zero-sized withdrawal.
    if (!units) return null;
    const needed = Math.max(0, units * material.count - heldNeed(s, material));
    return Math.min(step.args.amount && step.args.amount > 0 ? step.args.amount : needed, needed);
}

/** In production routines, supply shuffling alone is not a reason to run another lap. */
export function productiveLoopProgress(steps: PlannedStep[], action: string, progress: boolean): boolean {
    const work = /^(smelt|smith|cook|craft|fletch|firemake|mine|chop_trees|fish|fight|cast|pickpocket|assist|bury_bones|pick_up|use|interact)$/;
    return progress && (!steps.some(s => work.test(s.action)) || work.test(action) || action === 'give');
}
/** Broad cleanup includes only outputs this routine explicitly intends to smith. */
export function routineBankOutputs(steps: PlannedStep[]): string[] {
    return [...new Set(steps.filter(s => /^(smith|craft|fletch)$/.test(s.action)).flatMap(s => {const output=productionOutput(s.action,s.args.target);return output?[output]:[];}))];
}
