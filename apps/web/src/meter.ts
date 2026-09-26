import { ROUND_FOCUS } from "../../../packages/wyrd-resolver/src/index.js";

/**
 * The Focus meter (docs/duel-ux-ideas.md §E, after Clash Royale's elixir
 * bar): one bar, the spell draining it from the left, the chosen reaction
 * and anything already spent (Scry, a PULL) from the right. Pure; main.ts
 * paints the widths.
 */
export type MeterInput = {
    /** Focus the composer has this round before the spell and reaction. */
    focus: number;
    spellCost: number;
    reactionCost: number;
};

export type Meter = {
    spellPct: number;
    reactionPct: number;
    spentPct: number;
    state: "full" | "ok" | "over";
};

export function focusMeter({ focus, spellCost, reactionCost }: MeterInput): Meter {
    const total = Math.max(ROUND_FOCUS, focus);
    const pct = (n: number): number => Math.round((Math.max(0, n) / total) * 100);
    const state: Meter["state"] =
        spellCost + reactionCost > focus ? "over" : spellCost === 0 && reactionCost === 0 && focus >= ROUND_FOCUS ? "full" : "ok";
    return { spellPct: pct(spellCost), reactionPct: pct(reactionCost), spentPct: pct(total - focus), state };
}
