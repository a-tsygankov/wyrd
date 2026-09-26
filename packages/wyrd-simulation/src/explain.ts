import { glyphHelp } from "../../wyrd-content/src/glyphHelp.js";
import type { Scenario } from "../../wyrd-content/src/scenarios.js";
import { parseSpell } from "../../wyrd-grammar/src/parser.js";
import {
    CLASSIC_RULES,
    FALTERING_AT,
    REACTION_COSTS,
    type DuelState,
    type PlayerId,
    type ReactionGlyph,
    type ResolutionResult,
    type RuleOptions
} from "../../wyrd-resolver/src/index.js";
import { resolveEncounter } from "../../wyrd-resolver/src/index.js";
import { classifyOutcome, type Outcome } from "./advisor.js";
import type { TelegraphSlot } from "./telegraph.js";

/**
 * Player-facing explanations (POC-5: "players can explain why a counter
 * worked or failed"). Like the advisor, this asks the resolver rather than
 * restating the rules, so what it says is what will happen - under whatever
 * ruleset the state carries (Classic, Teeth, Pulse, Resolve).
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

function cap(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function price(reaction: ReactionGlyph, rules: RuleOptions): string {
    return rules.reactionCosts ? ` (${REACTION_COSTS[reaction]} Focus)` : "";
}

/**
 * Glyph help for the ruleset in force: the base text from content plus the
 * lines a rule adds. Data first, rules second, so a wrong sentence is a
 * content fix and a rule's consequence is stated once here.
 */
export function glyphHelpText(token: string, rules: RuleOptions = CLASSIC_RULES): string {
    const base = glyphHelp[token]?.text ?? "Unknown glyph.";
    const extra: string[] = [];
    switch (token) {
        case "WARD":
            if (rules.wardIntegrity > 0) extra.push(`Integrity ${rules.wardIntegrity}: every blocked hit dents it by its magnitude; at 0 it shatters.`);
            if (rules.resolve > 0) extra.push(`Faltering casters (Resolve ${FALTERING_AT} or less) raise brittle wards of integrity 1.`);
            break;
        case "AMPLIFY":
            if (rules.wardIntegrity > 0) extra.push("Magnitude 2 dents a ward twice as hard - one amplified hit shatters a fresh ward.");
            if (rules.resolve > 0) extra.push("Under Resolve, an amplified SEEK deals 2.");
            break;
        case "SEEK":
            if (rules.resolve > 0) extra.push("Under Resolve it also deals its magnitude to the target's Resolve.");
            if (rules.ignite) extra.push("Cast the same essence again next round to ignite it for +1 magnitude.");
            break;
        case "BIND":
            if (rules.resolve > 0) extra.push("A BOUND mage pays 2 extra Focus for their next spell.");
            break;
        case "FIRE":
        case "SHADOW":
            if (rules.ignite) extra.push("Ignite: the same essence two casts running adds +1 magnitude.");
            break;
        case "ANCHOR":
            if (rules.reactionCosts) extra.push("Makes REFLECT (2 Focus) a wasted reaction for the opponent.");
            break;
        case "SPLIT":
            if (rules.wardIntegrity > 0) extra.push("Two branches of magnitude 1 shatter a fresh ward like one amplified hit.");
            if (rules.resolve > 0) extra.push("Under Resolve, a split SEEK deals 1 twice.");
            break;
        case "WEAKEN":
            if (rules.wardIntegrity > 0) extra.push("A magnitude-0 hit leaves a ward undented.");
            break;
    }
    return extra.length ? `${base} ${extra.join(" ")}` : base;
}

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
    const rules = state.rules ?? CLASSIC_RULES;
    const glyphs = tokens.map(token => ({ token, text: glyphHelpText(token, rules) }));
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

    const defenderId: PlayerId = casterId === "player" ? "opponent" : "player";
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
    const magnitudeNotes = plain.steps.filter(s => s.code === "IGNITE_APPLIED").map(s => s.text);
    summary.push(cap(`if ${names.them} does not react: ${effectStep?.text ?? ""} → ${outcomeText(uncontested, names)}.`));
    for (const note of magnitudeNotes) summary.push(note);
    if (rules.reactionCosts) {
        const tax = plain.steps.find(s => s.code === "BOUND_TAX");
        const focusLeft = plain.state.players[casterId].focus;
        summary.push(`Costs ${parsed.focusCost} Focus${tax ? " plus the BIND tax" : ""}; ${focusLeft} left for a reaction${focusLeft === 0 ? " - and 0 exposes a glyph of your next telegraph" : ""}.`);
    }
    const damage = plain.steps.find(s => s.code === "RESOLVE_DAMAGE");
    if (damage) summary.push(damage.text);
    // The transformations the modifiers make, in the resolver's words: what
    // REVERSE turned the action into, what WEAKEN did to the magnitude.
    for (const code of ["REVERSE_APPLIED", "REVERSE_MAGNITUDE", "WEAKEN_APPLIED"]) {
        const step = plain.steps.find(s => s.code === code);
        if (step) summary.push(code === "REVERSE_APPLIED" ? `${step.text} The telegraph still shows ${tokens.find(t => t !== "REVERSE" && glyphHelp[t]?.role === "action") ?? "the original action"}.` : step.text);
    }
    const split = plain.steps.some(s => s.code === "SPLIT_APPLIED");
    if (split) {
        const reflectedSplit = cast("reflect");
        const both = reflectedSplit.sealsAwarded?.player && reflectedSplit.sealsAwarded?.opponent;
        summary.push(
            `SPLIT: two branches, each at full magnitude${rules.wardIntegrity > 0 ? " (two dents on a ward)" : ""}.` +
                (both ? ` REFLECT${price("reflect", rules)} turns back only one branch: you keep a seal and ${names.them} takes one too.` : "")
        );
    }

    if (uncontested === "blocked") {
        const ward = state.players[defenderId].ward;
        const dent = plain.steps.find(s => s.code === "WARD_BROKEN" || s.code === "WARD_DENTED");
        summary.push(
            cap(`${names.them}'s ${ward?.essence ? ward.essence.toUpperCase() + "-filtered" : "untyped"} ward blocks this.${dent ? " " + dent.text : ""} Change the essence, or aim at the GATE.`)
        );
        return { glyphs, summary };
    }

    const reflected = classifyOutcome(cast("reflect"), casterId);
    const silenced = cast("silence");
    const anchored = plain.effect?.anchored ?? false;
    const amplified = (plain.effect?.magnitude ?? 1) > 1;
    if (reflected === "opponent-seal" && !split) {
        summary.push(cap(`open to REFLECT${price("reflect", rules)}: ${names.them} could send it back and take the seal instead. ANCHOR would fix the route.`));
    } else if (anchored && plain.effect?.target === "enemy") {
        summary.push(`ANCHOR fixes the route: REFLECT${price("reflect", rules)} fails against this spell.`);
    } else if (plain.effect?.action === "close") {
        summary.push(`Aimed at the GATE: REFLECT and wards cannot touch it; only NULL${price("null", rules)} stops it.`);
    }
    if (amplified || anchored) {
        const stripped = silenced.steps.some(s => s.code === "SILENCE_STRIPPED_MODIFIERS");
        summary.push(
            stripped
                ? `SILENCE${price("silence", rules)} would strip ${[amplified ? "AMPLIFY" : "", anchored ? "ANCHOR" : ""].filter(Boolean).join(" and ")}, but the base spell still lands${rules.wardIntegrity > 0 && amplified ? " (and dents a ward by 1 instead of 2)" : ""}.`
                : "SILENCE finds nothing to strip here."
        );
    }
    if (uncontested !== "no-seal") summary.push(`NULL${price("null", rules)} always cancels it outright.`);
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

/** What the chosen reaction would do against the spell as far as the telegraph reveals it, under the rules. */
export function explainReaction(
    reaction: ReactionGlyph | undefined,
    telegraph: readonly TelegraphSlot[],
    rules: RuleOptions = CLASSIC_RULES,
    focusLeft?: number
): string {
    const seen = shown(telegraph);
    const action = ["SEEK", "BIND", "WARD", "CLOSE", "OPEN", "BREAK", "MEND"].find(a => seen.tokens.has(a));
    const spellName = action ?? "their spell";
    const hiddenNote = seen.hidden > 0 ? ` ${seen.hidden} glyph${seen.hidden > 1 ? "s are" : " is"} hidden.` : "";
    const costNote = (r: ReactionGlyph): string => {
        if (!rules.reactionCosts) return "";
        const p = REACTION_COSTS[r];
        const short = focusLeft !== undefined && focusLeft < p ? ` You have ${focusLeft}: it would fail and the spell lands as if unanswered.` : "";
        return ` Costs ${p} of your Focus, leaving less for your own spell.${short}`;
    };

    if (!reaction) {
        return `No reaction: let ${spellName} resolve as cast. Your wards still apply${rules.reactionCosts ? ", and all 7 Focus go to your spell" : ""}.${hiddenNote}`;
    }
    if (reaction === "null") {
        return `NULL cancels ${spellName} outright, whatever the hidden glyphs are. The hard counter - it also teaches you nothing about the spell.${costNote("null")}${hiddenNote}`;
    }
    if (reaction === "reflect") {
        if (action === "CLOSE" || action === "OPEN" || action === "WARD" || action === "MEND") {
            return `REFLECT against ${action}: nothing to reverse - ${action} has no hostile route (even REVERSEd, a gate spell stays on the gate), so REFLECT is wasted here.${costNote("reflect")}`;
        }
        return `REFLECT: if ${spellName}'s hidden target is ENEMY and it carries no ANCHOR, it returns to its caster and you gain the seal${rules.resolve > 0 ? " (and any Resolve damage)" : ""}. Against SELF, GATE or an ANCHORed route it does nothing.${costNote("reflect")}${hiddenNote}`;
    }
    // silence
    const integrityNote = rules.wardIntegrity > 0 ? " With wards that shatter, stripping AMPLIFY also spares your ward one dent." : "";
    return `SILENCE strips every modifier - AMPLIFY, WEAKEN, SPLIT, REVERSE, ANCHOR - from ${spellName} but the base spell still lands as telegraphed: it undoes a REVERSEd gate trick or a SPLIT, and reopens an ANCHORed route, but never stops a plain seal.${integrityNote}${costNote("silence")}${hiddenNote}`;
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
    const unaffordable = result.steps.find(s => s.code === "REACTION_UNAFFORDABLE");
    if (unaffordable) return `${reactor}'s ${reaction.toUpperCase()} could not be paid: ${unaffordable.text}`;
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
 * opponent's reaction (absent when the match ended mid-round). Rule
 * effects that changed the board - a dented or shattered ward, Resolve
 * damage, an unpaid reaction - get their own line.
 */
export function explainRound(incoming: Contribution, outgoing: Contribution | undefined, names: Names): RoundExplanation {
    const reasons: string[] = [];
    let yours = 0;
    let theirs = 0;

    const describe = (c: Contribution, caster: string, defender: string, casterIsYou: boolean): void => {
        const spell = c.spell.join(" ");
        const outcome = classifyOutcome(c.result, casterIsYou ? "player" : "opponent");
        const effect = c.result.steps.find(s => s.stage === "effect" && s.code !== "RESOLVE_DAMAGE")?.text;
        const damage = c.result.steps.find(s => s.code === "RESOLVE_DAMAGE")?.text;
        // A SPLIT branch turned by REFLECT scores for both sides at once.
        const casterId: PlayerId = casterIsYou ? "player" : "opponent";
        const defenderId: PlayerId = casterIsYou ? "opponent" : "player";
        const awarded = c.result.sealsAwarded ?? (outcome === "player-seal" ? { [casterId]: 1 } : outcome === "opponent-seal" ? { [defenderId]: 1 } : {});
        const casterScored = (awarded[casterId] ?? 0) > 0;
        const defenderScored = (awarded[defenderId] ?? 0) > 0;
        if (casterScored) {
            if (casterIsYou) yours++;
            else theirs++;
            reasons.push(cap(`${caster} gained a seal: ${spell} ${effect ? "- " + effect : "landed."}${damage ? " " + damage : ""}`));
        }
        if (defenderScored) {
            if (casterIsYou) theirs++;
            else yours++;
            reasons.push(cap(`${defender} gained a seal: ${c.reaction?.toUpperCase() ?? "the reaction"} returned ${casterScored ? "one branch of " : ""}${spell} to its caster.${damage && !casterScored ? " " + damage : ""}`));
        }
        if (casterScored || defenderScored) {
            // fallthrough to the reaction note below
        } else if (outcome === "blocked") {
            const ward = c.result.steps.find(s => s.code === "WARD_BROKEN" || s.code === "WARD_DENTED")?.text;
            reasons.push(cap(`${caster}'s ${spell} was blocked by ${defender}'s ward.${ward ? " " + ward : ""}`));
        } else if (outcome === "canceled") {
            reasons.push(cap(`${caster}'s ${spell} was canceled by ${defender}'s NULL.`));
        } else {
            reasons.push(cap(`${caster}'s ${spell} scored nothing${effect ? " - " + effect : "."}`));
        }
        const ignite = c.result.steps.find(s => s.code === "IGNITE_APPLIED" || s.code === "QUICK_CAST");
        if (ignite && outcome !== "canceled") reasons.push(cap(`${caster}: ${ignite.text}`));
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

export type LessonLine = { label: string; outcome: Outcome; text: string };

/**
 * A scenario's documented responses, resolved against the round's opening
 * state under the rules in force - so the lesson never claims something the
 * current ruleset would not do (a Teeth ward may shatter, Resolve may drop).
 */
export function lessonOutcomes(scenario: Scenario, roundStart: DuelState, names: Names): LessonLine[] {
    return scenario.responses.map(response => {
        const result =
            response.reaction !== undefined
                ? resolveEncounter(roundStart, {
                      casterId: "opponent",
                      defenderId: "player",
                      spellTokens: [...scenario.opponentSpell],
                      ...(response.reaction ? { reaction: response.reaction } : {})
                  })
                : resolveEncounter(roundStart, { casterId: "player", defenderId: "opponent", spellTokens: [...(response.spell ?? [])] });
        const outcome = classifyOutcome(result, "player");
        const extras = result.steps
            .filter(s => s.code === "WARD_BROKEN" || s.code === "WARD_DENTED" || s.code === "RESOLVE_DAMAGE" || s.code === "REACTION_UNAFFORDABLE")
            .map(s => s.text);
        const label = response.spell ? `Cast ${response.spell.join(" ")}` : response.label;
        return { label, outcome, text: `${label} → ${outcomeText(outcome, names)}${extras.length ? " · " + extras.join(" ") : ""}` };
    });
}
