import { glyphRegistry } from "../../wyrd-content/src/glyphs.js";
import { parseSpell } from "../../wyrd-grammar/src/parser.js";
import type { SpellNode } from "../../wyrd-grammar/src/types.js";
import {
    BOUND_TAX,
    CLASSIC_RULES,
    FALTERING_AT,
    MEND_RESOLVE,
    REACTION_COSTS,
    ROUND_FOCUS,
    type DuelState,
    type PlayerId,
    type PlayerState,
    type ReactionGlyph,
    type ResolutionContext,
    type ResolutionResult,
    type ResolutionStep,
    type ResolvedEffect,
    type RuleOptions,
    type SpellAction
} from "./types.js";

type FlattenedSpell = {
    action?: SpellAction;
    target?: ResolvedEffect["target"];
    essence?: string;
    /** Postfix modifiers, innermost first (the order they were written). */
    modifiers: string[];
};

const POC_ACTIONS: readonly SpellAction[] = ["seek", "bind", "ward", "close", "open", "break", "mend"];
/** Glyphs that parse as postfix modifiers but are reactions in the duel loop. */
const REACTION_MODIFIERS: readonly string[] = ["reflect", "silence", "null"];
/** What SILENCE strips: every non-core modifier (spec §10 SILENCE). */
const STRIPPABLE: readonly string[] = ["amplify", "weaken", "split", "reverse", "anchor"];

function cloneState(state: DuelState): DuelState {
    return structuredClone(state);
}

function valueGlyphId(node: SpellNode | undefined): string | undefined {
    return node?.kind === "value" ? node.glyphId : undefined;
}

function flatten(node: SpellNode): FlattenedSpell {
    if (node.kind === "modifier") {
        const inner = flatten(node.child);
        return {
            ...inner,
            modifiers: [...inner.modifiers, node.glyphId]
        };
    }

    if (node.kind === "conditional") {
        throw new Error("Conditional spells are not part of the first duel POC.");
    }

    if (node.kind === "value") {
        return { modifiers: [] };
    }

    const action = node.glyphId;
    if (!(POC_ACTIONS as readonly string[]).includes(action)) {
        throw new Error("Unsupported POC action: " + action);
    }

    const targetNode =
        node.arguments.target as SpellNode | undefined ??
        node.arguments.boundary as SpellNode | undefined;

    const target = valueGlyphId(targetNode) as ResolvedEffect["target"] | undefined;
    const essence =
        valueGlyphId(node.arguments.essence as SpellNode | undefined) ??
        valueGlyphId(node.arguments.filter as SpellNode | undefined);

    return {
        action: action as SpellAction,
        ...(target ? { target } : {}),
        ...(essence ? { essence } : {}),
        modifiers: []
    };
}

/** The registry's inverse for a POC action (spec §10 REVERSE table), if it is itself a POC action. */
function inverseAction(action: SpellAction): SpellAction | undefined {
    const inverse = glyphRegistry.get(action)?.inverseOf;
    return inverse && (POC_ACTIONS as readonly string[]).includes(inverse) ? (inverse as SpellAction) : undefined;
}

function addStep(
    steps: ResolutionStep[],
    stage: ResolutionStep["stage"],
    result: ResolutionStep["result"],
    code: string,
    text: string
): void {
    steps.push({ stage, result, code, text });
}

function newPlayer(id: PlayerId, rules: RuleOptions): PlayerState {
    return {
        id,
        focus: ROUND_FOCUS,
        seals: 0,
        ...(rules.resolve > 0 ? { resolve: rules.resolve, faltering: false } : {})
    };
}

export function createInitialDuelState(rules: RuleOptions = CLASSIC_RULES): DuelState {
    return {
        round: 1,
        activePlayerId: "player",
        players: {
            player: newPlayer("player", rules),
            opponent: newPlayer("opponent", rules)
        },
        rules: { ...rules },
        gate: "open"
    };
}

/**
 * Advance to the next round: Focus refills for both, everything else
 * carries over. `exposed` stays set for exactly the round after a player
 * ran dry; the next encounter re-evaluates it.
 */
export function beginNextRound(state: DuelState): DuelState {
    const next = cloneState(state);
    next.round += 1;
    for (const id of ["player", "opponent"] as const) next.players[id].focus = ROUND_FOCUS;
    return next;
}

/** Focus the caster will pay for this spell under the state's rules (0 when Focus is not tracked). */
export function spellFocusCost(state: DuelState, casterId: PlayerId, parsedFocusCost: number): number {
    if (!state.rules.reactionCosts) return 0;
    const tax = state.rules.resolve > 0 && state.players[casterId].bound ? BOUND_TAX : 0;
    return parsedFocusCost + tax;
}

/** Spend Focus outside a resolution (Scry); never below 0, and it marks exposure like a resolution would. */
export function spendFocus(state: DuelState, id: PlayerId, amount: number): DuelState {
    const next = cloneState(state);
    const player = next.players[id];
    player.focus = Math.max(0, player.focus - amount);
    if (next.rules.reactionCosts) player.exposed = player.focus === 0;
    return next;
}

function updateFaltering(player: PlayerState, rules: RuleOptions): void {
    if (rules.resolve > 0 && player.resolve !== undefined) player.faltering = player.resolve <= FALTERING_AT;
}

type Encounter = {
    state: DuelState;
    casterId: PlayerId;
    defenderId: PlayerId;
    rules: RuleOptions;
    steps: ResolutionStep[];
    /** Set while a SPLIT spell resolves, so each branch's steps are tagged. */
    branch?: number;
};

/**
 * Boundary interaction and base effect for one branch (spec §11 stages
 * 8–9). Returns who the branch scored for, if anyone. SPLIT runs this once
 * per branch against the same evolving state, so the second branch of a
 * gate spell finds the gate already moved.
 */
function applyBranch(effect: ResolvedEffect, e: Encounter): PlayerId | undefined {
    const { state: next, rules, steps } = e;
    // Who the effect lands on follows the target glyph: SELF stays with the
    // caster, ENEMY (or a REFLECTed ENEMY, which becomes SELF+reflected)
    // crosses to the other side.
    const landsOnCaster = effect.reflected || effect.target === "self";
    const targetPlayerId: PlayerId = landsOnCaster ? e.casterId : e.defenderId;
    const scoringPlayerId: PlayerId = effect.reflected ? e.defenderId : e.casterId;
    const targetPlayer = next.players[targetPlayerId];

    // --- The gate: a contested objective. CLOSE scores while open, OPEN while
    // closed; BREAK shatters it (no seal) and MEND repairs it (no seal).
    if (effect.target === "gate") {
        switch (effect.action) {
            case "close":
            case "open": {
                if (next.gate === "broken") {
                    addStep(steps, "effect", "failed", "GATE_BROKEN", "The GATE lies shattered; MEND it before it can be opened or closed.");
                    return undefined;
                }
                const wants: DuelState["gate"] = effect.action === "close" ? "closed" : "open";
                if (next.gate === wants) {
                    addStep(
                        steps,
                        "effect",
                        "failed",
                        wants === "closed" ? "GATE_ALREADY_CLOSED" : "GATE_ALREADY_OPEN",
                        `The GATE is already ${wants}; nothing to ${effect.action}.`
                    );
                    return undefined;
                }
                next.gate = wants;
                addStep(steps, "effect", "applied", wants === "closed" ? "GATE_CLOSED" : "GATE_OPENED", `The GATE was ${wants === "closed" ? "closed" : "opened"}.`);
                return scoringPlayerId;
            }
            case "break": {
                if (next.gate === "broken") {
                    addStep(steps, "effect", "info", "NOTHING_TO_BREAK", "The GATE is already shattered.");
                    return undefined;
                }
                next.gate = "broken";
                addStep(steps, "effect", "applied", "GATE_SHATTERED", "BREAK shattered the GATE: no seals from it until it is MENDed.");
                return undefined;
            }
            case "mend": {
                if (next.gate !== "broken") {
                    addStep(steps, "effect", "info", "NOTHING_TO_MEND", "The GATE is whole; nothing to mend.");
                    return undefined;
                }
                next.gate = "open";
                addStep(steps, "effect", "applied", "GATE_MENDED", "MEND restored the GATE; it stands open again.");
                return undefined;
            }
            default:
                addStep(steps, "effect", "failed", "GATE_NOT_A_TARGET", `${effect.action.toUpperCase()} cannot be aimed at the GATE.`);
                return undefined;
        }
    }

    if (effect.action === "close" || effect.action === "open") {
        addStep(
            steps,
            "effect",
            "failed",
            effect.action === "close" ? "CLOSE_REQUIRES_GATE" : "OPEN_REQUIRES_GATE",
            `${effect.action.toUpperCase()} requires a GATE in the POC rules.`
        );
        return undefined;
    }

    // --- BREAK on a mage: the anti-ward. Never blocked by the ward it breaks.
    if (effect.action === "break") {
        if (!targetPlayer.ward) {
            addStep(steps, "effect", "info", "NOTHING_TO_BREAK", `${targetPlayerId} has no ward to break.`);
            return undefined;
        }
        delete targetPlayer.ward;
        addStep(steps, "effect", "applied", "WARD_BROKEN", `BREAK shattered ${targetPlayerId}'s WARD; the way is open.`);
        return undefined;
    }

    // --- MEND on a mage: ward integrity back to full, Resolve back by a little.
    if (effect.action === "mend") {
        let mended = false;
        if (targetPlayer.ward && rules.wardIntegrity > 0 && (targetPlayer.ward.integrity ?? rules.wardIntegrity) < rules.wardIntegrity) {
            targetPlayer.ward.integrity = rules.wardIntegrity;
            addStep(steps, "effect", "applied", "WARD_MENDED", `MEND restored ${targetPlayerId}'s WARD to integrity ${rules.wardIntegrity}.`);
            mended = true;
        }
        if (rules.resolve > 0 && targetPlayer.resolve !== undefined && targetPlayer.resolve < rules.resolve) {
            targetPlayer.resolve = Math.min(rules.resolve, targetPlayer.resolve + MEND_RESOLVE);
            addStep(steps, "effect", "applied", "RESOLVE_MENDED", `${targetPlayerId}'s resolve rises by ${MEND_RESOLVE} to ${targetPlayer.resolve}.`);
            mended = true;
        }
        if (!mended) addStep(steps, "effect", "info", "NOTHING_TO_MEND", `${targetPlayerId} has nothing to mend.`);
        return undefined;
    }

    if (effect.action !== "ward") {
        const ward = targetPlayer.ward;
        const hostilePlayerTarget =
            effect.target === "enemy" ||
            (effect.reflected && effect.target === "self");

        if (
            hostilePlayerTarget &&
            ward &&
            (!ward.essence || !effect.essence || ward.essence === effect.essence)
        ) {
            addStep(
                steps,
                "boundary",
                "blocked",
                "WARD_BLOCKED",
                ward.essence
                    ? "WARD blocked the " + (effect.essence ?? "untyped") + " spell."
                    : "WARD blocked the incoming spell."
            );
            // Ward integrity: the blocked spell still wears the ward down by
            // its magnitude; at 0 it shatters and the NEXT hit gets through.
            if (rules.wardIntegrity > 0 && effect.magnitude > 0) {
                const remaining = (ward.integrity ?? rules.wardIntegrity) - effect.magnitude;
                if (remaining <= 0) {
                    delete targetPlayer.ward;
                    addStep(steps, "boundary", "applied", "WARD_BROKEN", "The WARD shattered under the blow; it is gone.");
                } else {
                    ward.integrity = remaining;
                    addStep(steps, "boundary", "info", "WARD_DENTED", `The WARD held but is dented: integrity ${remaining}.`);
                }
            }
            return undefined;
        }
    }

    switch (effect.action) {
        case "ward": {
            const ownerId = effect.target === "enemy" ? e.defenderId : e.casterId;
            const owner = next.players[ownerId];
            // Faltering players raise brittle wards. Read resolve directly:
            // the flag is only refreshed when the encounter finishes.
            const brittle = rules.resolve > 0 && (owner.resolve ?? Number.POSITIVE_INFINITY) <= FALTERING_AT;
            const integrity = rules.wardIntegrity > 0 ? (brittle ? Math.min(1, rules.wardIntegrity) : rules.wardIntegrity) : undefined;
            owner.ward = {
                ownerId,
                ...(effect.essence ? { essence: effect.essence } : {}),
                ...(integrity !== undefined ? { integrity } : {})
            };
            addStep(
                steps,
                "effect",
                "applied",
                "WARD_CREATED",
                (effect.essence
                    ? "A " + effect.essence.toUpperCase() + "-filtered WARD is active."
                    : "A WARD is active.") + (integrity !== undefined ? ` Integrity ${integrity}.` : "")
            );
            return undefined;
        }

        case "bind":
            targetPlayer.bound = true;
            addStep(steps, "effect", "applied", "BIND_APPLIED", targetPlayerId + " is BOUND.");
            break;

        case "seek":
            addStep(
                steps,
                "effect",
                "applied",
                "SEEK_HIT",
                "SEEK reached " + targetPlayerId + " with magnitude " + effect.magnitude + "."
            );
            if (rules.resolve > 0 && targetPlayer.resolve !== undefined && effect.magnitude > 0) {
                targetPlayer.resolve = Math.max(0, targetPlayer.resolve - effect.magnitude);
                addStep(
                    steps,
                    "effect",
                    "applied",
                    "RESOLVE_DAMAGE",
                    `${targetPlayerId}'s resolve drops by ${effect.magnitude} to ${targetPlayer.resolve}.`
                );
            }
            break;
    }

    // Seals reward reaching the other side. A spell that lands on its own
    // caster - SELF-targeted, or REFLECTed back - scores for whoever it
    // landed against: nobody for SELF, the reflector for REFLECT.
    const reachedOpponent = effect.reflected || effect.target === "enemy";
    return reachedOpponent ? scoringPlayerId : undefined;
}

/** applyBranch collects its steps locally; this tags and appends them. */
function runBranch(effect: ResolvedEffect, e: Encounter, index: number | undefined): PlayerId | undefined {
    const local: Encounter = { ...e, steps: [] };
    const scorer = applyBranch(effect, local);
    for (const step of local.steps) e.steps.push(index === undefined ? step : { ...step, branch: index });
    return scorer;
}

export function resolveEncounter(
    state: DuelState,
    context: ResolutionContext
): ResolutionResult {
    const next = cloneState(state);
    const rules: RuleOptions = next.rules ?? CLASSIC_RULES;
    next.rules = rules;
    next.gate ??= "open";
    const steps: ResolutionStep[] = [];
    const caster = next.players[context.casterId];
    const defender = next.players[context.defenderId];
    const parsed = parseSpell(context.spellTokens);

    if (parsed.status !== "valid" || !parsed.ast) {
        addStep(
            steps,
            "validation",
            "failed",
            "INVALID_SPELL",
            parsed.diagnostics[0]?.message ?? "Spell is invalid."
        );
        return { state: next, steps };
    }

    addStep(
        steps,
        "validation",
        "applied",
        "SPELL_VALID",
        "Spell parsed successfully (Focus " + parsed.focusCost + ")."
    );

    let flat: FlattenedSpell;
    try {
        flat = flatten(parsed.ast);
    } catch (error) {
        addStep(
            steps,
            "validation",
            "failed",
            "UNSUPPORTED_POC_SPELL",
            error instanceof Error ? error.message : "Unsupported POC spell."
        );
        return { state: next, steps };
    }

    if (!flat.action) {
        const reaction = flat.modifiers.find(m => REACTION_MODIFIERS.includes(m));
        addStep(
            steps,
            "validation",
            "failed",
            "NO_BASE_ACTION",
            reaction
                ? `${reaction.toUpperCase()} is a reaction: choose it in the reaction row, it is not cast as a spell.`
                : "The POC resolver requires a supported base action."
        );
        return { state: next, steps };
    }

    // REVERSE needs something to invert (spec §10: "if an effect has no
    // inverse mapping, REVERSE is invalid for that effect").
    const hasMagnitudeModifier = flat.modifiers.includes("amplify") || flat.modifiers.includes("weaken");
    if (flat.modifiers.includes("reverse") && !inverseAction(flat.action) && !hasMagnitudeModifier) {
        addStep(
            steps,
            "validation",
            "failed",
            "REVERSE_NO_INVERSE",
            `${flat.action.toUpperCase()} has no inverse; REVERSE cannot apply to it.`
        );
        return { state: next, steps };
    }

    // --- Focus accounting (rules.reactionCosts). The caster pays the spell;
    // a bound caster under the resolve rule pays the BIND tax on top and is
    // freed by it. The defender pays for the reaction or does not get it.
    let reaction = context.reaction;
    if (rules.reactionCosts) {
        const tax = rules.resolve > 0 && caster.bound ? BOUND_TAX : 0;
        caster.focus = Math.max(0, caster.focus - parsed.focusCost - tax);
        if (tax > 0) {
            caster.bound = false;
            addStep(steps, "cost", "applied", "BOUND_TAX", `Being BOUND cost ${tax} extra Focus for this spell.`);
        }
        if (reaction) {
            const price = REACTION_COSTS[reaction];
            if (defender.focus < price) {
                addStep(
                    steps,
                    "cost",
                    "failed",
                    "REACTION_UNAFFORDABLE",
                    `${reaction.toUpperCase()} costs ${price} Focus; only ${defender.focus} left - no reaction.`
                );
                reaction = undefined;
            } else {
                defender.focus -= price;
                addStep(steps, "cost", "applied", "REACTION_PAID", `${reaction.toUpperCase()} cost ${price} Focus (${defender.focus} left).`);
            }
        }
    }

    // The modifiers in force; SILENCE empties this set.
    const active = new Set(flat.modifiers);
    const baseMagnitude = (): number => Math.max(0, 1 + (active.has("amplify") ? 1 : 0) - (active.has("weaken") ? 1 : 0));
    // Rule bonuses are not modifiers: SILENCE cannot strip an ignite.
    let bonus = 0;

    const effect: ResolvedEffect = {
        action: flat.action,
        ...(flat.target ? { target: flat.target } : {}),
        ...(flat.essence ? { essence: flat.essence } : {}),
        magnitude: baseMagnitude(),
        anchored: active.has("anchor"),
        reflected: false,
        silenced: false,
        canceled: false
    };

    if (active.has("amplify")) {
        addStep(steps, "magnitude", "applied", "AMPLIFY_APPLIED", "AMPLIFY increased the spell's magnitude.");
    }
    if (active.has("weaken")) {
        addStep(
            steps,
            "magnitude",
            "applied",
            "WEAKEN_APPLIED",
            active.has("amplify") ? "WEAKEN cancelled AMPLIFY; the spell lands at magnitude 1." : "WEAKEN lowered the spell to magnitude 0: it reaches, but dents and wounds nothing."
        );
    }
    if (rules.ignite && effect.essence && caster.lastEssence === effect.essence) {
        bonus += 1;
        addStep(steps, "magnitude", "applied", "IGNITE_APPLIED", `${effect.essence.toUpperCase()} again: ignite adds +1 magnitude.`);
    }
    if (rules.quickCast && context.quickCast) {
        bonus += 1;
        addStep(steps, "magnitude", "applied", "QUICK_CAST", "Quick cast: +1 magnitude for committing fast.");
    }
    effect.magnitude = baseMagnitude() + bonus;
    // The essence memory is per caster and per resolved spell: an untyped
    // spell forgets it.
    if (rules.ignite) {
        if (effect.essence) caster.lastEssence = effect.essence;
        else delete caster.lastEssence;
    }

    const finish = (result: Omit<ResolutionResult, "state">): ResolutionResult => {
        if (rules.reactionCosts) {
            for (const id of ["player", "opponent"] as const) next.players[id].exposed = next.players[id].focus === 0;
        }
        updateFaltering(caster, rules);
        updateFaltering(defender, rules);
        return { state: next, ...result };
    };

    // --- Stage: cancellation. NULL takes the whole spell, branches and all.
    if (reaction === "null") {
        effect.canceled = true;
        addStep(steps, "cancel", "canceled", "NULL_CANCELED", "NULL canceled the spell before it resolved.");
        return finish({ effect, steps });
    }

    if (effect.anchored) {
        addStep(steps, "anchor", "info", "ANCHOR_ACTIVE", "ANCHOR fixed the spell's route.");
    }

    // --- Stage: routing. REFLECT turns the hostile route home; against a
    // SPLIT it turns back one branch only (spec §12 "REFLECT vs SPLIT").
    let reflectOne = false;
    if (reaction === "reflect") {
        if (effect.anchored) {
            addStep(steps, "routing", "blocked", "REFLECT_BLOCKED_BY_ANCHOR", "REFLECT failed because ANCHOR fixed the spell's route.");
        } else if (effect.target === "enemy") {
            reflectOne = true;
            addStep(
                steps,
                "routing",
                "applied",
                "REFLECT_APPLIED",
                active.has("split") ? "REFLECT redirected one branch back toward its caster; the other flies on." : "REFLECT redirected the spell back toward its caster."
            );
        } else {
            addStep(steps, "routing", "failed", "REFLECT_NO_HOSTILE_ROUTE", "REFLECT had no hostile route to reverse.");
        }
    }

    // --- Stage: suppression. SILENCE strips every modifier; the base spell,
    // as telegraphed, is what lands. The ignite bonus is a rule, and stays.
    if (reaction === "silence") {
        const stripped = [...active].filter(m => STRIPPABLE.includes(m));
        effect.silenced = true;
        if (stripped.length > 0) {
            for (const m of stripped) active.delete(m);
            effect.anchored = false;
            effect.magnitude = baseMagnitude() + bonus;
            addStep(
                steps,
                "suppression",
                "applied",
                "SILENCE_STRIPPED_MODIFIERS",
                `SILENCE stripped ${stripped.map(m => m.toUpperCase()).join(", ")}; the base spell remains.`
            );
        } else {
            addStep(steps, "suppression", "info", "SILENCE_NO_MODIFIERS", "SILENCE found no active modifier to strip.");
        }
    }

    // --- Stage: semantic transformation. REVERSE swaps the action for its
    // inverse, or failing that flips AMPLIFY and WEAKEN. ANCHOR does not
    // interfere: it protects the route, not the meaning (spec §12).
    if (active.has("reverse")) {
        const inverse = inverseAction(effect.action);
        if (inverse) {
            addStep(steps, "transform", "applied", "REVERSE_APPLIED", `REVERSE changed ${effect.action.toUpperCase()} into ${inverse.toUpperCase()}.`);
            effect.action = inverse;
        } else if (active.has("amplify")) {
            active.delete("amplify");
            active.add("weaken");
            effect.magnitude = baseMagnitude() + bonus;
            addStep(steps, "transform", "applied", "REVERSE_MAGNITUDE", "REVERSE turned AMPLIFY into WEAKEN.");
        } else if (active.has("weaken")) {
            active.delete("weaken");
            active.add("amplify");
            effect.magnitude = baseMagnitude() + bonus;
            addStep(steps, "transform", "applied", "REVERSE_MAGNITUDE", "REVERSE turned WEAKEN into AMPLIFY.");
        }
    }

    // SPLIT: two branches that resolve one after the other against the same
    // board. The reflected one, if any, is the second.
    const branches: ResolvedEffect[] = [effect];
    if (active.has("split")) {
        branches.push({ ...effect });
        addStep(steps, "transform", "applied", "SPLIT_APPLIED", "SPLIT created two branches; each resolves on its own.");
    }
    if (reflectOne) {
        const turned = branches[branches.length - 1] as ResolvedEffect;
        turned.reflected = true;
        turned.target = "self";
    }

    const encounter: Encounter = { state: next, casterId: context.casterId, defenderId: context.defenderId, rules, steps };
    // One seal per side per encounter, however many branches reach.
    const sealsAwarded: Partial<Record<PlayerId, number>> = {};
    for (const [index, branch] of branches.entries()) {
        const scorer = runBranch(branch, encounter, branches.length > 1 ? index : undefined);
        if (scorer && !sealsAwarded[scorer]) {
            sealsAwarded[scorer] = 1;
            next.players[scorer].seals += 1;
            addStep(steps, "outcome", "applied", "SEAL_AWARDED", scorer + " gains 1 seal.");
        }
    }

    const sealAwardedTo: PlayerId | undefined = sealsAwarded[context.casterId]
        ? context.casterId
        : sealsAwarded[context.defenderId]
            ? context.defenderId
            : undefined;
    if (!sealAwardedTo) {
        addStep(steps, "outcome", "info", "NO_SEAL", "No seal was awarded this encounter.");
    }
    return finish({
        effect,
        ...(branches.length > 1 ? { branches } : {}),
        steps,
        ...(sealAwardedTo ? { sealAwardedTo, sealsAwarded } : {})
    });
}
