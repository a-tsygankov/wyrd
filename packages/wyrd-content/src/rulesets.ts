import { CLASSIC_RULES, type RuleOptions } from "../../wyrd-resolver/src/types.js";

/**
 * The four selectable rulesets (docs/duel-engagement-options.md §5). Each
 * builds on the previous one so a player can move up a step at a time and
 * telemetry can compare neighbours. `timers` is a client concern (reaction
 * ring, quick-cast window) and not a resolver rule.
 */
export type RulesetId = "classic" | "teeth" | "pulse" | "resolve";

export type Ruleset = {
    id: RulesetId;
    title: string;
    /** One line for lists and telemetry review. */
    summary: string;
    /** What this ruleset adds on top of the previous one, one change per line. */
    changes: string[];
    rules: RuleOptions;
    timers: boolean;
};

export const rulesetIds: readonly RulesetId[] = ["classic", "teeth", "pulse", "resolve"];

export const rulesets: Record<RulesetId, Ruleset> = {
    classic: {
        id: "classic",
        title: "Classic",
        summary: "The original POC: seals only, free reactions, wards never break, magnitude is just a number.",
        changes: ["First to 3 seals.", "Reactions are free.", "Wards never break.", "Magnitude is only a number in the log."],
        rules: { ...CLASSIC_RULES },
        timers: false
    },
    teeth: {
        id: "teeth",
        title: "Teeth",
        summary:
            "Wards have integrity 2 and shatter; reactions cost Focus (SILENCE 1, REFLECT 2, NULL 3) from the same 7 you compose with, and ending at 0 exposes one more glyph of your next telegraph; the same essence twice running ignites for +1 magnitude.",
        changes: [
            "Wards have integrity 2: each blocked hit dents them by its magnitude, at 0 they shatter.",
            "Reactions cost Focus from the same 7 you compose with: SILENCE 1, REFLECT 2, NULL 3.",
            "End a round at 0 Focus and your next telegraph reveals one more glyph.",
            "The same essence two casts running ignites: +1 magnitude."
        ],
        rules: { ...CLASSIC_RULES, wardIntegrity: 2, reactionCosts: true, ignite: true },
        timers: false
    },
    pulse: {
        id: "pulse",
        title: "Pulse",
        summary: "Teeth plus tempo: an 8-second reaction ring, and committing your spell within 5 seconds is a quick cast worth +1 magnitude.",
        changes: [
            "Everything in Teeth.",
            "The reaction window closes 8 seconds after the telegraph appears.",
            "Commit within 5 seconds for a quick cast: +1 magnitude.",
            "Timers never run in the teaching deck; the Tempo switch turns them off entirely."
        ],
        rules: { ...CLASSIC_RULES, wardIntegrity: 2, reactionCosts: true, ignite: true, quickCast: true },
        timers: true
    },
    resolve: {
        id: "resolve",
        title: "Resolve",
        summary:
            "Pulse plus a second clock: 10 Resolve each. SEEK deals its magnitude; BIND taxes the next spell 2 Focus; at 3 or less you falter (brittle wards, one more glyph revealed). Win by 3 seals or by emptying the opponent's Resolve.",
        changes: [
            "Everything in Pulse.",
            "Each mage has 10 Resolve; a SEEK that lands deals its magnitude.",
            "Being BOUND costs 2 extra Focus on your next spell.",
            "At 3 Resolve or less you falter: brittle wards, one more glyph revealed.",
            "Win by 3 seals or by emptying the opponent's Resolve."
        ],
        rules: { ...CLASSIC_RULES, wardIntegrity: 2, reactionCosts: true, ignite: true, quickCast: true, resolve: 10 },
        timers: true
    }
};

export function rulesetById(id: string | null | undefined): Ruleset {
    return (id && (rulesets as Record<string, Ruleset>)[id]) || rulesets.classic;
}
