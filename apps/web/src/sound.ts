import type { Beat } from "./stage.js";

/**
 * Eight short synthesised cues for the stage - no assets, works offline,
 * silent until the first tap (browsers require a gesture to start audio).
 * The mapping and the cue table are pure; `createSound` owns the
 * AudioContext.
 */
export type CueName = "cast" | "reflect" | "silence" | "null" | "block" | "shatter" | "ward" | "bind" | "gate" | "hit" | "seal" | "fizzle";

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
    fizzle: { notes: [300, 250, 200], duration: 0.3, type: "triangle", gain: 0.04 }
};

export function cueFor(beat: Pick<Beat, "kind"> & { broken?: boolean }): CueName | null {
    switch (beat.kind) {
        case "cast":
            return "cast";
        case "fly":
            return null;
        case "reflect":
            return "reflect";
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
            return "gate";
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
