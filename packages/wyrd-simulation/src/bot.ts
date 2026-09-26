import { REACTION_COSTS, type DuelState, type PlayerId, type ReactionGlyph } from "../../wyrd-resolver/src/index.js";
import type { Rng } from "./rng.js";
import { classifySpell, type LegalSpell } from "./spells.js";

/**
 * Heuristic opponent for the POC (plan POC-3). No search, no LLM: a
 * scoring table over the legal pool for spells and over the four
 * reactions, with seeded randomness so it varies between rounds yet
 * replays exactly from a seed. Every weight here is a playtest knob.
 */
export type BotView = {
    state: DuelState;
    botId: PlayerId;
    /** The bot's previous spell, never repeated back-to-back. */
    lastBotSpell?: readonly string[] | undefined;
};

export type ReactionChoice = ReactionGlyph | "none";
export type ReactionScores = Record<ReactionChoice, number>;

const SEALS_TO_WIN = 3;

function opponentOf(id: PlayerId): PlayerId {
    return id === "player" ? "opponent" : "player";
}

/** Would the defender's ward stop this spell? Mirrors the resolver's boundary rule. */
function wardStops(spell: LegalSpell, defender: DuelState["players"][PlayerId]): boolean {
    if (spell.action === "ward" || spell.target !== "enemy") return false;
    const ward = defender.ward;
    if (!ward) return false;
    return !ward.essence || !spell.essence || ward.essence === spell.essence;
}

export function scoreSpell(spell: LegalSpell, view: BotView): number {
    const me = view.state.players[view.botId];
    const them = view.state.players[opponentOf(view.botId)];
    let score = 1;

    const scoring = (spell.action === "seek" || spell.action === "bind") && spell.target === "enemy";
    if (scoring) score += 6;
    if (spell.action === "close") score += 5; // the GATE objective cannot be reflected or warded
    if (wardStops(spell, them)) score -= 7; // walking into a ward is the one clear mistake
    if (spell.action === "ward") {
        // A ward is worth having once, mostly when the match is long enough
        // for it to matter; SELF wards only - warding the enemy helps them.
        score += me.ward ? -3 : spell.target === "self" ? 2.5 : -4;
    }
    if (spell.target === "self" && spell.action !== "ward") score -= 5; // hits the caster, scores nothing
    if (spell.amplified) score += 1.2; // reads as a threat in the telegraph
    if (spell.anchored && spell.target === "enemy") score += 1.5; // insures the route against REFLECT
    // Prefer spending less Focus for the same outcome, slightly - and more
    // so when reactions cost Focus, since a 7-Focus spell leaves no answer.
    score -= spell.focusCost * (view.state.rules?.reactionCosts ? 0.5 : 0.15);
    return score;
}

/** Pick a spell from the pool: weighted by score, never the previous one. */
export function chooseBotSpell(pool: readonly LegalSpell[], view: BotView, rng: Rng): string[] {
    const last = view.lastBotSpell?.join(" ");
    const candidates = pool.filter(s => s.tokens.join(" ") !== last);
    const source = candidates.length > 0 ? candidates : pool;
    // Softmax-ish: exponentiate so good spells dominate but the tail still
    // shows up - a bot that always casts the top spell teaches nothing.
    const scored = source.map(s => ({ s, w: Math.exp(scoreSpell(s, view) / 1.5) }));
    return rng.weighted(scored, x => x.w).s.tokens;
}

/**
 * Reaction table against the player's committed spell. The bot sees the
 * whole spell (it is the machine); the randomness in chooseBotReaction is
 * what keeps it from being an oracle.
 */
export function scoreReactions(playerSpell: readonly string[], view: BotView): ReactionScores {
    const spell = classifySpell(playerSpell);
    const scores: ReactionScores = { none: 1, null: -2, reflect: -2, silence: -2 };
    if (!spell) return scores; // illegal spell: let it fail on its own

    const me = view.state.players[view.botId];
    const them = view.state.players[opponentOf(view.botId)];
    const hostile = spell.target === "enemy" && spell.action !== "ward";
    const scoresAgainstMe = hostile || spell.action === "close";
    const alreadyWarded = hostile && wardStops(spell, me);
    const matchPoint = them.seals >= SEALS_TO_WIN - 1;

    if (hostile && !spell.anchored && !alreadyWarded) scores.reflect = 5; // turn their seal into mine
    if (hostile && spell.anchored) scores.reflect = -3; // ANCHOR makes it a wasted reaction
    if (spell.amplified || spell.anchored) scores.silence = 2 + (spell.anchored && hostile ? 1 : 0);
    if (scoresAgainstMe && !alreadyWarded) {
        // NULL always works but teaches the player nothing and (in later
        // rules) will cost Focus; reserve it for when losing the round
        // loses the match.
        scores.null = matchPoint ? 6 : 0.5;
    }
    if (alreadyWarded) scores.none = 4; // the ward already answers it
    return scores;
}

export const REACTION_CHOICES: readonly ReactionChoice[] = ["none", "null", "reflect", "silence"];
const REACTION_TEMPERATURE = 1.2;

/** The bot's reaction distribution: softmax over the scoring table. Shared by the chooser and the advisor. */
export function reactionProbabilities(playerSpell: readonly string[], view: BotView): Record<ReactionChoice, number> {
    const scores = scoreReactions(playerSpell, view);
    // Under reaction costs the bot only considers what its remaining Focus
    // buys (its own spell was paid when it resolved, just before this call).
    const focus = view.state.players[view.botId].focus;
    const affordable = (c: ReactionChoice): boolean =>
        c === "none" || !view.state.rules?.reactionCosts || REACTION_COSTS[c] <= focus;
    const weights = REACTION_CHOICES.map(c => (affordable(c) ? Math.exp(scores[c] / REACTION_TEMPERATURE) : 0));
    const total = weights.reduce((a, b) => a + b, 0);
    const out = { none: 0, null: 0, reflect: 0, silence: 0 };
    REACTION_CHOICES.forEach((c, i) => {
        out[c] = (weights[i] as number) / total;
    });
    return out;
}

export function chooseBotReaction(playerSpell: readonly string[], view: BotView, rng: Rng): ReactionGlyph | undefined {
    const probabilities = reactionProbabilities(playerSpell, view);
    const picked = rng.weighted(REACTION_CHOICES, c => probabilities[c]);
    return picked === "none" ? undefined : picked;
}
