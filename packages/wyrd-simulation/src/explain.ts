import { glyphHelp } from "../../wyrd-content/src/glyphHelp.js";
import { parseSpell } from "../../wyrd-grammar/src/parser.js";
import type { DuelState, ReactionGlyph, ResolutionResult } from "../../wyrd-resolver/src/index.js";
import { resolveEncounter } from "../../wyrd-resolver/src/index.js";
import { classifyOutcome, type Outcome } from "./advisor.js";
import type { TelegraphSlot } from "./telegraph.js";

/**
 * Player-facing explanations (POC-5: "players can explain why a counter
 * worked or failed"). Like the advisor, this asks the resolver rather than
 * restating the rules, so what it says is what will happen.
 */
export type Names = { you: string; them: string };

export type SpellExplanation = {
    glyphs: Array<{ token: string; text: string }>;
    /** What casting this now would do, plus what it is weak or immune to. */
    summary: string[];
};

const MIN_GLYPHS = 2;
const MAX_GLYPHS = 4;
const MAX_FOCUS = 7;

function outcomeText(outcome: Outcome, names: Names): string {
    switch (outcome) {
        case "player-seal":
            return `seal to ${names.you}`;
        case "opponent-seal":
            return `seal to ${names.them}`;
        case "blocked":
            return "blocked by the ward";
        case "canceled":
            return "canceled";
        case "no-seal":
            return "no seal";
    }
}

function cap(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * `casterId` is who is composing: "player" (solo, hot-seat Player 1) or
 * "opponent" (hot-seat Player 2 building a spell against Player 1's wards).
 */
export function explainSpell(
    tokens: readonly string[],
    state: DuelState,
    names: Names,
    casterId: "player" | "opponent" = "player"
): SpellExplanation {
    const glyphs = tokens.map(token => ({ token, text: glyphHelp[token]?.text ?? "Unknown glyph." }));
    const summary: string[] = [];
    if (tokens.length === 0) return { glyphs, summary: ["Tap glyphs to build a 2–4 glyph spell."] };

    const parsed = parseSpell([...tokens]);
    if (tokens.length < MIN_GLYPHS) {
        summary.push(`Not yet castable: a spell needs ${MIN_GLYPHS}–${MAX_GLYPHS} glyphs (Focus so far ${parsed.focusCost}).`);
        return { glyphs, summary };
    }
    if (parsed.status !== "valid") {
        summary.push(parsed.diagnostics[0]?.message ?? "The glyphs do not form a spell yet.");
        return { glyphs, summary };
    }
    if (tokens.length > MAX_GLYPHS || parsed.focusCost > MAX_FOCUS) {
        summary.push(`Too heavy: ${tokens.length} glyphs, Focus ${parsed.focusCost} (limit ${MAX_GLYPHS} glyphs, ${MAX_FOCUS} Focus).`);
        return { glyphs, summary };
    }

    const defenderId = casterId === "player" ? "opponent" : "player";
    const cast = (reaction?: ReactionGlyph): ResolutionResult =>
        resolveEncounter(state, {
            casterId,
            defenderId,
            spellTokens: [...tokens],
            ...(reaction ? { reaction } : {})
        });
    const plain = cast();
    if (plain.steps.some(s => s.stage === "validation" && s.result === "failed")) {
        summary.push(plain.steps.find(s => s.result === "failed")?.text ?? "The resolver cannot cast this.");
        return { glyphs, summary };
    }
    const effectStep = plain.steps.find(s => s.stage === "effect" || s.stage === "boundary");
    const uncontested = classifyOutcome(plain, casterId);
    summary.push(cap(`if ${names.them} does not react: ${effectStep?.text ?? ""} → ${outcomeText(uncontested, names)}.`));

    if (uncontested === "blocked") {
        const ward = state.players[defenderId].ward;
        summary.push(
            cap(`${names.them}'s ${ward?.essence ? ward.essence.toUpperCase() + "-filtered" : "untyped"} ward blocks this. Change the essence, or aim at the GATE.`)
        );
        return { glyphs, summary };
    }

    const reflected = classifyOutcome(cast("reflect"), casterId);
    const silenced = cast("silence");
    const anchored = plain.effect?.anchored ?? false;
    const amplified = (plain.effect?.magnitude ?? 1) > 1;
    if (reflected === "opponent-seal") {
        summary.push(cap(`open to REFLECT: ${names.them} could send it back and take the seal instead. ANCHOR would fix the route.`));
    } else if (anchored && plain.effect?.target === "enemy") {
        summary.push("ANCHOR fixes the route: REFLECT fails against this spell.");
    } else if (plain.effect?.action === "close") {
        summary.push("Aimed at the GATE: REFLECT and wards cannot touch it; only NULL stops it.");
    }
    if (amplified || anchored) {
        const stripped = silenced.steps.some(s => s.code === "SILENCE_STRIPPED_MODIFIERS");
        summary.push(
            stripped
                ? `SILENCE would strip ${[amplified ? "AMPLIFY" : "", anchored ? "ANCHOR" : ""].filter(Boolean).join(" and ")}, but the base spell still lands.`
                : "SILENCE finds nothing to strip here."
        );
    }
    if (uncontested !== "no-seal") summary.push("NULL always cancels it outright.");
    return { glyphs, summary };
}

function shown(slots: readonly TelegraphSlot[]): { tokens: Set<string>; families: Set<string>; hidden: number } {
    const tokens = new Set<string>();
    const families = new Set<string>();
    let hidden = 0;
    for (const slot of slots) {
        if (slot.kind === "glyph") tokens.add(slot.token);
        else if (slot.kind === "family") families.add(slot.family);
        else hidden++;
    }
    return { tokens, families, hidden };
}

/** What the chosen reaction would do against the spell as far as the telegraph reveals it. */
export function explainReaction(reaction: ReactionGlyph | undefined, telegraph: readonly TelegraphSlot[]): string {
    const seen = shown(telegraph);
    const action = ["SEEK", "BIND", "WARD", "CLOSE"].find(a => seen.tokens.has(a));
    const spellName = action ?? "their spell";
    const hiddenNote = seen.hidden > 0 ? ` ${seen.hidden} glyph${seen.hidden > 1 ? "s are" : " is"} hidden.` : "";

    if (!reaction) {
        return `No reaction: let ${spellName} resolve as cast. Your wards still apply.${hiddenNote}`;
    }
    if (reaction === "null") {
        return `NULL cancels ${spellName} outright, whatever the hidden glyphs are. The hard counter - it also teaches you nothing about the spell.${hiddenNote}`;
    }
    if (reaction === "reflect") {
        if (action === "CLOSE" || action === "WARD") {
            return `REFLECT against ${action}: nothing to reverse - ${action} has no hostile route, so REFLECT is wasted here.`;
        }
        return `REFLECT: if ${spellName}'s hidden target is ENEMY and it carries no ANCHOR, it returns to its caster and you gain the seal. Against SELF, GATE or an ANCHORed route it does nothing.${hiddenNote}`;
    }
    // silence
    return `SILENCE strips AMPLIFY and ANCHOR from ${spellName} but the base spell still lands - use it to reopen an ANCHORed route for a later round, not to stop a seal.${hiddenNote}`;
}

export type Contribution = {
    result: ResolutionResult;
    spell: readonly string[];
    reaction: ReactionGlyph | undefined;
};

export type RoundExplanation = {
    verdict: string;
    reasons: string[];
    yourSeals: number;
    theirSeals: number;
};

function reactionNote(result: ResolutionResult, reaction: ReactionGlyph | undefined, reactor: string): string | undefined {
    if (!reaction) return undefined;
    const step =
        result.steps.find(s => s.stage === "routing" || s.stage === "suppression" || s.stage === "cancel" || s.stage === "anchor") ??
        undefined;
    if (!step) return `${reactor}'s ${reaction.toUpperCase()} changed nothing.`;
    if (step.result === "applied" || step.result === "canceled") return `${reactor}'s ${reaction.toUpperCase()}: ${step.text}`;
    if (step.code === "SILENCE_NO_MODIFIERS") return `${reactor}'s SILENCE found no modifier to strip - it did nothing.`;
    return `${reactor}'s ${reaction.toUpperCase()} failed: ${step.text}`;
}

/**
 * Who won the round and why. `incoming` is the opponent's spell resolved
 * against the player's reaction; `outgoing` the player's spell against the
 * opponent's reaction (absent when the match ended mid-round).
 */
export function explainRound(incoming: Contribution, outgoing: Contribution | undefined, names: Names): RoundExplanation {
    const reasons: string[] = [];
    let yours = 0;
    let theirs = 0;

    const describe = (c: Contribution, caster: string, defender: string, casterIsYou: boolean): void => {
        const spell = c.spell.join(" ");
        const outcome = classifyOutcome(c.result, casterIsYou ? "player" : "opponent");
        const effect = c.result.steps.find(s => s.stage === "effect")?.text;
        if (outcome === "player-seal") {
            if (casterIsYou) yours++;
            else theirs++;
            reasons.push(cap(`${caster} gained a seal: ${spell} ${effect ? "- " + effect : "landed."}`));
        } else if (outcome === "opponent-seal") {
            if (casterIsYou) theirs++;
            else yours++;
            reasons.push(cap(`${defender} gained a seal: ${c.reaction?.toUpperCase() ?? "the reaction"} returned ${spell} to its caster.`));
        } else if (outcome === "blocked") {
            reasons.push(cap(`${caster}'s ${spell} was blocked by ${defender}'s ward.`));
        } else if (outcome === "canceled") {
            reasons.push(cap(`${caster}'s ${spell} was canceled by ${defender}'s NULL.`));
        } else {
            reasons.push(cap(`${caster}'s ${spell} scored nothing${effect ? " - " + effect : "."}`));
        }
        const note = reactionNote(c.result, c.reaction, defender);
        if (note && outcome !== "opponent-seal" && outcome !== "canceled") reasons.push(cap(note));
    };

    describe(incoming, names.them, names.you, false);
    if (outgoing) describe(outgoing, names.you, names.them, true);

    const verdict =
        yours > theirs
            ? cap(`${names.you} took the round, ${yours}–${theirs} in seals.`)
            : theirs > yours
                ? cap(`${names.them} took the round, ${theirs}–${yours} in seals.`)
                : yours === 0
                    ? "An even round: no seals changed hands."
                    : `An even round, ${yours}–${theirs} in seals.`;
    return { verdict, reasons, yourSeals: yours, theirSeals: theirs };
}

export type RoundHistory = { round: number; reasons: string[] };

/** Match verdict: who won, the score, and the seals that got them there. */
export function explainMatch(state: DuelState, history: readonly RoundHistory[], names: Names): string {
    const you = state.players.player.seals;
    const them = state.players.opponent.seals;
    const winner = you >= them ? names.you : names.them;
    const score = you >= them ? `${you}–${them}` : `${them}–${you}`;
    const prefix = `${winner} gained a seal`.toLowerCase();
    const seals = history
        .flatMap(h => h.reasons.filter(r => r.toLowerCase().startsWith(prefix)).map(r => `R${h.round}: ${r.replace(/^.*?gained a seal: /, "")}`))
        .slice(0, 5);
    const verb = winner === names.you && names.you.toLowerCase() === "you" ? "win" : "wins";
    return cap(`${winner} ${verb} the duel ${score}.${seals.length ? " Winning seals - " + seals.join(" · ") : ""}`);
}
