import type { Beat } from "./stage.js";

/**
 * Eight short synthesised cues for the stage - no assets, works offline,
 * silent until the first tap (browsers require a gesture to start audio).
 * The mapping and the cue table are pure; `createSound` owns the
 * AudioContext.
 */
export type CueName = "cast" | "reflect" | "silence" | "null" | "block" | "shatter" | "ward" | "bind" | "gate" | "hit" | "seal" | "fizzle" | "impact" | "tick" | "tick2" | "tick3";

export type Cue = { notes: number[]; duration: number; type: OscillatorType; gain: number };

export const CUES: Record<CueName, Cue> = {
    cast: { notes: [330, 440], duration: 0.18, type: "triangle", gain: 0.05 },
    reflect: { notes: [660, 880, 660], duration: 0.2, type: "sine", gain: 0.06 },
    silence: { notes: [440, 220], duration: 0.25, type: "sine", gain: 0.05 },
    null: { notes: [300, 150, 80], duration: 0.35, type: "sawtooth", gain: 0.05 },
    block: { notes: [520, 520], duration: 0.15, type: "square", gain: 0.04 },
    shatter: { notes: [900, 600, 300], duration: 0.4, type: "square", gain: 0.06 },
    ward: { notes: [220, 330, 440], duration: 0.35, type: "triangle", gain: 0.05 },
    bind: { notes: [200, 180, 160], duration: 0.3, type: "sawtooth", gain: 0.04 },
    gate: { notes: [110, 90], duration: 0.45, type: "square", gain: 0.06 },
    hit: { notes: [180, 120], duration: 0.2, type: "sawtooth", gain: 0.07 },
    seal: { notes: [523, 659, 784, 1046], duration: 0.5, type: "sine", gain: 0.06 },
    fizzle: { notes: [300, 250, 200], duration: 0.3, type: "triangle", gain: 0.04 },
    // Bass under a landing hit (ideas doc §D: "more bass"), layered on the hit cue.
    impact: { notes: [70, 45], duration: 0.28, type: "sine", gain: 0.11 },
    // The last three seconds of the reaction window, one tick a second, rising.
    tick: { notes: [660], duration: 0.08, type: "square", gain: 0.03 },
    tick2: { notes: [880], duration: 0.08, type: "square", gain: 0.035 },
    tick3: { notes: [1100], duration: 0.1, type: "square", gain: 0.04 }
};

/** A second cue played under the main one: the bass of an impact. */
export function extraCueFor(beat: Pick<Beat, "kind">): CueName | null {
    switch (beat.kind) {
        case "hit":
        case "ward-break":
        case "gate-break":
            return "impact";
        default:
            return null;
    }
}

/** The tick for an urgent remaining time (ms), rising as it runs out; null outside the last three seconds. */
export function urgencyCue(remainingMs: number): CueName | null {
    if (remainingMs <= 0 || remainingMs > 3000) return null;
    return remainingMs > 2000 ? "tick" : remainingMs > 1000 ? "tick2" : "tick3";
}

export function cueFor(beat: Pick<Beat, "kind"> & { broken?: boolean }): CueName | null {
    switch (beat.kind) {
        case "cast":
            return "cast";
        case "fly":
            return null;
        case "reflect":
        case "reverse":
            return "reflect";
        case "split":
            return "cast";
        case "silence":
            return "silence";
        case "null":
            return "null";
        case "ward-block":
            return beat.broken ? "shatter" : "block";
        case "ward-up":
            return "ward";
        case "bind":
            return "bind";
        case "gate-close":
        case "gate-open":
            return "gate";
        case "gate-break":
        case "ward-break":
            return "shatter";
        case "gate-mend":
        case "mend":
            return "ward";
        case "hit":
            return "hit";
        case "seal":
            return "seal";
        case "fizzle":
            return "fizzle";
        default:
            return null;
    }
}

export type Sound = {
    play(name: CueName): void;
    /** Call from a user gesture once; unlocks audio on iOS. */
    unlock(): void;
    setEnabled(enabled: boolean): void;
};

export function createSound(enabled: boolean): Sound {
    let on = enabled;
    let context: AudioContext | undefined;
    const ensure = (): AudioContext | undefined => {
        if (typeof AudioContext === "undefined") return undefined;
        context ??= new AudioContext();
        return context;
    };
    return {
        setEnabled(value) {
            on = value;
        },
        unlock() {
            if (!on) return;
            const ctx = ensure();
            if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
        },
        play(name) {
            if (!on) return;
            const ctx = ensure();
            if (!ctx || ctx.state !== "running") return;
            const cue = CUES[name];
            const now = ctx.currentTime;
            const step = cue.duration / cue.notes.length;
            const gainNode = ctx.createGain();
            gainNode.gain.setValueAtTime(cue.gain, now);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + cue.duration);
            gainNode.connect(ctx.destination);
            const osc = ctx.createOscillator();
            osc.type = cue.type;
            cue.notes.forEach((freq, i) => osc.frequency.setValueAtTime(freq, now + i * step));
            osc.connect(gainNode);
            osc.start(now);
            osc.stop(now + cue.duration);
        }
    };
}
