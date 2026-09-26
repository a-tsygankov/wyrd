import type { Phase as HotseatPhase } from "./hotseat.js";

/**
 * The round's phases (docs/duel-3d-assets-and-ui.md §3, layout A): the
 * interface names the one you are in, the strip scrolls to its card, and
 * the 3D arena's camera follows. Derived from what has happened, never
 * stored, so it can never disagree with the board.
 */
export type RoundPhase = "read" | "react" | "shape" | "cast" | "resolve" | "verdict";

export type PhaseInfo = { id: RoundPhase; title: string; hint: string };

export const PHASES: readonly PhaseInfo[] = [
    { id: "read", title: "Read", hint: "Read the telegraph: what is shown, what is hidden." },
    { id: "react", title: "React", hint: "Choose one reaction to their spell, or none." },
    { id: "shape", title: "Shape", hint: "Compose your own spell, 2 to 4 glyphs." },
    { id: "cast", title: "Cast", hint: "The spell is castable: commit it." },
    { id: "resolve", title: "Resolve", hint: "Both spells resolve in initiative order." },
    { id: "verdict", title: "Verdict", hint: "Who took the round and why; then the next round." }
];

export type PhaseInput = {
    mode: "solo" | "hotseat";
    hotseatPhase: HotseatPhase;
    roundResolved: boolean;
    /** The stage is replaying the round. */
    playing: boolean;
    spellLength: number;
    castable: boolean;
    reactionSelected: boolean;
    reactionLocked: boolean;
};

export function derivePhase(input: PhaseInput): RoundPhase {
    if (input.roundResolved) return input.playing ? "resolve" : "verdict";
    if (input.mode === "hotseat") {
        switch (input.hotseatPhase) {
            case "handoff-to-p1":
            case "handoff-to-p2":
                return "read";
            case "p2-compose":
                return input.castable ? "cast" : "shape";
            case "p2-react":
                return "react";
            case "resolved":
                return "verdict";
            case "p1-turn":
                break;
        }
    }
    if (input.castable) return "cast";
    if (input.spellLength > 0) return "shape";
    if (input.reactionSelected || input.reactionLocked) return "react";
    return "read";
}

/** The card (by its CSS class) the strip scrolls to for a phase. */
export function phaseTarget(phase: RoundPhase): "opponent" | "reaction" | "composer" | "stage" | "log" {
    switch (phase) {
        case "read":
            return "opponent";
        case "react":
            return "reaction";
        case "shape":
        case "cast":
            return "composer";
        case "resolve":
            return "stage";
        case "verdict":
            return "log";
    }
}
