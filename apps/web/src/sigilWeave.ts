import type { ParryOutcome } from "./strokeDuel.js";
import type { Rune } from "./runeDuel.js";

export type WeaveRecipeId = "aegis" | "breach" | "mirror";
export type WeaveMode = WeaveRecipeId | "free";

export type WeaveStep = {
    rune: Rune;
    anchor: number;
    label: string;
    reason: string;
};

export type WeaveRecipe = {
    id: WeaveRecipeId;
    name: string;
    subtitle: string;
    difficulty: "INTRO" | "TACTICAL" | "ADVANCED";
    effect: string;
    steps: readonly WeaveStep[];
    /** Trigger Arcade Parry after these placement counts. */
    parryAt: readonly number[];
};

export const WEAVE_RECIPES: readonly WeaveRecipe[] = [
    {
        id: "aegis",
        name: "AEGIS SPIRAL",
        subtitle: "Build a ward, bend pressure away, then lock it with power.",
        difficulty: "INTRO",
        effect: "A stable ward that redirects incoming force around the caster.",
        steps: [
            { rune: "circle", anchor: 0, label: "WARD", reason: "Contain the field at the crown." },
            { rune: "arc", anchor: 2, label: "REDIRECT", reason: "Give the ward a route for incoming force." },
            { rune: "triangle", anchor: 4, label: "POWER", reason: "Load the opposite point and close the defensive triangle." }
        ],
        parryAt: [2]
    },
    {
        id: "breach",
        name: "BREACH KNOT",
        subtitle: "Open a line, load it, then drink the collapsing guard.",
        difficulty: "TACTICAL",
        effect: "A focused breach that punches through a ward and recovers energy from the break.",
        steps: [
            { rune: "line", anchor: 5, label: "PIERCE", reason: "Choose the attack vector." },
            { rune: "triangle", anchor: 1, label: "POWER", reason: "Load force across the diagonal." },
            { rune: "spiral", anchor: 3, label: "ABSORB", reason: "Catch the collapsing ward instead of wasting it." }
        ],
        parryAt: [1]
    },
    {
        id: "mirror",
        name: "MIRROR CROWN",
        subtitle: "Route, contain, invert, and return a hostile working.",
        difficulty: "ADVANCED",
        effect: "A control weave that catches a spell, turns its route, and sends the remaining force back.",
        steps: [
            { rune: "arc", anchor: 1, label: "REDIRECT", reason: "Establish the return path." },
            { rune: "circle", anchor: 4, label: "WARD", reason: "Contain the captured force." },
            { rune: "spiral", anchor: 2, label: "ABSORB", reason: "Pull the hostile working into the crown." },
            { rune: "line", anchor: 5, label: "PIERCE", reason: "Give the stored force a clean exit." }
        ],
        parryAt: [2]
    }
];

export type WeavePlacement = {
    rune: Rune;
    anchor: number;
    correct: boolean;
};

export type WeaveState = {
    mode: WeaveMode;
    placements: readonly WeavePlacement[];
    stability: number;
    charge: number;
    parryEnabled: boolean;
    parryPending: boolean;
    parriesResolved: number;
    complete: boolean;
    released: boolean;
};

export type PlacementResult = {
    state: WeaveState;
    verdict: "correct" | "wrong-rune" | "wrong-anchor" | "occupied" | "free";
    message: string;
};

export type ReleaseResult = {
    state: WeaveState;
    score: number;
    title: string;
    detail: string;
};

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function recipeFor(mode: WeaveMode): WeaveRecipe | undefined {
    return mode === "free" ? undefined : WEAVE_RECIPES.find(recipe => recipe.id === mode);
}

export function startWeave(mode: WeaveMode, parryEnabled = true): WeaveState {
    return {
        mode,
        placements: [],
        stability: 70,
        charge: 0,
        parryEnabled,
        parryPending: false,
        parriesResolved: 0,
        complete: false,
        released: false
    };
}

export function nextWeaveStep(state: WeaveState): WeaveStep | undefined {
    const recipe = recipeFor(state.mode);
    return recipe?.steps[state.placements.length];
}

function shouldParry(state: WeaveState, placementCount: number): boolean {
    if (!state.parryEnabled) return false;
    const recipe = recipeFor(state.mode);
    if (recipe) return recipe.parryAt.includes(placementCount) && placementCount < recipe.steps.length;
    return (placementCount === 2 || placementCount === 4) && placementCount < 5;
}

export function placeWeaveRune(state: WeaveState, rune: Rune, anchor: number): PlacementResult {
    if (state.released || state.parryPending || state.complete) {
        return { state, verdict: "occupied", message: "Resolve the current weave state before placing another rune." };
    }
    if (anchor < 0 || anchor > 5 || state.placements.some(placement => placement.anchor === anchor)) {
        return {
            state: { ...state, stability: clamp(state.stability - 4, 0, 100) },
            verdict: "occupied",
            message: "That anchor is already occupied. Choose another point in the field."
        };
    }

    const recipe = recipeFor(state.mode);
    if (!recipe) {
        const placementCount = state.placements.length + 1;
        const repeatedRune = state.placements.some(placement => placement.rune === rune);
        const placements = [...state.placements, { rune, anchor, correct: true }];
        return {
            state: {
                ...state,
                placements,
                stability: clamp(state.stability + (repeatedRune ? 2 : 7), 0, 100),
                charge: clamp(state.charge + (repeatedRune ? 1 : 2), 0, 10),
                parryPending: shouldParry(state, placementCount),
                complete: placements.length >= 5
            },
            verdict: "free",
            message: repeatedRune
                ? "Rune placed. Repetition reinforces one idea but adds less structure."
                : "Rune placed. A new semantic family strengthens the free weave."
        };
    }

    const expected = recipe.steps[state.placements.length]!;
    if (rune !== expected.rune) {
        return {
            state: { ...state, stability: clamp(state.stability - 14, 0, 100) },
            verdict: "wrong-rune",
            message: "Wrong rune for this layer. The weave frays, but the step stays open so you can correct it."
        };
    }
    if (anchor !== expected.anchor) {
        return {
            state: { ...state, stability: clamp(state.stability - 9, 0, 100) },
            verdict: "wrong-anchor",
            message: "Right rune, wrong anchor. Geometry matters: place it on the highlighted point."
        };
    }

    const placements = [...state.placements, { rune, anchor, correct: true }];
    const complete = placements.length === recipe.steps.length;
    return {
        state: {
            ...state,
            placements,
            stability: clamp(state.stability + 8, 0, 100),
            charge: clamp(state.charge + 2, 0, 10),
            parryPending: !complete && shouldParry(state, placements.length),
            complete
        },
        verdict: "correct",
        message: complete ? "The pattern is complete. Release the sigil." : "Layer locked. Follow the next filament."
    };
}

export function resolveWeaveParry(state: WeaveState, outcome: ParryOutcome, quality: number): WeaveState {
    if (!state.parryPending) return state;
    const q = clamp(quality, 0, 1);
    const stabilityDelta =
        outcome === "reflect" ? 8 + Math.round(q * 5) :
        outcome === "deflect" ? 4 + Math.round(q * 3) :
        outcome === "block" ? Math.round(q * 3) :
        -18;
    const chargeDelta =
        outcome === "reflect" ? 2 :
        outcome === "deflect" ? 1 :
        outcome === "block" ? 0 :
        -1;
    return {
        ...state,
        stability: clamp(state.stability + stabilityDelta, 0, 100),
        charge: clamp(state.charge + chargeDelta, 0, 10),
        parryPending: false,
        parriesResolved: state.parriesResolved + 1
    };
}

export function canReleaseWeave(state: WeaveState): boolean {
    if (state.released || state.parryPending) return false;
    if (state.mode === "free") return state.placements.length >= 3;
    return state.complete;
}

export function releaseWeave(state: WeaveState): ReleaseResult {
    if (!canReleaseWeave(state)) {
        return { state, score: 0, title: "WEAVE INCOMPLETE", detail: "Finish enough layers before releasing the sigil." };
    }
    const recipe = recipeFor(state.mode);
    const diversity = new Set(state.placements.map(placement => placement.rune)).size;
    const score = clamp(Math.round(state.stability * 0.72 + state.charge * 2 + diversity * 3), 0, 100);
    const released = { ...state, released: true };
    if (recipe) {
        return {
            state: released,
            score,
            title: recipe.name,
            detail: recipe.effect + " Stability " + state.stability + "%, charge " + state.charge + "/10."
        };
    }
    return {
        state: released,
        score,
        title: "FREE WEAVE",
        detail: "An improvised sigil using " + diversity + " rune families across " + state.placements.length + " anchors."
    };
}
