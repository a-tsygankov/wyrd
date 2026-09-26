import type { DuelState, PlayerId, ReactionGlyph, ResolutionResult } from "../../wyrd-resolver/src/index.js";
import { resolveEncounter } from "../../wyrd-resolver/src/index.js";
import { REACTION_CHOICES, type ReactionChoice } from "./bot.js";
import type { LegalSpell } from "./spells.js";

/**
 * Best-move advice for the admin console (and, later, a tutor). It knows
 * everything - the opponent's hidden spell included - and simply asks the
 * resolver "what happens if…" for every option, then explains the answer
 * with the resolver's own step texts. No heuristics of its own, so it can
 * never disagree with the rules.
 */
export type Outcome = "player-seal" | "opponent-seal" | "blocked" | "canceled" | "no-seal";

/** Name the result from `perspective`'s point of view ("player" by default). */
export function classifyOutcome(result: ResolutionResult, perspective: PlayerId = "player"): Outcome {
    if (result.sealAwardedTo === perspective) return "player-seal";
    if (result.sealAwardedTo) return "opponent-seal";
    if (result.steps.some(s => s.code === "WARD_BLOCKED")) return "blocked";
    if (result.effect?.canceled) return "canceled";
    return "no-seal";
}

const VALUE: Record<Outcome, number> = { "player-seal": 1, "opponent-seal": -1, blocked: 0, canceled: 0, "no-seal": 0 };

/** Net seals for `perspective`: both sides can score when a SPLIT branch is REFLECTed. */
export function sealValue(result: ResolutionResult, perspective: PlayerId = "player"): number {
    const awarded = result.sealsAwarded;
    if (!awarded) return VALUE[classifyOutcome(result, perspective)];
    const other: PlayerId = perspective === "player" ? "opponent" : "player";
    return (awarded[perspective] ?? 0) - (awarded[other] ?? 0);
}

function keySteps(result: ResolutionResult): string {
    // The interesting steps: anything a reaction, ward or outcome did.
    const picked = result.steps.filter(s => s.stage !== "validation" && s.result !== "info");
    const lines = (picked.length > 0 ? picked : result.steps).map(s => s.text);
    return lines.slice(-3).join(" ");
}

export type ReactionAdvice = {
    reaction: ReactionChoice;
    outcome: Outcome;
    value: number;
    explanation: string;
};

/** How each of the player's reactions fares against the opponent's incoming spell. */
export function adviseReaction(state: DuelState, opponentSpell: readonly string[]): ReactionAdvice[] {
    return REACTION_CHOICES.map(reaction => {
        const result = resolveEncounter(state, {
            casterId: "opponent",
            defenderId: "player",
            spellTokens: [...opponentSpell],
            ...(reaction === "none" ? {} : { reaction: reaction as ReactionGlyph })
        });
        const outcome = classifyOutcome(result, "player");
        return {
            reaction,
            outcome,
            value: VALUE[outcome],
            explanation: `${reaction === "none" ? "No reaction" : reaction.toUpperCase()}: ${keySteps(result)}`
        };
    }).sort((a, b) => b.value - a.value);
}

export type ReactionModel = (playerSpell: readonly string[]) => Record<ReactionChoice, number>;

/** A model for a scripted opponent: the one reaction it will use. */
export function fixedReactionModel(reaction: ReactionChoice): ReactionModel {
    return () => ({ none: 0, null: 0, reflect: 0, silence: 0, [reaction]: 1 });
}

export type SpellAdvice = {
    tokens: string[];
    focusCost: number;
    expectedValue: number;
    breakdown: Array<{ reaction: ReactionChoice; probability: number; outcome: Outcome }>;
    explanation: string;
};

/**
 * Rank the player's legal spells by expected seal value against the
 * opponent's reaction distribution (the bot's table, a scenario's fixed
 * reaction, or anything else that returns probabilities).
 */
export function adviseSpell(
    state: DuelState,
    pool: readonly LegalSpell[],
    model: ReactionModel,
    options: { top?: number } = {}
): SpellAdvice[] {
    const top = options.top ?? 3;
    const advice: SpellAdvice[] = pool.map(spell => {
        const probabilities = model(spell.tokens);
        const breakdown: SpellAdvice["breakdown"] = [];
        let expectedValue = 0;
        const notes: string[] = [];
        for (const reaction of REACTION_CHOICES) {
            const probability = probabilities[reaction];
            if (probability <= 0) continue;
            const result = resolveEncounter(state, {
                casterId: "player",
                defenderId: "opponent",
                spellTokens: spell.tokens,
                ...(reaction === "none" ? {} : { reaction: reaction as ReactionGlyph })
            });
            const outcome = classifyOutcome(result, "player");
            expectedValue += probability * sealValue(result, "player");
            breakdown.push({ reaction, probability, outcome });
            notes.push(
                `${Math.round(probability * 100)}% ${reaction === "none" ? "no reaction" : reaction.toUpperCase()} → ${outcome.replace("-", " ")}`
            );
        }
        return {
            tokens: spell.tokens,
            focusCost: spell.focusCost,
            expectedValue: Math.round(expectedValue * 1000) / 1000,
            breakdown,
            explanation: notes.join("; ")
        };
    });
    advice.sort((a, b) => b.expectedValue - a.expectedValue || a.focusCost - b.focusCost || a.tokens.length - b.tokens.length);
    return advice.slice(0, top);
}
