/**
 * Tempo rules for the Pulse and Resolve rulesets (docs/duel-engagement-options.md §D):
 * an 8-second reaction window after the telegraph appears, and a quick cast
 * (+1 magnitude, applied by the resolver) for committing within 5 seconds.
 * Pure so the thresholds are unit-tested; main.ts owns the clock.
 */
export const REACTION_WINDOW_MS = 8000;
export const QUICK_CAST_MS = 5000;
/** The last stretch of the reaction window: the card edge pulses and a tick rises (ideas doc §E). */
export const URGENT_MS = 3000;

export type TimerState = {
    /** The reaction window has closed: whatever is selected is final. */
    reactionLocked: boolean;
    /** Committing now counts as a quick cast. */
    quickCast: boolean;
    /** Inside the last URGENT_MS of an open reaction window. */
    urgent: boolean;
    reactionRemainingMs: number;
    quickRemainingMs: number;
};

export function timerState(elapsedMs: number, enabled = true): TimerState {
    if (!enabled) return { reactionLocked: false, quickCast: false, urgent: false, reactionRemainingMs: 0, quickRemainingMs: 0 };
    const reactionRemainingMs = Math.max(0, REACTION_WINDOW_MS - elapsedMs);
    const quickRemainingMs = Math.max(0, QUICK_CAST_MS - elapsedMs);
    return {
        reactionLocked: reactionRemainingMs === 0,
        quickCast: quickRemainingMs > 0,
        urgent: reactionRemainingMs > 0 && reactionRemainingMs <= URGENT_MS,
        reactionRemainingMs,
        quickRemainingMs
    };
}
