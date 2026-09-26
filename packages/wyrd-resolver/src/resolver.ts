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
    modifiers: string[];
};

const POC_ACTIONS: readonly SpellAction[] = ["seek", "bind", "ward", "close", "open", "break", "mend"];

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

function addStep(
    steps: ResolutionStep[],
    stage: ResolutionStep["stage"],
    result: ResolutionStep["result"],
    code: string,
    text: string
): void {
    steps.push({ stage, result, code, text });
}

function applyReaction(
    effect: ResolvedEffect,
    reaction: ReactionGlyph | undefined,
    steps: ResolutionStep[]
): void {
    if (reaction === "null") {
        effect.canceled = true;
        addStep(steps, "cancel", "canceled", "NULL_CANCELED", "NULL canceled the spell before it resolved.");
        return;
    }

    if (effect.anchored) {
        addStep(steps, "anchor", "info", "ANCHOR_ACTIVE", "ANCHOR fixed the spell's route.");
    }

    if (reaction === "reflect") {
        if (effect.anchored) {
            addStep(
                steps,
                "routing",
                "blocked",
                "REFLECT_BLOCKED_BY_ANCHOR",
                "REFLECT failed because ANCHOR fixed the spell's route."
            );
        } else if (effect.target === "enemy") {
            effect.reflected = true;
            effect.target = "self";
            addStep(
                steps,
                "routing",
                "applied",
                "REFLECT_APPLIED",
                "REFLECT redirected the spell back toward its caster."
            );
        } else {
            addStep(
                steps,
                "routing",
                "failed",
                "REFLECT_NO_HOSTILE_ROUTE",
                "REFLECT had no hostile route to reverse."
            );
        }
    }

    if (reaction === "silence") {
        if (effect.magnitude > 1 || effect.anchored) {
            effect.magnitude = 1;
            effect.anchored = false;
            effect.silenced = true;
            addStep(
                steps,
                "suppression",
                "applied",
                "SILENCE_STRIPPED_MODIFIERS",
                "SILENCE stripped non-core modifiers; the base spell remains."
            );
        } else {
            effect.silenced = true;
            addStep(
                steps,
                "suppression",
                "info",
                "SILENCE_NO_MODIFIERS",
                "SILENCE found no active modifier to strip."
            );
        }
    }
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
        addStep(
            steps,
            "validation",
            "failed",
            "NO_BASE_ACTION",
            "The POC resolver requires a supported base action."
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

    const effect: ResolvedEffect = {
        action: flat.action,
        ...(flat.target ? { target: flat.target } : {}),
        ...(flat.essence ? { essence: flat.essence } : {}),
        magnitude: flat.modifiers.includes("amplify") ? 2 : 1,
        anchored: flat.modifiers.includes("anchor"),
        reflected: false,
        silenced: false,
        canceled: false
    };

    if (effect.magnitude > 1) {
        addStep(
            steps,
            "magnitude",
            "applied",
            "AMPLIFY_APPLIED",
            "AMPLIFY increased the spell's magnitude."
        );
    }
    if (rules.ignite && effect.essence && caster.lastEssence === effect.essence) {
        effect.magnitude += 1;
        addStep(steps, "magnitude", "applied", "IGNITE_APPLIED", `${effect.essence.toUpperCase()} again: ignite adds +1 magnitude.`);
    }
    if (rules.quickCast && context.quickCast) {
        effect.magnitude += 1;
        addStep(steps, "magnitude", "applied", "QUICK_CAST", "Quick cast: +1 magnitude for committing fast.");
    }
    // The essence memory is per caster and per resolved spell: an untyped
    // spell forgets it.
    if (rules.ignite) {
        if (effect.essence) caster.lastEssence = effect.essence;
        else delete caster.lastEssence;
    }

    applyReaction(effect, reaction, steps);

    const finish = (result: Omit<ResolutionResult, "state">): ResolutionResult => {
        if (rules.reactionCosts) {
            for (const id of ["player", "opponent"] as const) next.players[id].exposed = next.players[id].focus === 0;
        }
        updateFaltering(caster, rules);
        updateFaltering(defender, rules);
        return { state: next, ...result };
    };

    const noSeal = (): ResolutionResult => {
        addStep(steps, "outcome", "info", "NO_SEAL", "No seal was awarded this encounter.");
        return finish({ effect, steps });
    };

    if (effect.canceled) {
        return finish({ effect, steps });
    }

    // Who the effect lands on follows the target glyph: SELF stays with the
    // caster, ENEMY (or a REFLECTed ENEMY, which becomes SELF+reflected)
    // crosses to the other side.
    const landsOnCaster = effect.reflected || effect.target === "self";
    const targetPlayerId: PlayerId = landsOnCaster ? context.casterId : context.defenderId;

    const scoringPlayerId: PlayerId = effect.reflected
        ? context.defenderId
        : context.casterId;

    const targetPlayer = next.players[targetPlayerId];

    // --- The gate: a contested objective. CLOSE scores while open, OPEN while
    // closed; BREAK shatters it (no seal) and MEND repairs it (no seal).
    if (effect.target === "gate") {
        switch (effect.action) {
            case "close":
            case "open": {
                if (next.gate === "broken") {
                    addStep(steps, "effect", "failed", "GATE_BROKEN", "The GATE lies shattered; MEND it before it can be opened or closed.");
                    return noSeal();
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
                    return noSeal();
                }
                next.gate = wants;
                addStep(steps, "effect", "applied", wants === "closed" ? "GATE_CLOSED" : "GATE_OPENED", `The GATE was ${wants === "closed" ? "closed" : "opened"}.`);
                next.players[scoringPlayerId].seals += 1;
                addStep(steps, "outcome", "applied", "SEAL_AWARDED", scoringPlayerId + " gains 1 seal.");
                return finish({ effect, steps, sealAwardedTo: scoringPlayerId });
            }
            case "break": {
                if (next.gate === "broken") {
                    addStep(steps, "effect", "info", "NOTHING_TO_BREAK", "The GATE is already shattered.");
                    return noSeal();
                }
                next.gate = "broken";
                addStep(steps, "effect", "applied", "GATE_SHATTERED", "BREAK shattered the GATE: no seals from it until it is MENDed.");
                return noSeal();
            }
            case "mend": {
                if (next.gate !== "broken") {
                    addStep(steps, "effect", "info", "NOTHING_TO_MEND", "The GATE is whole; nothing to mend.");
                    return noSeal();
                }
                next.gate = "open";
                addStep(steps, "effect", "applied", "GATE_MENDED", "MEND restored the GATE; it stands open again.");
                return noSeal();
            }
            default:
                addStep(steps, "effect", "failed", "GATE_NOT_A_TARGET", `${effect.action.toUpperCase()} cannot be aimed at the GATE.`);
                return noSeal();
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
        return noSeal();
    }

    // --- BREAK on a mage: the anti-ward. Never blocked by the ward it breaks.
    if (effect.action === "break") {
        if (!targetPlayer.ward) {
            addStep(steps, "effect", "info", "NOTHING_TO_BREAK", `${targetPlayerId} has no ward to break.`);
            return noSeal();
        }
        delete targetPlayer.ward;
        addStep(steps, "effect", "applied", "WARD_BROKEN", `BREAK shattered ${targetPlayerId}'s WARD; the way is open.`);
        return noSeal();
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
        return noSeal();
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
            if (rules.wardIntegrity > 0) {
                const remaining = (ward.integrity ?? rules.wardIntegrity) - effect.magnitude;
                if (remaining <= 0) {
                    delete targetPlayer.ward;
                    addStep(steps, "boundary", "applied", "WARD_BROKEN", "The WARD shattered under the blow; it is gone.");
                } else {
                    ward.integrity = remaining;
                    addStep(steps, "boundary", "info", "WARD_DENTED", `The WARD held but is dented: integrity ${remaining}.`);
                }
            }
            return finish({ effect, steps });
        }
    }

    switch (effect.action) {
        case "ward": {
            const ownerId =
                effect.target === "enemy" ? context.defenderId : context.casterId;
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
            return noSeal();
        }

        case "bind":
            targetPlayer.bound = true;
            addStep(
                steps,
                "effect",
                "applied",
                "BIND_APPLIED",
                targetPlayerId + " is BOUND."
            );
            break;

        case "seek":
            addStep(
                steps,
                "effect",
                "applied",
                "SEEK_HIT",
                "SEEK reached " + targetPlayerId + " with magnitude " + effect.magnitude + "."
            );
            if (rules.resolve > 0 && targetPlayer.resolve !== undefined) {
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
    if (reachedOpponent) {
        next.players[scoringPlayerId].seals += 1;
        addStep(
            steps,
            "outcome",
            "applied",
            "SEAL_AWARDED",
            scoringPlayerId + " gains 1 seal."
        );
        return finish({ effect, steps, sealAwardedTo: scoringPlayerId });
    }

    return noSeal();
}
