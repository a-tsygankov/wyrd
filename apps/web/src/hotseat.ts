import type { ReactionGlyph } from "../../../packages/wyrd-resolver/src/index.js";

/**
 * Same-device hot-seat duel (plan POC-3): two humans, one phone. The round
 * keeps the solo shape - an "opponent" spell is telegraphed, the player
 * reacts and casts, the opponent reacts - but the opponent is Player 2:
 *
 *   p2-compose  Player 2 builds a spell in secret
 *   handoff     pass the phone
 *   p1-turn     Player 1 reads the telegraph, reacts, casts
 *   handoff     pass the phone
 *   p2-react    Player 2 reads Player 1's telegraph and reacts
 *   resolved    both see the log
 *
 * A pure state machine so the hand-offs cannot be skipped by a stray tap;
 * main.ts owns the DOM.
 */
export type Phase = "p2-compose" | "handoff-to-p1" | "p1-turn" | "handoff-to-p2" | "p2-react" | "resolved";

export type HotseatRound = {
    phase: Phase;
    p2Spell?: string[];
    p1Spell?: string[];
    p1Reaction?: ReactionGlyph | undefined;
    p2Reaction?: ReactionGlyph | undefined;
};

function expect(round: HotseatRound, ...phases: Phase[]): void {
    if (!phases.includes(round.phase)) {
        throw new Error(`hot-seat: expected phase ${phases.join(" or ")}, was ${round.phase}`);
    }
}

export function startRound(): HotseatRound {
    return { phase: "p2-compose" };
}

export function lockP2Spell(round: HotseatRound, spell: string[]): HotseatRound {
    expect(round, "p2-compose");
    return { ...round, phase: "handoff-to-p1", p2Spell: [...spell] };
}

export function acknowledgeHandoff(round: HotseatRound): HotseatRound {
    expect(round, "handoff-to-p1", "handoff-to-p2");
    return { ...round, phase: round.phase === "handoff-to-p1" ? "p1-turn" : "p2-react" };
}

export function commitP1(round: HotseatRound, spell: string[], reaction?: ReactionGlyph): HotseatRound {
    expect(round, "p1-turn");
    return { ...round, phase: "handoff-to-p2", p1Spell: [...spell], p1Reaction: reaction };
}

export function resolveP2(round: HotseatRound, reaction: ReactionGlyph | undefined): HotseatRound {
    expect(round, "p2-react");
    return { ...round, phase: "resolved", p2Reaction: reaction };
}

export type Presentation = {
    status: string;
    castLabel: string;
    showComposer: boolean;
    showReaction: boolean;
    /** Whose committed spell the telegraph card shows. */
    telegraphOf: "p1" | "p2" | null;
    telegraphLabel: string;
    reactionLabel: string;
    overlay?: string;
};

export function presentation(phase: Phase): Presentation {
    switch (phase) {
        case "p2-compose":
            return {
                status: "Player 2: compose in secret",
                castLabel: "LOCK IN SPELL",
                showComposer: true,
                showReaction: false,
                telegraphOf: null,
                telegraphLabel: "Player 2 casts first",
                reactionLabel: ""
            };
        case "handoff-to-p1":
            return {
                status: "Pass the phone",
                castLabel: "",
                showComposer: false,
                showReaction: false,
                telegraphOf: null,
                telegraphLabel: "",
                reactionLabel: "",
                overlay: "Pass the phone to Player 1"
            };
        case "p1-turn":
            return {
                status: "Player 1: read, react, cast",
                castLabel: "COMMIT",
                showComposer: true,
                showReaction: true,
                telegraphOf: "p2",
                telegraphLabel: "Player 2 telegraph",
                reactionLabel: "Player 1 reaction to Player 2"
            };
        case "handoff-to-p2":
            return {
                status: "Pass the phone",
                castLabel: "",
                showComposer: false,
                showReaction: false,
                telegraphOf: null,
                telegraphLabel: "",
                reactionLabel: "",
                overlay: "Pass the phone to Player 2"
            };
        case "p2-react":
            return {
                status: "Player 2: react to Player 1",
                castLabel: "RESOLVE ROUND",
                showComposer: false,
                showReaction: true,
                telegraphOf: "p1",
                telegraphLabel: "Player 1 telegraph",
                reactionLabel: "Player 2 reaction to Player 1"
            };
        case "resolved":
            return {
                status: "Round resolved",
                castLabel: "",
                showComposer: false,
                showReaction: false,
                telegraphOf: "p2",
                telegraphLabel: "Player 2 telegraph",
                reactionLabel: ""
            };
    }
}
