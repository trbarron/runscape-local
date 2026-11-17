/** A time budget is a yield point, not proof that an unfinished goal failed. */
export function stepTimeLimit(type: string, progressed: boolean): { kind: string; why: string } {
    if (type === 'minutes') return { kind: 'done', why: '' };
    return progressed
        ? { kind: 'yielded', why: 'productive 20-minute execution budget reached; target remains unfinished and work can resume' }
        : { kind: 'stuck', why: '20-minute execution budget reached with no measured work progress' };
}
/** Says why the unproductive passes were dry, when the skill recorded a reason; otherwise the stuck report is unchanged. */
export function withStallCause(stuck: { kind: string; why: string }, cause?: string): { kind: string; why: string } {
    return cause ? { ...stuck, why: `${stuck.why} (last cause: ${cause})` } : stuck;
}
export const IDLE_PASS_LIMIT = 3;
/** Count consecutive passes without measured progress; resting never counts as idle. */
export function idlePass(action: string, progressed: boolean, idlePasses: number): { idlePasses: number; stuck: { kind: string; why: string } | null } {
    if (action === 'rest' || progressed) return { idlePasses: 0, stuck: null };
    const next = idlePasses + 1;
    return { idlePasses: next, stuck: next >= IDLE_PASS_LIMIT ? { kind: 'stuck', why: 'three passes in a row with no progress' } : null };
}
