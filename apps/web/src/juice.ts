import type { Beat, Side } from "./stage.js";

/**
 * Hit juice on one dial (docs/duel-ux-ideas.md §D, after Eiserloh's trauma
 * camera and Vlambeer's screenshake): every impact adds `trauma` by what it
 * means, trauma decays linearly, and the stage shakes by trauma squared -
 * translation plus a little rotation - so a plain hit nudges and a
 * shattered ward rattles. Pure; stage.ts owns the clock and the transform.
 * Reduced motion skips all of it except the flash and the floor mark.
 */
export const HIT_STOP_MS = 80;
/** Trauma lost per second. */
export const TRAUMA_DECAY_PER_S = 1.8;
export const SHAKE_MAX = { x: 6, y: 4, rot: 1.5 };

export function traumaFor(beat: Beat): number {
    switch (beat.kind) {
        case "hit":
            return beat.magnitude >= 2 ? 0.5 : 0.3;
        case "ward-block":
            return beat.broken ? 0.6 : 0.2;
        case "ward-break":
        case "gate-ward-break":
            return 0.6;
        case "gate-ward-block":
            return beat.broken ? 0.6 : 0.2;
        case "gate-break":
            return 0.5;
        case "gate-close":
        case "gate-open":
            return 0.3;
        case "gate-mend":
            return 0.1;
        case "seal":
            return 0.4;
        case "bind":
        case "null":
            return 0.15;
        default:
            return 0;
    }
}

export function decayTrauma(trauma: number, dtMs: number): number {
    return Math.max(0, Math.round((trauma - (dtMs / 1000) * TRAUMA_DECAY_PER_S) * 1e6) / 1e6);
}

/**
 * Offset for time `tMs`: incommensurate sines stand in for noise, so the
 * shake reads as jitter rather than a wobble, and stays deterministic.
 */
export function shakeOffset(trauma: number, tMs: number): { x: number; y: number; rot: number } {
    if (trauma <= 0) return { x: 0, y: 0, rot: 0 };
    const amp = trauma * trauma;
    const t = tMs / 1000;
    const noise = (f1: number, f2: number, phase: number): number => Math.sin(t * f1 + phase) * Math.cos(t * f2 * 0.37 + phase * 1.7);
    return {
        x: amp * SHAKE_MAX.x * noise(61, 43, 0.3),
        y: amp * SHAKE_MAX.y * noise(53, 71, 1.1),
        rot: amp * SHAKE_MAX.rot * noise(37, 59, 2.4)
    };
}

export type FloorMark = { side: Side; essence: string | undefined };

/** Permanence (Vlambeer): a hit scorches the floor under the struck mage for the rest of the match. */
export function markFor(beat: Beat, essence: string | undefined): FloorMark | undefined {
    return beat.kind === "hit" ? { side: beat.side, essence } : undefined;
}
