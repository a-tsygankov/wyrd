import { parseSpell } from "../../wyrd-grammar/src/parser.js";
import type { SpellNode } from "../../wyrd-grammar/src/types.js";
import type {
    DuelState,
    PlayerId,
    ReactionGlyph,
    ResolutionContext,
    ResolutionResult,
    ResolutionStep,
    ResolvedEffect
} from "./types.js";

type FlattenedSpell = {
    action?: ResolvedEffect["action"];
    target?: ResolvedEffect["target"];
    essence?: string;
    modifiers: string[];
};

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
    if (!["seek", "bind", "ward", "close"].includes(action)) {
        throw new Error("Unsupported POC action: " + action);
    }

    const targetNode =
        node.arguments.target as SpellNode | undefined ??
        node.arguments.boundary as SpellNode | undefined;

    return {
        action: action as ResolvedEffect["action"],
        target: valueGlyphId(targetNode) as ResolvedEffect["target"] | undefined,
        essence:
            valueGlyphId(node.arguments.essence as SpellNode | undefined) ??
            valueGlyphId(node.arguments.filter as SpellNode | undefined),
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

export function createInitialDuelState(): DuelState {
    return {
        round: 1,
        activePlayerId: "player",
        players: {
            player: { id: "player", focus: 7, seals: 0 },
            opponent: { id: "opponent", focus: 7, seals: 0 }
        }
    };
}

export function resolveEncounter(
    state: DuelState,
    context: ResolutionContext
): ResolutionResult {
    const next = cloneState(state);
    const steps: ResolutionStep[] = [];
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

    applyReaction(effect, context.reaction, steps);

    if (effect.canceled) {
        return { state: next, effect, steps };
    }

    const targetPlayerId: PlayerId = effect.reflected
        ? context.casterId
        : context.defenderId;

    const scoringPlayerId: PlayerId = effect.reflected
        ? context.defenderId
        : context.casterId;

    const targetPlayer = next.players[targetPlayerId];

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
            return { state: next, effect, steps };
        }
    }

    switch (effect.action) {
        case "ward": {
            const ownerId =
                effect.target === "enemy" ? context.defenderId : context.casterId;
            next.players[ownerId].ward = {
                ownerId,
                ...(effect.essence ? { essence: effect.essence } : {})
            };
            addStep(
                steps,
                "effect",
                "applied",
                "WARD_CREATED",
                effect.essence
                    ? "A " + effect.essence.toUpperCase() + "-filtered WARD is active."
                    : "A WARD is active."
            );
            break;
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
            break;

        case "close":
            if (effect.target !== "gate") {
                addStep(
                    steps,
                    "effect",
                    "failed",
                    "CLOSE_REQUIRES_GATE",
                    "CLOSE requires a GATE in the POC rules."
                );
                return { state: next, effect, steps };
            }
            addStep(
                steps,
                "effect",
                "applied",
                "GATE_CLOSED",
                "The GATE was closed."
            );
            break;
    }

    const awardsSeal =
        effect.action === "seek" ||
        effect.action === "bind" ||
        effect.action === "close";

    if (awardsSeal) {
        next.players[scoringPlayerId].seals += 1;
        addStep(
            steps,
            "outcome",
            "applied",
            "SEAL_AWARDED",
            scoringPlayerId + " gains 1 seal."
        );
        return {
            state: next,
            effect,
            steps,
            sealAwardedTo: scoringPlayerId
        };
    }

    addStep(
        steps,
        "outcome",
        "info",
        "NO_SEAL",
        "No seal was awarded this encounter."
    );

    return { state: next, effect, steps };
}
