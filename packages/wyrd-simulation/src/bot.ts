import { REACTION_COSTS, resolveEncounter, type DuelState, type PlayerId, type ReactionGlyph } from "../../wyrd-resolver/src/index.js";
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
    /** The bot's spells so far this match, oldest first; the last few are avoided. */
    recentBotSpells?: readonly (readonly string[])[] | undefined;
    /** Who the bot is this match (default: balanced). */
    personality?: Personality | undefined;
    /** What the bot is trying to do this round (default: no plan). */
    plan?: Plan | undefined;
};

export type ReactionChoice = ReactionGlyph | "none";
export type ReactionScores = Record<ReactionChoice, number>;

/**
 * Variety (options doc §I). A personality is chosen per match, a plan per
 * round, both from the match seed, and the bot avoids what it cast in the
 * last few rounds - so it stops looping on its best-scored spell while a
 * `?seed=` still replays the same opponent.
 */
export type Plan = "strike" | "shield" | "gate" | "trick" | "probe";
export const PLANS: readonly Plan[] = ["strike", "shield", "gate", "trick", "probe"];

export type Personality = {
    id: "balanced" | "aggressor" | "warden" | "trickster" | "gatekeeper";
    title: string;
    /** One line for the round note and the admin console. */
    blurb: string;
    /** Softmax temperature for spells; higher = more surprising. */
    temperature: number;
    /** Softmax temperature for reactions. */
    reactionTemperature: number;
    /**
     * Share of rounds where the bot casts a random reasonable spell instead of
     * its best - a whim, so its play cannot be fully read off the table.
     */
    whim: number;
    /**
     * Share of reaction choices drawn uniformly from the sensible options
     * instead of the table, so the best answer is never a certainty a player
     * can farm (always ANCHOR against a bot that always REFLECTs). Reactions
     * the resolver probe marks as self-harming are never drawn.
     */
    unpredictability: number;
    /** Relative odds of each round plan. */
    planWeights: Record<Plan, number>;
    /** Extra reaction scores. */
    reactionBias: Partial<Record<ReactionChoice, number>>;
    /**
     * Press the round (ideas doc §J): the share of rounds it presses when its
     * own spell would score, and whether it ever retreats from a press.
     */
    stakes: { press: number; retreats: boolean };
};

export const PERSONALITIES: readonly Personality[] = [
    {
        id: "balanced",
        title: "the Adept",
        blurb: "Plays the table straight: scores when it can, wards when it must.",
        temperature: 1.5,
        reactionTemperature: 1.2,
        whim: 0.12,
        unpredictability: 0.15,
        planWeights: { strike: 3, shield: 1.5, gate: 2, trick: 1.5, probe: 1 },
        reactionBias: {},
        stakes: { press: 0.2, retreats: true }
    },
    {
        id: "aggressor",
        title: "the Aggressor",
        blurb: "Hits every round, amplified when it can; saves its Focus for its own spell rather than answers.",
        temperature: 1.8,
        reactionTemperature: 1.2,
        whim: 0.1,
        unpredictability: 0.15,
        planWeights: { strike: 5, shield: 0.5, gate: 1.5, trick: 1, probe: 0.5 },
        reactionBias: { none: 1.5, null: -1, reflect: -0.5, silence: -1 },
        stakes: { press: 0.4, retreats: false },
    },
    {
        id: "warden",
        title: "the Warden",
        blurb: "Wards first, mends what dents, breaks yours; answers with SILENCE and REFLECT.",
        temperature: 1.5,
        reactionTemperature: 1.1,
        whim: 0.08,
        unpredictability: 0.2,
        planWeights: { strike: 1.5, shield: 4, gate: 1.5, trick: 0.5, probe: 1 },
        reactionBias: { none: -1, reflect: 1, silence: 1.5 },
        stakes: { press: 0.1, retreats: true },
    },
    {
        id: "trickster",
        title: "the Trickster",
        blurb: "REVERSEs gates, SPLITs bolts, bluffs with AMPLIFY; its reactions are hard to read.",
        temperature: 2.2,
        reactionTemperature: 2.5,
        whim: 0.25,
        unpredictability: 0.3,
        planWeights: { strike: 1.5, shield: 1, gate: 1.5, trick: 4, probe: 1.5 },
        reactionBias: { silence: 0.5 },
        stakes: { press: 0.35, retreats: false },
    },
    {
        id: "gatekeeper",
        title: "the Gatekeeper",
        blurb: "Fights over the GATE: closes, opens, shatters and mends it; NULLs a gate spell that would score.",
        temperature: 1.5,
        reactionTemperature: 1.2,
        whim: 0.1,
        unpredictability: 0.12,
        planWeights: { strike: 1.5, shield: 1, gate: 5, trick: 1, probe: 0.5 },
        reactionBias: {},
        stakes: { press: 0.25, retreats: true },
    }
];

const BALANCED = PERSONALITIES[0] as Personality;

export function choosePersonality(rng: Rng): Personality {
    return rng.weighted(PERSONALITIES, () => 1);
}

/** The round's plan from the personality's odds, bent by the board: no second ward, no gate play over a shattered gate, defence when the opponent is at match point. */
export function choosePlan(view: BotView, rng: Rng): Plan {
    const personality = view.personality ?? BALANCED;
    const me = view.state.players[view.botId];
    const them = view.state.players[opponentOf(view.botId)];
    const weights: Record<Plan, number> = { ...personality.planWeights };
    if (me.ward) weights.shield *= 0.3;
    if ((view.state.gate ?? "open") === "broken") weights.gate *= 0.4;
    if (them.seals >= SEALS_TO_WIN - 1) {
        weights.strike *= 1.5;
        weights.shield *= 1.3;
    }
    // Do not run the same plan three rounds running: the recent spells tell.
    const recent = view.recentBotSpells ?? [];
    if (recent.length >= 2 && recent.slice(-2).every(s => s.includes("GATE"))) weights.gate *= 0.4;
    if (recent.length >= 2 && recent.slice(-2).every(s => s.includes("WARD"))) weights.shield *= 0.2;
    return rng.weighted(PLANS, plan => weights[plan]);
}

const SEALS_TO_WIN = 3;

function opponentOf(id: PlayerId): PlayerId {
    return id === "player" ? "opponent" : "player";
}

/** Would the defender's ward stop this spell? Mirrors the resolver's boundary rule (an anchored route is a known route: any ward). */
function wardStops(spell: LegalSpell, defender: DuelState["players"][PlayerId]): boolean {
    if (spell.action !== "seek" && spell.action !== "bind") return false;
    if (spell.target !== "enemy") return false;
    const ward = defender.ward;
    if (!ward) return false;
    return spell.anchored || !ward.essence || !spell.essence || ward.essence === spell.essence;
}

export function scoreSpell(spell: LegalSpell, view: BotView): number {
    const me = view.state.players[view.botId];
    const them = view.state.players[opponentOf(view.botId)];
    let score = 1;

    const scoring = (spell.action === "seek" || spell.action === "bind") && spell.target === "enemy";
    if (scoring) score += 6;
    // The gate objective cannot be reflected or warded, but it only scores
    // in the direction it can move; broken, it needs MEND first.
    if (spell.action === "close" || spell.action === "open") {
        const gate = view.state.gate ?? "open";
        const scores = gate === (spell.action === "close" ? "open" : "closed");
        score += scores ? 5 : -6;
    }
    if (spell.action === "break") {
        if (spell.target === "gate") score += view.state.gate === "broken" ? -6 : them.seals >= 2 ? 3 : 0.5; // deny the objective when they are close
        else if (spell.target === "enemy") score += them.ward ? 4 : -5; // the anti-ward, pointless without a ward
        else score -= 6;
    }
    if (spell.action === "mend") {
        if (spell.target === "gate") score += view.state.gate === "broken" ? 3 : -6;
        else if (spell.target === "self") {
            const dented = me.ward !== undefined && view.state.rules.wardIntegrity > 0 && (me.ward.integrity ?? view.state.rules.wardIntegrity) < view.state.rules.wardIntegrity;
            const hurt = view.state.rules.resolve > 0 && (me.resolve ?? view.state.rules.resolve) <= view.state.rules.resolve - 3;
            score += dented || hurt ? 3.5 : -5;
        } else score -= 6;
    }
    if (wardStops(spell, them)) score -= 7; // walking into a ward is the one clear mistake
    if (spell.action === "ward" && spell.target !== "gate") {
        // A ward is worth having once, mostly when the match is long enough
        // for it to matter; SELF wards only - warding the enemy helps them.
        score += me.ward ? -3 : spell.target === "self" ? 2.5 : -4;
    }
    // The gate ward (balance fix 4): take the gate while it is free; break
    // theirs before trying to move the gate; never ward it twice.
    const gateWard = view.state.gateWard;
    if (spell.action === "ward" && spell.target === "gate") score += gateWard ? -4 : (view.state.gate ?? "open") === "broken" ? -2 : 2.5;
    if (spell.target === "gate" && spell.action !== "ward" && gateWard && gateWard.ownerId !== view.botId) score += spell.action === "break" ? 4 : -6;
    if (spell.target === "self" && spell.action !== "ward" && spell.action !== "mend") score -= 5; // hits the caster, scores nothing
    if (spell.amplified) score += 1.2; // reads as a threat in the telegraph
    if (spell.anchored && spell.target === "enemy") score += 1.5; // insures the route against REFLECT
    // SPLIT doubles the hits and keeps a seal even against REFLECT; WEAKEN
    // buys nothing but a bluff. REVERSE is already folded into spell.action.
    if (spell.modifiers.includes("split")) score += 1.5 + (spell.target === "enemy" && !spell.anchored ? 1 : 0);
    if (spell.modifiers.includes("weaken")) score -= 1.5;
    // Prefer spending less Focus for the same outcome, slightly - and more
    // so when reactions cost Focus, since a 7-Focus spell leaves no answer.
    score -= spell.focusCost * (view.state.rules?.reactionCosts ? 0.5 : 0.15);

    // --- Variety: who the bot is, what it wants this round, what it just did.
    const gatePlay = spell.target === "gate";
    const defensive = (spell.action === "ward" || spell.action === "mend") && spell.target === "self";
    const tricky = spell.modifiers.includes("reverse") || spell.modifiers.includes("split");
    switch ((view.personality ?? BALANCED).id) {
        case "aggressor":
            if (scoring) score += 2;
            if (spell.amplified) score += 1;
            if (spell.modifiers.includes("split")) score += 1;
            if (spell.action === "ward") score -= 2;
            if (spell.action === "mend") score -= 1;
            break;
        case "warden":
            if (spell.action === "ward") score += 3;
            if (spell.action === "mend") score += 1.5;
            if (spell.action === "break" && spell.target === "enemy") score += 1;
            if (scoring) score -= 0.5;
            break;
        case "trickster":
            if (spell.modifiers.includes("reverse")) score += 2.5;
            if (spell.modifiers.includes("split")) score += 1.5;
            if (spell.modifiers.includes("weaken")) score += 2.5; // the bluff it likes: reads loud, lands soft
            if (spell.amplified) score += 1;
            if (spell.anchored) score += 0.5;
            break;
        case "gatekeeper":
            if (gatePlay) score += 3;
            if (gatePlay && spell.anchored) score += 1;
            break;
        case "balanced":
            break;
    }
    switch (view.plan) {
        case "strike":
            if (scoring) score += 2;
            break;
        case "shield":
            if (defensive) score += 3;
            if (spell.action === "break" && spell.target === "enemy") score += 1;
            break;
        case "gate":
            if (gatePlay) score += 3;
            break;
        case "trick":
            if (tricky) score += 2.5;
            if (spell.amplified || spell.anchored || spell.modifiers.includes("weaken")) score += 1.5;
            break;
        case "probe":
            score += (4 - spell.focusCost) * 0.8; // cheap and quick, keep the Focus
            if (spell.action === "seek" && !spell.essence) score += 1;
            break;
        case undefined:
            break;
    }
    // Recency: the last three casts are excluded in chooseBotSpell; the three
    // before that, and the same action-target shape as the last cast, cost.
    const recent = view.recentBotSpells ?? (view.lastBotSpell ? [view.lastBotSpell] : []);
    const key = spell.tokens.join(" ");
    if (recent.slice(-6, -3).some(s => s.join(" ") === key)) score -= 2.5;
    const last = recent[recent.length - 1];
    if (last) {
        const shape = classifySpell(last);
        if (shape && shape.action === spell.action && shape.target === spell.target) score -= 1.5;
    }
    return score;
}

/**
 * Temper: the softmax temperature for spells this round. Behind on seals the
 * bot runs hotter (more erratic, more willing to gamble); ahead, cooler.
 * Never below 1, so the table still means something.
 */
export function spellTemperature(view: BotView): number {
    const personality = view.personality ?? BALANCED;
    const me = view.state.players[view.botId].seals;
    const them = view.state.players[opponentOf(view.botId)].seals;
    return Math.max(1, personality.temperature * (1 + 0.25 * (them - me)));
}

export type SpellChoice = { tokens: string[]; whim: boolean };

/** Pick a spell from the pool: on a whim a random reasonable one, otherwise weighted by score; never one of the last three. */
export function chooseBotSpellDetailed(pool: readonly LegalSpell[], view: BotView, rng: Rng): SpellChoice {
    const recent = view.recentBotSpells ?? (view.lastBotSpell ? [view.lastBotSpell] : []);
    const banned = new Set(recent.slice(-3).map(s => s.join(" ")));
    const candidates = pool.filter(s => !banned.has(s.tokens.join(" ")));
    const source = candidates.length > 0 ? candidates : pool;
    const personality = view.personality ?? BALANCED;
    const scored = source.map(s => ({ s, score: scoreSpell(s, view) }));
    // The whim: a uniform draw over what is not plainly bad (a self-hit, a
    // walk into a ward). The randomness players feel, kept honest.
    if (rng.next() < personality.whim) {
        const reasonable = scored.filter(x => x.score > -3);
        if (reasonable.length > 0) return { tokens: rng.pick(reasonable).s.tokens, whim: true };
    }
    // Softmax-ish: exponentiate so good spells dominate but the tail still
    // shows up - a bot that always casts the top spell teaches nothing.
    const temperature = spellTemperature(view);
    return { tokens: rng.weighted(scored, x => Math.exp(x.score / temperature)).s.tokens, whim: false };
}

export function chooseBotSpell(pool: readonly LegalSpell[], view: BotView, rng: Rng): string[] {
    return chooseBotSpellDetailed(pool, view, rng).tokens;
}

/** Would this spell score a seal on the board as it stands (a hostile SEEK or BIND, a gate spell in the direction the gate can move)? */
function scoresNow(spell: LegalSpell, state: DuelState): boolean {
    if ((spell.action === "seek" || spell.action === "bind") && spell.target === "enemy") return true;
    const gate = state.gate ?? "open";
    if (spell.action === "close") return gate === "open";
    if (spell.action === "open") return gate === "closed";
    return false;
}

/**
 * Press the round (ideas doc §J): stake a double seal on a spell that would
 * score. Personality sets the appetite; the board bends it - free when the
 * opponent is at match point (a loss loses anyway), cautious when a double
 * loss would hand them match point.
 */
export function botPresses(view: BotView, spell: readonly string[], rng: Rng): boolean {
    const legal = classifySpell(spell);
    if (!legal || !scoresNow(legal, view.state)) return false;
    const personality = view.personality ?? BALANCED;
    const me = view.state.players[view.botId].seals;
    const them = view.state.players[opponentOf(view.botId)].seals;
    let odds = personality.stakes.press;
    if (them >= 2) odds *= 1.6;
    else if (them === 1 && me === 0) odds *= 0.6;
    if (me >= 2) odds *= 1.3;
    return rng.next() < Math.min(0.9, odds);
}

/**
 * Retreat from the opponent's press: concede one seal rather than play for
 * two. Only when the bot's own spell cannot win the round, when the double
 * would matter (it would put the opponent at match point or beyond) and when
 * the conceded seal does not itself end the match. Aggressors and tricksters
 * never retreat.
 */
export function botRetreats(view: BotView, spell: readonly string[]): boolean {
    const personality = view.personality ?? BALANCED;
    if (!personality.stakes.retreats) return false;
    const legal = classifySpell(spell);
    if (legal && scoresNow(legal, view.state)) return false;
    const them = view.state.players[opponentOf(view.botId)].seals;
    return them + 2 >= 3 && them + 1 < 3;
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
    const hostile = spell.target === "enemy" && (spell.action === "seek" || spell.action === "bind" || spell.action === "break");
    const gateScores = (spell.action === "close" && view.state.gate === "open") || (spell.action === "open" && view.state.gate === "closed");
    const scoresAgainstMe = (hostile && spell.action !== "break") || gateScores;
    const alreadyWarded = hostile && wardStops(spell, me);
    const matchPoint = them.seals >= SEALS_TO_WIN - 1;

    if (hostile && !spell.anchored && !alreadyWarded) scores.reflect = 5; // turn their seal into mine
    if (hostile && spell.anchored) scores.reflect = -3; // ANCHOR makes it a wasted reaction
    if (hostile && spell.modifiers.includes("split") && scores.reflect > 0) scores.reflect = 2; // one branch still lands on me
    if (spell.modifiers.length > 0) scores.silence = 2 + (spell.anchored && hostile ? 1 : 0);
    if (spell.modifiers.includes("reverse")) scores.silence += 1.5; // undo the trick: the telegraphed action is the one that lands
    if (scoresAgainstMe && !alreadyWarded) {
        // NULL always works but teaches the player nothing and (in later
        // rules) will cost Focus; reserve it for when losing the round
        // loses the match - except against the gate, which nothing else
        // answers (docs/balance-analysis.md §3.6).
        scores.null = matchPoint ? 6 : gateScores ? 2.5 : 0.5;
    }
    if (alreadyWarded) scores.none = 4; // the ward already answers it
    // Who the bot is: the aggressor keeps its Focus, the warden answers, the
    // gatekeeper will not let a scoring gate spell through.
    const personality = view.personality ?? BALANCED;
    for (const [choice, bias] of Object.entries(personality.reactionBias) as Array<[ReactionChoice, number]>) scores[choice] += bias;
    // The gate has no other answer: every personality keeps NULL on the table for a scoring gate spell.
    if (gateScores && !alreadyWarded) scores.null = Math.max(scores.null, personality.id === "gatekeeper" ? 3 : 2.5);

    // Then ask the resolver (the bot sees the whole spell): a reaction that
    // leaves the bot worse off - SILENCE turning a failing REVERSEd gate
    // spell back into the scoring one, REFLECT into ANCHOR - is never worth
    // it, and when NULL is the only reaction that removes the harm it gets
    // the gate treatment (docs/balance-analysis.md §3.2, §3.6).
    const harmOf = (reaction: ReactionGlyph | undefined): number => {
        const result = resolveEncounter(view.state, {
            casterId: opponentOf(view.botId),
            defenderId: view.botId,
            spellTokens: [...playerSpell],
            ...(reaction ? { reaction } : {})
        });
        const mine = result.state.players[view.botId];
        const seals = (result.sealsAwarded?.[opponentOf(view.botId)] ?? 0) - (result.sealsAwarded?.[view.botId] ?? 0);
        const wardLost = me.ward && !mine.ward ? 1 : 0;
        return seals + wardLost;
    };
    const baseline = harmOf(undefined);
    const helps: ReactionGlyph[] = [];
    for (const reaction of ["silence", "reflect", "null"] as const) {
        const harm = harmOf(reaction);
        if (harm > baseline) scores[reaction] = -5;
        else if (harm < baseline) helps.push(reaction);
        else if (baseline > 0 && reaction !== "null") scores[reaction] = Math.min(scores[reaction], -1); // changes nothing that matters
    }
    if (baseline > 0 && helps.length > 0) {
        // Something answers it: doing nothing is no longer the safe default,
        // whatever the ward heuristic said (an amplified SPLIT shatters a
        // fresh ward and lands), and the cheap answers are worth their Focus.
        scores.none = Math.min(scores.none, 1);
        for (const reaction of helps) scores[reaction] = Math.max(scores[reaction], reaction === "null" ? 1.5 : 3);
        if (helps.length === 1 && helps[0] === "null") scores.null = Math.max(scores.null, 2.5);
    }
    if (baseline <= 0) scores.null = Math.min(scores.null, -2); // nothing to stop
    return scores;
}

export const REACTION_CHOICES: readonly ReactionChoice[] = ["none", "null", "reflect", "silence"];

/** The bot's reaction distribution: softmax over the scoring table. Shared by the chooser and the advisor. */
export function reactionProbabilities(playerSpell: readonly string[], view: BotView): Record<ReactionChoice, number> {
    const scores = scoreReactions(playerSpell, view);
    // Under reaction costs the bot only considers what its remaining Focus
    // buys (its own spell was paid when it resolved, just before this call).
    const focus = view.state.players[view.botId].focus;
    const affordable = (c: ReactionChoice): boolean =>
        c === "none" || !view.state.rules?.reactionCosts || REACTION_COSTS[c] <= focus;
    const personality = view.personality ?? BALANCED;
    // A reaction the resolver probe marked self-harming (score -5) is never chosen at all.
    const weights = REACTION_CHOICES.map(c => (affordable(c) && scores[c] > -4 ? Math.exp(scores[c] / personality.reactionTemperature) : 0));
    const total = weights.reduce((a, b) => a + b, 0);
    // The sensible options: affordable and not marked self-harming by the
    // resolver probe (score -5). A slice of the choice is spread evenly over
    // them so no single answer becomes a certainty.
    const sensible = REACTION_CHOICES.filter((c, i) => (weights[i] as number) > 0 && scores[c] > -4);
    const epsilon = sensible.length > 1 ? personality.unpredictability : 0;
    const out = { none: 0, null: 0, reflect: 0, silence: 0 };
    REACTION_CHOICES.forEach((c, i) => {
        const table = (weights[i] as number) / total;
        const uniform = sensible.includes(c) ? 1 / sensible.length : 0;
        out[c] = (1 - epsilon) * table + epsilon * uniform;
    });
    return out;
}

export function chooseBotReaction(playerSpell: readonly string[], view: BotView, rng: Rng): ReactionGlyph | undefined {
    const probabilities = reactionProbabilities(playerSpell, view);
    const picked = rng.weighted(REACTION_CHOICES, c => probabilities[c]);
    return picked === "none" ? undefined : picked;
}
