import type { PlayerId, ReactionGlyph, ResolutionResult } from "../../../packages/wyrd-resolver/src/index.js";

/**
 * The duel stage (docs/duel-engagement-options.md §F): two mages, a gate,
 * wards, bolts. It changes no rules - it replays the resolver's own steps
 * as beats, so what you see is exactly what the combat log says.
 *
 * `buildTimeline` is pure and unit-tested; `createStage` binds the beats
 * to the inline SVG in index.html with the Web Animations API.
 */
export type Side = PlayerId;

export type Beat =
    | { kind: "cast"; side: Side; essence?: string; spell: string }
    | { kind: "fly"; from: Side; to: Side; essence?: string; magnitude: number; action: "seek" | "bind" }
    | { kind: "reflect"; side: Side }
    | { kind: "silence"; side: Side }
    | { kind: "null"; side: Side }
    | { kind: "ward-block"; side: Side; broken: boolean; integrity?: number }
    | { kind: "ward-up"; side: Side; essence?: string; integrity?: number }
    | { kind: "bind"; side: Side }
    | { kind: "gate-close" }
    | { kind: "hit"; side: Side; magnitude: number; damage?: number }
    | { kind: "seal"; side: Side }
    | { kind: "fizzle"; side: Side; reason: string };

export type Contribution = {
    result: ResolutionResult;
    casterId: Side;
    defenderId: Side;
    spell: readonly string[];
    reaction: ReactionGlyph | undefined;
};

/** Beat durations in ms (full motion). Reduced motion collapses them to a frame. */
export const BEAT_MS: Record<Beat["kind"], number> = {
    cast: 320,
    fly: 520,
    reflect: 220,
    silence: 260,
    null: 380,
    "ward-block": 360,
    "ward-up": 420,
    bind: 380,
    "gate-close": 480,
    hit: 300,
    seal: 520,
    fizzle: 420
};

const COLORS: Record<string, string> = {
    fire: "#ff7a3d",
    shadow: "#a56bff",
    water: "#4fb3ff",
    force: "#ffd166",
    life: "#6ee7a8"
};

export function essenceColor(essence: string | undefined): string {
    return (essence && COLORS[essence]) ?? "#f4f0ff";
}

function other(side: Side): Side {
    return side === "player" ? "opponent" : "player";
}

function stepCodes(result: ResolutionResult): Set<string> {
    return new Set(result.steps.map(s => s.code));
}

function integrityFrom(text: string | undefined): number | undefined {
    const m = text?.match(/integrity (\d+)/);
    return m ? Number(m[1]) : undefined;
}

export function contributionBeats(c: Contribution): Beat[] {
    const codes = stepCodes(c.result);
    const effect = c.result.effect;
    const spell = c.spell.join(" ");
    const beats: Beat[] = [{ kind: "cast", side: c.casterId, ...(effect?.essence ? { essence: effect.essence } : {}), spell }];

    if (!effect || codes.has("INVALID_SPELL") || codes.has("UNSUPPORTED_POC_SPELL") || codes.has("NO_BASE_ACTION")) {
        beats.push({ kind: "fizzle", side: c.casterId, reason: c.result.steps.find(s => s.result === "failed")?.text ?? "The spell failed." });
        return beats;
    }

    if (effect.action === "ward") {
        const owner: Side = effect.target === "enemy" ? c.defenderId : c.casterId;
        beats.push({
            kind: "ward-up",
            side: owner,
            ...(effect.essence ? { essence: effect.essence } : {}),
            ...(c.result.state.players[owner].ward?.integrity !== undefined ? { integrity: c.result.state.players[owner].ward!.integrity } : {})
        });
        return beats;
    }

    if (effect.action === "close") {
        if (codes.has("NULL_CANCELED")) {
            beats.push({ kind: "null", side: c.defenderId });
            return beats;
        }
        if (codes.has("CLOSE_REQUIRES_GATE")) {
            beats.push({ kind: "fizzle", side: c.casterId, reason: "CLOSE needs the GATE." });
            return beats;
        }
        beats.push({ kind: "gate-close" });
        if (c.result.sealAwardedTo) beats.push({ kind: "seal", side: c.result.sealAwardedTo });
        return beats;
    }

    // SEEK / BIND: the bolt. It launches with the magnitude the caster gave
    // it (AMPLIFY, ignite, quick cast) and may be dimmed by SILENCE.
    const launchedMagnitude =
        (c.result.steps.some(s => s.code === "AMPLIFY_APPLIED") ? 2 : 1) +
        (c.result.steps.some(s => s.code === "IGNITE_APPLIED") ? 1 : 0) +
        (c.result.steps.some(s => s.code === "QUICK_CAST") ? 1 : 0);
    const towards: Side = effect.target === "self" && !effect.reflected ? c.casterId : c.defenderId;
    beats.push({
        kind: "fly",
        from: c.casterId,
        to: towards,
        ...(effect.essence ? { essence: effect.essence } : {}),
        magnitude: launchedMagnitude,
        action: effect.action
    });

    if (codes.has("NULL_CANCELED")) {
        beats.push({ kind: "null", side: c.defenderId });
        return beats;
    }
    if (codes.has("SILENCE_STRIPPED_MODIFIERS")) beats.push({ kind: "silence", side: c.defenderId });
    let landsOn: Side = towards;
    if (codes.has("REFLECT_APPLIED")) {
        beats.push({ kind: "reflect", side: c.defenderId });
        landsOn = c.casterId;
        beats.push({
            kind: "fly",
            from: c.defenderId,
            to: c.casterId,
            ...(effect.essence ? { essence: effect.essence } : {}),
            magnitude: effect.magnitude,
            action: effect.action
        });
    }

    if (codes.has("WARD_BLOCKED")) {
        const broken = codes.has("WARD_BROKEN");
        const integrity = integrityFrom(c.result.steps.find(s => s.code === "WARD_DENTED")?.text);
        beats.push({ kind: "ward-block", side: landsOn, broken, ...(integrity !== undefined ? { integrity } : {}) });
        return beats;
    }

    if (effect.action === "bind") {
        beats.push({ kind: "bind", side: landsOn });
    } else {
        const damageText = c.result.steps.find(s => s.code === "RESOLVE_DAMAGE")?.text;
        const damage = damageText?.match(/drops by (\d+)/)?.[1];
        beats.push({ kind: "hit", side: landsOn, magnitude: effect.magnitude, ...(damage ? { damage: Number(damage) } : {}) });
    }
    if (c.result.sealAwardedTo) beats.push({ kind: "seal", side: c.result.sealAwardedTo });
    return beats;
}

export function buildTimeline(incoming: Contribution, outgoing?: Contribution): Beat[] {
    return [...contributionBeats(incoming), ...(outgoing ? contributionBeats(outgoing) : [])];
}

// ---------------------------------------------------------------- DOM player

export type StageState = {
    wards: Record<Side, { essence?: string; integrity?: number } | undefined>;
    bound: Record<Side, boolean>;
    gateClosed: boolean;
};

export type StageHooks = {
    /** Called at the start of each beat (sound, log). */
    onBeat?: (beat: Beat) => void;
};

const X: Record<Side, number> = { player: 70, opponent: 290 };
const Y = 118;
const GATE_X = 180;

export type Stage = {
    /** Show the board at rest for a state (wards, chains, gate). */
    setIdle(state: StageState): void;
    /** Play beats in order; resolves when done. A second call skips the current run. */
    play(beats: Beat[], state: StageState): Promise<void>;
    reducedMotion(): boolean;
};

export function createStage(root: SVGSVGElement, hooks: StageHooks = {}, motion: { reduced: () => boolean } = { reduced: () => false }): Stage {
    const q = <T extends Element>(selector: string): T => {
        const el = root.querySelector<T>(selector);
        if (!el) throw new Error(`stage: missing ${selector}`);
        return el;
    };
    const mage: Record<Side, SVGGElement> = { player: q("#stage-mage-player"), opponent: q("#stage-mage-opponent") };
    const ward: Record<Side, SVGPolygonElement> = { player: q("#stage-ward-player"), opponent: q("#stage-ward-opponent") };
    const chains: Record<Side, SVGGElement> = { player: q("#stage-chains-player"), opponent: q("#stage-chains-opponent") };
    const bolt = q<SVGCircleElement>("#stage-bolt");
    const trail = q<SVGLineElement>("#stage-trail");
    const gateDoor = q<SVGRectElement>("#stage-gate-door");
    const orb = q<SVGCircleElement>("#stage-orb");
    const flash = q<SVGRectElement>("#stage-flash");
    const caption = q<SVGTextElement>("#stage-caption");

    let generation = 0;
    const dur = (ms: number): number => (motion.reduced() ? 1 : ms);
    const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, dur(ms)));

    function say(text: string): void {
        caption.textContent = text;
    }

    function drawWard(side: Side, w: StageState["wards"][Side]): void {
        const el = ward[side];
        if (!w) {
            el.setAttribute("opacity", "0");
            el.classList.remove("cracked");
            return;
        }
        el.setAttribute("opacity", "1");
        el.setAttribute("stroke", essenceColor(w.essence));
        el.setAttribute("fill", essenceColor(w.essence));
        el.classList.toggle("cracked", w.integrity === 1);
    }

    function setIdle(state: StageState): void {
        for (const side of ["player", "opponent"] as const) {
            drawWard(side, state.wards[side]);
            chains[side].setAttribute("opacity", state.bound[side] ? "1" : "0");
            mage[side].classList.remove("hit", "casting", "faltering");
        }
        gateDoor.setAttribute("opacity", state.gateClosed ? "1" : "0.25");
        bolt.setAttribute("opacity", "0");
        trail.setAttribute("opacity", "0");
        orb.setAttribute("opacity", "0");
        flash.setAttribute("opacity", "0");
        say("");
    }

    async function animate(el: Element, keyframes: Keyframe[], ms: number): Promise<void> {
        if (typeof (el as Element & { animate?: unknown }).animate !== "function") return wait(ms);
        const a = (el as Element & { animate: (k: Keyframe[], o: KeyframeAnimationOptions) => Animation }).animate(keyframes, {
            duration: dur(ms),
            fill: "forwards",
            easing: "ease-in-out"
        });
        await a.finished.catch(() => undefined);
    }

    async function fly(from: Side, to: Side, essence: string | undefined, magnitude: number, ms: number): Promise<void> {
        const color = essenceColor(essence);
        const r = 5 + magnitude * 2.5;
        bolt.setAttribute("r", String(r));
        bolt.setAttribute("fill", color);
        bolt.setAttribute("opacity", "1");
        trail.setAttribute("stroke", color);
        trail.setAttribute("opacity", "0.6");
        const x0 = X[from] + (from === "player" ? 26 : -26);
        const x1 = X[to] + (to === "player" ? 30 : -30);
        trail.setAttribute("x1", String(x0));
        trail.setAttribute("y1", String(Y - 6));
        trail.setAttribute("x2", String(x0));
        trail.setAttribute("y2", String(Y - 6));
        const keyframes: Keyframe[] = [
            { transform: `translate(${x0}px, ${Y - 6}px)` },
            { transform: `translate(${(x0 + x1) / 2}px, ${Y - 34}px)`, offset: 0.5 },
            { transform: `translate(${x1}px, ${Y - 6}px)` }
        ];
        const trailAnim = animate(trail, [{ x2: x0 }, { x2: x1 }] as Keyframe[], ms);
        await Promise.all([animate(bolt, keyframes, ms), trailAnim]);
        trail.setAttribute("opacity", "0");
    }

    async function shake(): Promise<void> {
        if (motion.reduced()) return;
        root.classList.add("shake");
        await wait(260);
        root.classList.remove("shake");
    }

    async function playBeat(beat: Beat, state: StageState): Promise<void> {
        hooks.onBeat?.(beat);
        switch (beat.kind) {
            case "cast": {
                mage[beat.side].classList.add("casting");
                say(`${beat.side === "player" ? "◀" : "▶"} ${beat.spell}`);
                await wait(BEAT_MS.cast);
                mage[beat.side].classList.remove("casting");
                return;
            }
            case "fly":
                return fly(beat.from, beat.to, beat.essence, beat.magnitude, BEAT_MS.fly);
            case "reflect": {
                say("REFLECT");
                await animate(bolt, [{ transform: bolt.style.transform || "none" }, { transform: `${bolt.style.transform || ""} scale(1.6)` }], BEAT_MS.reflect / 2);
                await animate(bolt, [{ opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }], BEAT_MS.reflect / 2);
                return;
            }
            case "silence": {
                say("SILENCE");
                await animate(bolt, [{ r: bolt.getAttribute("r") ?? 8 }, { r: 6 }] as Keyframe[], BEAT_MS.silence);
                bolt.setAttribute("r", "6");
                return;
            }
            case "null": {
                say("NULL");
                await animate(bolt, [{ opacity: 1 }, { opacity: 0, transform: `${bolt.style.transform || ""} scale(0.2)` }], BEAT_MS.null);
                bolt.setAttribute("opacity", "0");
                return;
            }
            case "ward-block": {
                const el = ward[beat.side];
                say(beat.broken ? "WARD SHATTERS" : "WARDED");
                bolt.setAttribute("opacity", "0");
                if (beat.broken) {
                    await animate(el, [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(1.5) rotate(12deg)" }], BEAT_MS["ward-block"]);
                    drawWard(beat.side, undefined);
                    await shake();
                } else {
                    await animate(el, [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], BEAT_MS["ward-block"]);
                    drawWard(beat.side, { ...state.wards[beat.side], ...(beat.integrity !== undefined ? { integrity: beat.integrity } : {}) });
                }
                return;
            }
            case "ward-up": {
                say("WARD");
                drawWard(beat.side, { ...(beat.essence ? { essence: beat.essence } : {}), ...(beat.integrity !== undefined ? { integrity: beat.integrity } : {}) });
                await animate(ward[beat.side], [{ opacity: 0, transform: "scale(0.4)" }, { opacity: 1, transform: "scale(1)" }], BEAT_MS["ward-up"]);
                return;
            }
            case "bind": {
                say("BOUND");
                bolt.setAttribute("opacity", "0");
                chains[beat.side].setAttribute("opacity", "1");
                await animate(chains[beat.side], [{ opacity: 0 }, { opacity: 1 }], BEAT_MS.bind);
                return;
            }
            case "gate-close": {
                say("GATE CLOSED");
                gateDoor.setAttribute("opacity", "1");
                await animate(gateDoor, [{ transform: "translateY(-40px)" }, { transform: "translateY(0)" }], BEAT_MS["gate-close"]);
                await shake();
                return;
            }
            case "hit": {
                say(beat.damage ? `HIT −${beat.damage} RESOLVE` : "HIT");
                bolt.setAttribute("opacity", "0");
                mage[beat.side].classList.add("hit");
                flash.setAttribute("opacity", "0.35");
                await Promise.all([
                    animate(flash, [{ opacity: 0.35 }, { opacity: 0 }], BEAT_MS.hit),
                    animate(mage[beat.side], [{ transform: "translateX(0)" }, { transform: `translateX(${beat.side === "player" ? -8 : 8}px)` }, { transform: "translateX(0)" }], BEAT_MS.hit)
                ]);
                mage[beat.side].classList.remove("hit");
                return;
            }
            case "seal": {
                say(`SEAL → ${beat.side === "player" ? "◀" : "▶"}`);
                orb.setAttribute("opacity", "1");
                const x = X[beat.side];
                await animate(orb, [{ transform: `translate(${GATE_X}px, ${Y - 30}px) scale(0.4)`, opacity: 1 }, { transform: `translate(${x}px, 26px) scale(1)`, opacity: 0.2 }], BEAT_MS.seal);
                orb.setAttribute("opacity", "0");
                await shake();
                return;
            }
            case "fizzle": {
                say("FIZZLE");
                await animate(mage[beat.side], [{ opacity: 1 }, { opacity: 0.5 }, { opacity: 1 }], BEAT_MS.fizzle);
                return;
            }
        }
    }

    async function play(beats: Beat[], state: StageState): Promise<void> {
        const mine = ++generation;
        for (const beat of beats) {
            if (mine !== generation) return; // skipped by a newer run
            await playBeat(beat, state);
        }
        if (mine === generation) {
            await wait(300);
            say("");
        }
    }

    return { setIdle, play, reducedMotion: () => motion.reduced() };
}
