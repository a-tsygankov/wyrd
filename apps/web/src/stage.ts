import type { GateState, PlayerId, ReactionGlyph, ResolutionResult } from "../../../packages/wyrd-resolver/src/index.js";
import { HIT_STOP_MS, decayTrauma, markFor, shakeOffset, traumaFor, type FloorMark } from "./juice.js";

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
    | { kind: "fly"; from: Side; to: Side; essence?: string; magnitude: number; action: "seek" | "bind" | "break" | "mend"; emphasis?: Emphasis }
    | { kind: "reflect"; side: Side }
    | { kind: "split"; side: Side }
    | { kind: "reverse"; side: Side; from: string; to: string }
    | { kind: "silence"; side: Side }
    | { kind: "null"; side: Side }
    | { kind: "ward-block"; side: Side; broken: boolean; integrity?: number }
    | { kind: "ward-break"; side: Side }
    | { kind: "ward-up"; side: Side; essence?: string; integrity?: number }
    | { kind: "mend"; side: Side }
    | { kind: "bind"; side: Side }
    | { kind: "gate-close" }
    | { kind: "gate-open" }
    | { kind: "gate-break" }
    | { kind: "gate-mend" }
    | { kind: "gate-ward-up"; side: Side; integrity?: number }
    | { kind: "gate-ward-block"; broken: boolean; integrity?: number }
    | { kind: "gate-ward-break" }
    | { kind: "hit"; side: Side; magnitude: number; damage?: number; emphasis?: Emphasis }
    | { kind: "seal"; side: Side; emphasis?: Emphasis }
    | { kind: "fizzle"; side: Side; reason: string };

export type Contribution = {
    result: ResolutionResult;
    casterId: Side;
    defenderId: Side;
    spell: readonly string[];
    reaction: ReactionGlyph | undefined;
};

/**
 * "decisive": the long version (ideas doc §I) - the seal that wins the
 * match, a knock-out on Resolve, or an amplified / split hit that seals.
 * Everything else stays short so the tenth round still feels quick.
 */
export type Emphasis = "decisive";

/** Beat durations in ms (full motion), every one at or under half a second. Reduced motion collapses them to a frame. */
export const BEAT_MS: Record<Beat["kind"], number> = {
    cast: 320,
    fly: 460,
    reflect: 220,
    split: 320,
    reverse: 360,
    silence: 260,
    null: 380,
    "ward-block": 360,
    "ward-break": 420,
    "ward-up": 420,
    mend: 420,
    bind: 380,
    "gate-close": 480,
    "gate-open": 480,
    "gate-break": 480,
    "gate-mend": 480,
    "gate-ward-up": 420,
    "gate-ward-block": 360,
    "gate-ward-break": 420,
    hit: 300,
    seal: 480,
    fizzle: 420
};

/** How long a beat plays: its table time, or the long version when it decides the match. */
export function beatDuration(beat: Beat): number {
    const base = BEAT_MS[beat.kind];
    if (!("emphasis" in beat) || beat.emphasis !== "decisive") return base;
    switch (beat.kind) {
        case "fly":
            return base * 2;
        case "hit":
            return base * 2;
        case "seal":
            return 1400;
        default:
            return base;
    }
}

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

function stepCodes(result: ResolutionResult): Set<string> {
    return new Set(result.steps.map(s => s.code));
}

/** The steps of one SPLIT branch (or every step, for an unsplit spell). */
function branchSteps(result: ResolutionResult, index: number): ResolutionResult["steps"] {
    const tagged = result.steps.filter(s => s.branch !== undefined);
    return tagged.length === 0 ? result.steps : tagged.filter(s => s.branch === index);
}

function sealBeats(result: ResolutionResult, casterId: Side, defenderId: Side): Beat[] {
    const awarded = result.sealsAwarded ?? (result.sealAwardedTo ? { [result.sealAwardedTo]: 1 } : {});
    return [casterId, defenderId].filter(id => (awarded[id] ?? 0) > 0).map(id => ({ kind: "seal", side: id }) as Beat);
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
    const failed = c.result.steps.find(s => s.result === "failed" && s.stage !== "routing");

    if (!effect || codes.has("INVALID_SPELL") || codes.has("UNSUPPORTED_POC_SPELL") || codes.has("NO_BASE_ACTION")) {
        beats.push({ kind: "fizzle", side: c.casterId, reason: failed?.text ?? "The spell failed." });
        return beats;
    }

    const reverse = c.result.steps.find(s => s.code === "REVERSE_APPLIED" || s.code === "REVERSE_MAGNITUDE");
    if (reverse) {
        const m = reverse.text.match(/changed (\w+) into (\w+)|turned (\w+) into (\w+)/);
        beats.push({ kind: "reverse", side: c.casterId, from: m?.[1] ?? m?.[3] ?? "", to: m?.[2] ?? m?.[4] ?? "" });
    }
    if (codes.has("SPLIT_APPLIED")) beats.push({ kind: "split", side: c.casterId });

    if (codes.has("NULL_CANCELED")) {
        // Anything aimed at a mage at least leaves the hand before NULL takes it.
        if (effect.target !== "gate" && effect.action !== "ward") {
            beats.push({
                kind: "fly",
                from: c.casterId,
                to: effect.target === "self" ? c.casterId : c.defenderId,
                ...(effect.essence ? { essence: effect.essence } : {}),
                magnitude: effect.magnitude,
                action: effect.action === "seek" || effect.action === "bind" || effect.action === "break" || effect.action === "mend" ? effect.action : "seek"
            });
        }
        beats.push({ kind: "null", side: c.defenderId });
        return beats;
    }

    if (effect.action === "ward" && effect.target !== "gate") {
        const owner: Side = effect.target === "enemy" ? c.defenderId : c.casterId;
        beats.push({
            kind: "ward-up",
            side: owner,
            ...(effect.essence ? { essence: effect.essence } : {}),
            ...(c.result.state.players[owner].ward?.integrity !== undefined ? { integrity: c.result.state.players[owner].ward!.integrity } : {})
        });
        return beats;
    }

    if (effect.target === "gate") {
        if (codes.has("GATE_WARDED")) {
            const integrity = integrityFrom(c.result.steps.find(s => s.code === "GATE_WARDED")?.text);
            beats.push({ kind: "gate-ward-up", side: c.casterId, ...(integrity !== undefined ? { integrity } : {}) });
            return beats;
        }
        if (codes.has("GATE_WARD_BLOCKED")) {
            const integrity = integrityFrom(c.result.steps.find(s => s.code === "GATE_WARD_DENTED")?.text);
            beats.push({ kind: "gate-ward-block", broken: codes.has("GATE_WARD_BROKEN"), ...(integrity !== undefined ? { integrity } : {}) });
            return beats;
        }
        if (codes.has("GATE_WARD_BROKEN")) {
            beats.push({ kind: "gate-ward-break" });
            return beats;
        }
        if (codes.has("GATE_CLOSED")) beats.push({ kind: "gate-close" });
        else if (codes.has("GATE_OPENED")) beats.push({ kind: "gate-open" });
        else if (codes.has("GATE_SHATTERED")) beats.push({ kind: "gate-break" });
        else if (codes.has("GATE_MENDED")) beats.push({ kind: "gate-mend" });
        else {
            beats.push({ kind: "fizzle", side: c.casterId, reason: failed?.text ?? c.result.steps.find(s => s.result === "info" && s.stage === "effect")?.text ?? "Nothing happened." });
            return beats;
        }
        beats.push(...sealBeats(c.result, c.casterId, c.defenderId));
        return beats;
    }

    if (effect.action === "close" || effect.action === "open") {
        beats.push({ kind: "fizzle", side: c.casterId, reason: failed?.text ?? "Needs the GATE." });
        return beats;
    }

    // MEND on a mage: nothing travels, the target simply brightens.
    if (effect.action === "mend") {
        if (codes.has("WARD_MENDED") || codes.has("RESOLVE_MENDED")) {
            beats.push({ kind: "mend", side: effect.reflected || effect.target === "self" ? c.casterId : c.defenderId });
        } else {
            beats.push({ kind: "fizzle", side: c.casterId, reason: "Nothing to mend." });
        }
        return beats;
    }

    // SEEK / BIND / BREAK on a mage: the bolt. It launches with the
    // magnitude the caster gave it and may be dimmed by SILENCE. A SPLIT
    // spell flies once per branch; a REFLECTed branch comes back.
    const launchedMagnitude =
        (codes.has("AMPLIFY_APPLIED") ? 2 : 1) - (codes.has("WEAKEN_APPLIED") ? 1 : 0) + (codes.has("IGNITE_APPLIED") ? 1 : 0) + (codes.has("QUICK_CAST") ? 1 : 0);
    const action = effect.action as "seek" | "bind" | "break" | "mend";
    const branches = c.result.branches ?? [effect];
    const flight = (from: Side, to: Side, magnitude: number): Beat => ({
        kind: "fly",
        from,
        to,
        ...(effect.essence ? { essence: effect.essence } : {}),
        magnitude,
        action
    });

    branches.forEach((branch, index) => {
        const steps = branchSteps(c.result, index);
        const branchCodes = new Set(steps.map(s => s.code));
        const towards: Side = branch.target === "self" && !branch.reflected ? c.casterId : c.defenderId;
        let landsOn: Side = towards;
        if (index === 0) {
            beats.push(flight(c.casterId, towards, Math.max(0, launchedMagnitude)));
            if (codes.has("SILENCE_STRIPPED_MODIFIERS")) beats.push({ kind: "silence", side: c.defenderId });
            if (branch.reflected) {
                beats.push({ kind: "reflect", side: c.defenderId });
                landsOn = c.casterId;
                beats.push(flight(c.defenderId, c.casterId, branch.magnitude));
            }
        } else if (branch.reflected) {
            beats.push({ kind: "reflect", side: c.defenderId });
            landsOn = c.casterId;
            beats.push(flight(c.defenderId, c.casterId, branch.magnitude));
        } else {
            beats.push(flight(c.casterId, towards, branch.magnitude));
        }

        if (branch.action === "break") {
            if (branchCodes.has("WARD_BROKEN")) beats.push({ kind: "ward-break", side: landsOn });
            else beats.push({ kind: "fizzle", side: landsOn, reason: "No ward to break." });
            return;
        }
        if (branchCodes.has("WARD_BLOCKED")) {
            const broken = branchCodes.has("WARD_BROKEN");
            const integrity = integrityFrom(steps.find(s => s.code === "WARD_DENTED")?.text);
            beats.push({ kind: "ward-block", side: landsOn, broken, ...(integrity !== undefined ? { integrity } : {}) });
            return;
        }
        if (branch.action === "bind") {
            beats.push({ kind: "bind", side: landsOn });
        } else {
            const damageText = steps.find(s => s.code === "RESOLVE_DAMAGE")?.text;
            const damage = damageText?.match(/drops by (\d+)/)?.[1];
            beats.push({ kind: "hit", side: landsOn, magnitude: branch.magnitude, ...(damage ? { damage: Number(damage) } : {}) });
        }
    });
    beats.push(...sealBeats(c.result, c.casterId, c.defenderId));
    return decisive(c) ? beats.map(emphasise) : beats;
}

/** Does this contribution decide the match, or land an amplified / split seal? */
function decisive(c: Contribution): boolean {
    const codes = stepCodes(c.result);
    const scorer = c.result.sealAwardedTo;
    const state = c.result.state;
    const winsMatch = scorer !== undefined && state.players[scorer].seals >= 3;
    const knockout = state.rules.resolve > 0 && codes.has("RESOLVE_DAMAGE") && Object.values(state.players).some(p => p.resolve === 0);
    const bigSeal = scorer !== undefined && codes.has("SEEK_HIT") && ((c.result.effect?.magnitude ?? 1) >= 2 || codes.has("SPLIT_APPLIED"));
    return winsMatch || knockout || bigSeal;
}

function emphasise(beat: Beat): Beat {
    return beat.kind === "fly" || beat.kind === "hit" || beat.kind === "seal" ? { ...beat, emphasis: "decisive" } : beat;
}

export function buildTimeline(incoming: Contribution, outgoing?: Contribution): Beat[] {
    return [...contributionBeats(incoming), ...(outgoing ? contributionBeats(outgoing) : [])];
}

// ---------------------------------------------------------------- DOM player

export type StageState = {
    wards: Record<Side, { essence?: string; integrity?: number } | undefined>;
    bound: Record<Side, boolean>;
    gate: GateState;
    gateWard?: { ownerId: Side; integrity?: number } | undefined;
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
    /** The round's phase changed (layout A): a renderer may move its camera. */
    setPhase?(phase: "read" | "react" | "shape" | "cast" | "resolve" | "verdict"): void;
    /** Play beats in order; resolves when done. A second call skips the current run. */
    play(beats: Beat[], state: StageState): Promise<void>;
    /** Forget the floor marks (a new match). */
    clearMarks(): void;
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
    const gate = q<SVGGElement>("#stage-gate");
    const gateDoor = q<SVGRectElement>("#stage-gate-door");
    const gateWard = q<SVGPolygonElement>("#stage-ward-gate");
    const orb = q<SVGCircleElement>("#stage-orb");
    const flash = q<SVGRectElement>("#stage-flash");
    const caption = q<SVGTextElement>("#stage-caption");
    const world = q<SVGGElement>("#stage-world");
    const marks = q<SVGGElement>("#stage-marks");

    let generation = 0;

    // --- Trauma (juice.ts): one number, decayed every frame, drives the shake.
    let trauma = 0;
    let shaking = false;
    let lastFrame = 0;
    const frame = (now: number): void => {
        trauma = decayTrauma(trauma, now - lastFrame);
        lastFrame = now;
        const o = shakeOffset(trauma, now);
        world.setAttribute("transform", `translate(${o.x.toFixed(2)} ${o.y.toFixed(2)}) rotate(${o.rot.toFixed(2)} 180 85)`);
        if (trauma > 0) requestAnimationFrame(frame);
        else {
            world.removeAttribute("transform");
            shaking = false;
        }
    };
    function addTrauma(amount: number): void {
        if (amount <= 0 || motion.reduced() || typeof requestAnimationFrame !== "function") return;
        trauma = Math.min(1, trauma + amount);
        if (!shaking) {
            shaking = true;
            lastFrame = performance.now();
            requestAnimationFrame(frame);
        }
    }

    // --- Permanence: a hit scorches the floor for the rest of the match.
    const MAX_MARKS_PER_SIDE = 8;
    function addMark(mark: FloorMark): void {
        const own = [...marks.querySelectorAll<SVGEllipseElement>(`[data-side="${mark.side}"]`)];
        if (own.length >= MAX_MARKS_PER_SIDE) own[0]?.remove();
        const el = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
        const jitter = ((own.length * 7919) % 17) - 8;
        el.setAttribute("cx", String(X[mark.side] + jitter));
        el.setAttribute("cy", String(Y + 30 + (own.length % 3)));
        el.setAttribute("rx", "13");
        el.setAttribute("ry", "3.2");
        el.setAttribute("fill", essenceColor(mark.essence));
        el.setAttribute("opacity", "0.32");
        el.dataset.side = mark.side;
        marks.append(el);
    }
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

    function drawGateWard(w: StageState["gateWard"]): void {
        if (!w) {
            gateWard.setAttribute("opacity", "0");
            gateWard.classList.remove("cracked");
            return;
        }
        gateWard.setAttribute("opacity", "1");
        // The owner's colour: the player's violet or the opponent's ember.
        const color = w.ownerId === "player" ? "#ad63ff" : "#ff7a3d";
        gateWard.setAttribute("stroke", color);
        gateWard.setAttribute("fill", color);
        gateWard.classList.toggle("cracked", w.integrity === 1);
    }

    function drawGate(state: GateState): void {
        gate.classList.toggle("closed", state === "closed");
        gate.classList.toggle("broken", state === "broken");
        gateDoor.setAttribute("opacity", state === "closed" ? "1" : state === "broken" ? "0.08" : "0.25");
    }

    function setIdle(state: StageState): void {
        for (const side of ["player", "opponent"] as const) {
            drawWard(side, state.wards[side]);
            chains[side].setAttribute("opacity", state.bound[side] ? "1" : "0");
            mage[side].classList.remove("hit", "casting", "faltering");
        }
        drawGate(state.gate);
        drawGateWard(state.gateWard);
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

    /** Trauma replaces the old fixed shake; kept as a name for the call sites. */
    async function shake(): Promise<void> {
        return Promise.resolve();
    }

    async function playBeat(beat: Beat, state: StageState, essence: string | undefined): Promise<void> {
        hooks.onBeat?.(beat);
        addTrauma(traumaFor(beat));
        switch (beat.kind) {
            case "cast": {
                mage[beat.side].classList.add("casting");
                say(`${beat.side === "player" ? "◀" : "▶"} ${beat.spell}`);
                await wait(BEAT_MS.cast);
                mage[beat.side].classList.remove("casting");
                return;
            }
            case "fly":
                return fly(beat.from, beat.to, beat.essence, beat.magnitude, beatDuration(beat));
            case "reflect": {
                say("REFLECT");
                await animate(bolt, [{ transform: bolt.style.transform || "none" }, { transform: `${bolt.style.transform || ""} scale(1.6)` }], BEAT_MS.reflect / 2);
                await animate(bolt, [{ opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }], BEAT_MS.reflect / 2);
                return;
            }
            case "split": {
                say("SPLIT ×2");
                await animate(mage[beat.side], [{ filter: "brightness(1)" }, { filter: "brightness(1.9)" }, { filter: "brightness(1)" }], BEAT_MS.split);
                return;
            }
            case "reverse": {
                say(beat.to ? `REVERSE → ${beat.to}` : "REVERSE");
                await animate(mage[beat.side], [{ transform: "rotate(0)" }, { transform: "rotate(-8deg)" }, { transform: "rotate(6deg)" }, { transform: "rotate(0)" }], BEAT_MS.reverse);
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
            case "ward-break": {
                say("WARD BROKEN");
                bolt.setAttribute("opacity", "0");
                await animate(ward[beat.side], [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(1.6) rotate(-14deg)" }], BEAT_MS["ward-break"]);
                drawWard(beat.side, undefined);
                await shake();
                return;
            }
            case "ward-up": {
                say("WARD");
                drawWard(beat.side, { ...(beat.essence ? { essence: beat.essence } : {}), ...(beat.integrity !== undefined ? { integrity: beat.integrity } : {}) });
                await animate(ward[beat.side], [{ opacity: 0, transform: "scale(0.4)" }, { opacity: 1, transform: "scale(1)" }], BEAT_MS["ward-up"]);
                return;
            }
            case "mend": {
                say("MEND");
                bolt.setAttribute("opacity", "0");
                const w = state.wards[beat.side];
                if (w) drawWard(beat.side, w.essence ? { essence: w.essence } : {}); // full integrity again: no crack
                await animate(mage[beat.side], [{ filter: "brightness(1)" }, { filter: "brightness(1.8)" }, { filter: "brightness(1)" }], BEAT_MS.mend);
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
                drawGate("closed");
                await animate(gateDoor, [{ transform: "translateY(-40px)" }, { transform: "translateY(0)" }], BEAT_MS["gate-close"]);
                await shake();
                return;
            }
            case "gate-open": {
                say("GATE OPENED");
                await animate(gateDoor, [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-40px)", opacity: 0.25 }], BEAT_MS["gate-open"]);
                drawGate("open");
                await shake();
                return;
            }
            case "gate-break": {
                say("GATE SHATTERS");
                await animate(gate, [{ transform: "rotate(0)" }, { transform: "rotate(-4deg) scale(1.05)" }, { transform: "rotate(3deg)" }, { transform: "rotate(0)" }], BEAT_MS["gate-break"]);
                drawGate("broken");
                await shake();
                return;
            }
            case "gate-ward-up": {
                say("GATE WARDED");
                drawGateWard({ ownerId: beat.side, ...(beat.integrity !== undefined ? { integrity: beat.integrity } : {}) });
                await animate(gateWard, [{ opacity: 0, transform: "scale(0.4)" }, { opacity: 1, transform: "scale(1)" }], BEAT_MS["gate-ward-up"]);
                return;
            }
            case "gate-ward-block": {
                say(beat.broken ? "GATE WARD SHATTERS" : "GATE WARD HOLDS");
                if (beat.broken) {
                    await animate(gateWard, [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(1.5) rotate(12deg)" }], BEAT_MS["gate-ward-block"]);
                    drawGateWard(undefined);
                } else {
                    await animate(gateWard, [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], BEAT_MS["gate-ward-block"]);
                    if (state.gateWard) drawGateWard({ ...state.gateWard, ...(beat.integrity !== undefined ? { integrity: beat.integrity } : {}) });
                }
                return;
            }
            case "gate-ward-break": {
                say("GATE WARD BROKEN");
                await animate(gateWard, [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(1.6) rotate(-14deg)" }], BEAT_MS["gate-ward-break"]);
                drawGateWard(undefined);
                return;
            }
            case "gate-mend": {
                say("GATE MENDED");
                drawGate("open");
                await animate(gate, [{ filter: "brightness(1)" }, { filter: "brightness(2)" }, { filter: "brightness(1)" }], BEAT_MS["gate-mend"]);
                return;
            }
            case "hit": {
                const long = beat.emphasis === "decisive";
                say(beat.damage ? `HIT −${beat.damage} RESOLVE` : long ? "HIT!" : "HIT");
                // Hit-stop: the bolt hangs at the point of impact, everything
                // freezes for a beat, then the flash and the kick land together.
                mage[beat.side].classList.add("hit");
                await wait(long ? HIT_STOP_MS * 2 : HIT_STOP_MS);
                bolt.setAttribute("opacity", "0");
                flash.setAttribute("opacity", "0.35");
                const ms = beatDuration(beat);
                const kick = (beat.side === "player" ? -8 : 8) * (beat.magnitude >= 2 ? 1.5 : 1);
                await Promise.all([
                    animate(flash, [{ opacity: 0.35 }, { opacity: 0 }], ms),
                    animate(mage[beat.side], [{ transform: "translateX(0)" }, { transform: `translateX(${kick}px)` }, { transform: "translateX(0)" }], ms)
                ]);
                mage[beat.side].classList.remove("hit");
                const mark = markFor(beat, essence);
                if (mark) addMark(mark);
                return;
            }
            case "seal": {
                const long = beat.emphasis === "decisive";
                say(long ? `SEAL → ${beat.side === "player" ? "◀" : "▶"} · DECISIVE` : `SEAL → ${beat.side === "player" ? "◀" : "▶"}`);
                orb.setAttribute("opacity", "1");
                const x = X[beat.side];
                await animate(orb, [{ transform: `translate(${GATE_X}px, ${Y - 30}px) scale(0.4)`, opacity: 1 }, { transform: `translate(${x}px, 26px) scale(1)`, opacity: 0.2 }], beatDuration(beat));
                orb.setAttribute("opacity", "0");
                if (long) addTrauma(0.4);
                await shake();
                return;
            }
            case "fizzle": {
                say("FIZZLE");
                bolt.setAttribute("opacity", "0");
                await animate(mage[beat.side], [{ opacity: 1 }, { opacity: 0.5 }, { opacity: 1 }], BEAT_MS.fizzle);
                return;
            }
        }
    }

    async function play(beats: Beat[], state: StageState): Promise<void> {
        const mine = ++generation;
        // The bolt's essence colours the floor mark of the hit that follows it.
        let essence: string | undefined;
        for (const beat of beats) {
            if (mine !== generation) return; // skipped by a newer run
            if (beat.kind === "fly") essence = beat.essence;
            if (beat.kind === "cast") essence = beat.essence;
            await playBeat(beat, state, essence);
        }
        if (mine === generation) {
            await wait(300);
            say("");
        }
    }

    return { setIdle, play, clearMarks: () => marks.replaceChildren(), reducedMotion: () => motion.reduced() };
}
