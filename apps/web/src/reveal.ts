import type { Rng } from "../../../packages/wyrd-simulation/src/rng.js";
import type { TelegraphSlot } from "../../../packages/wyrd-simulation/src/telegraph.js";

/**
 * Progressive telegraph reveal (docs/duel-engagement-options.md §G): under
 * timers, hidden glyphs flip face-up one by one across the reaction window,
 * so reacting early means reacting with less information and waiting risks
 * the lock. Scry flips one hidden glyph now for 1 Focus (reaction-cost
 * rulesets). Pure functions; main.ts owns the clock and the Focus.
 */
export type Reveal = { index: number; atMs: number };

export function hiddenCount(slots: readonly TelegraphSlot[]): number {
    return slots.filter(s => s.kind !== "glyph").length;
}

function hiddenIndices(slots: readonly TelegraphSlot[]): number[] {
    return slots.map((s, i) => (s.kind === "glyph" ? -1 : i)).filter(i => i >= 0);
}

/** Every hidden slot gets a flip time, evenly spaced inside the window, in a seeded order. */
export function revealSchedule(slots: readonly TelegraphSlot[], rng: Rng, windowMs: number): Reveal[] {
    const remaining = hiddenIndices(slots);
    const order: number[] = [];
    while (remaining.length > 0) order.push(remaining.splice(rng.int(remaining.length), 1)[0] as number);
    const n = order.length;
    return order.map((index, k) => ({ index, atMs: Math.round((windowMs * (k + 1)) / (n + 1)) }));
}

/** The telegraph as seen at `elapsedMs`: base slots plus the flips that have happened. */
export function revealedSlots(slots: readonly TelegraphSlot[], tokens: readonly string[], schedule: readonly Reveal[], elapsedMs: number): TelegraphSlot[] {
    const out = [...slots];
    for (const flip of schedule) {
        if (flip.atMs <= elapsedMs) out[flip.index] = { kind: "glyph", token: tokens[flip.index] as string };
    }
    return out;
}

/** Flip one hidden slot now (Scry). Null when nothing is hidden. */
export function scrySlot(slots: readonly TelegraphSlot[], tokens: readonly string[], rng: Rng): { slots: TelegraphSlot[]; index: number } | null {
    const hidden = hiddenIndices(slots);
    if (hidden.length === 0) return null;
    const index = hidden[rng.int(hidden.length)] as number;
    const out = [...slots];
    out[index] = { kind: "glyph", token: tokens[index] as string };
    return { slots: out, index };
}
