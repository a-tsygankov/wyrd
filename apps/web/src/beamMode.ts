import type { Rng } from "../../../packages/wyrd-simulation/src/index.js";
import type { Side, Stage, StageState } from "./stage.js";
import { BEAT_MS, BEAT_WINDOW_MS, FOCUS, SEALS_TO_WIN, STEPS, SWITCH_COST, WARD_COST, act, beatTime, botBeat, createBeam, onBeat, tick, timeLeft, type BeamEvent, type BeamState } from "./beam.js";
import type { Essence } from "./volley.js";

/**
 * Beam clash on the page (docs/arcade-duel-ideas.md §1 B): the metronome,
 * the knot track, seals and Focus, the pads that switch the beam's colour,
 * Ward and Push, the bot's play per beat, and the two beams and the knot on
 * whichever renderer is mounted (`Stage.live`). A push registers on
 * pointerdown, not click: in a rhythm game the release would add the whole
 * press to the touch latency. The clock waits on Start like the other
 * arcade games.
 */
export type BeamDeps = {
    root: HTMLElement;
    stage: () => Stage;
    personalityId: () => string;
    rng: () => Rng;
    names: () => { you: string; them: string };
    /** The metronome's tick (the sound module; silent when sound is off). */
    cue?: (name: "tick" | "tick2") => void;
    tempo?: number;
    onOver?: (winner: Side, state: BeamState) => void;
};

export type BeamMode = {
    start(): void;
    begin(): void;
    stop(): void;
    reset(): void;
    state(): BeamState;
    running(): boolean;
};

const ESSENCE_LABEL: Record<Essence, string> = { fire: "FIRE", water: "WATER", shadow: "SHADOW", life: "LIFE" };

export function createBeamMode(deps: BeamDeps): BeamMode {
    const { root } = deps;
    const q = <T extends HTMLElement>(selector: string): T => {
        const el = root.querySelector<T>(selector);
        if (!el) throw new Error(`beam: missing ${selector}`);
        return el;
    };
    const caption = q<HTMLElement>("#beam-caption");
    const clock = q<HTMLElement>("#beam-clock");
    const seals: Record<Side, HTMLElement> = { player: q("#beam-seals-player"), opponent: q("#beam-seals-opponent") };
    const focus: Record<Side, HTMLElement> = { player: q("#beam-focus-player"), opponent: q("#beam-focus-opponent") };
    const names: Record<Side, HTMLElement> = { player: q("#beam-name-player"), opponent: q("#beam-name-opponent") };
    const track = q<HTMLElement>("#beam-track");
    const pads = Array.from(root.querySelectorAll<HTMLButtonElement>(".beam-pad"));
    const pushButton = q<HTMLButtonElement>("#beam-push");
    const wardButton = q<HTMLButtonElement>("#beam-ward");
    const rematch = q<HTMLButtonElement>("#beam-rematch");
    const verdict = q<HTMLElement>("#beam-verdict");
    const startButton = q<HTMLButtonElement>("#beam-start");

    let state: BeamState = createBeam();
    let frame = 0;
    let running = false;
    let begun = false;
    /** The beat the bot has already planned, and the one the metronome last sounded. */
    let botPlanned = -1;
    let ticked = -1;
    /** The bot's tap for the coming beat, applied when the clock reaches it. */
    let pendingBotTap: { beat: number; at: number } | undefined;
    /** The count-in number last spoken. */
    let countIn = 0;
    let lastSpeech = "";
    const tempo = Math.max(1, deps.tempo ?? 1);
    const now = (): number => performance.now() / tempo;

    function stageState(): StageState {
        const ward = (side: Side): StageState["wards"][Side] => {
            const w = state.wards[side];
            return w ? { essence: state.colour[side], integrity: w.integrity } : undefined;
        };
        return { wards: { player: ward("player"), opponent: ward("opponent") }, bound: { player: false, opponent: false }, gate: "open", seals: { ...state.seals } };
    }

    function say(text: string): void {
        if (text === lastSpeech) return;
        lastSpeech = text;
        caption.textContent = text;
        deps.stage().live?.caption(text);
    }

    function pips(el: HTMLElement, filled: number, total: number, cls: string): void {
        if (el.childElementCount !== total) el.replaceChildren(...Array.from({ length: total }, () => Object.assign(document.createElement("i"), { className: cls })));
        Array.from(el.children).forEach((pip, i) => pip.classList.toggle("lit", i < filled));
        el.setAttribute("aria-label", `${filled} of ${total}`);
    }

    function render(): void {
        const t = now();
        const who = deps.names();
        names.player.textContent = who.you.charAt(0).toUpperCase() + who.you.slice(1);
        names.opponent.textContent = who.them.charAt(0).toUpperCase() + who.them.slice(1);
        for (const side of ["player", "opponent"] as const) {
            pips(seals[side], state.seals[side], SEALS_TO_WIN, "seal-pip");
            pips(focus[side], state.focus[side], FOCUS, "focus-pip");
            const key = side === "player" ? "Player" : "Opponent";
            root.dataset[`seals${key}`] = String(state.seals[side]);
            root.dataset[`focus${key}`] = String(state.focus[side]);
            root.dataset[`colour${key}`] = state.colour[side];
        }
        root.dataset.phase = begun ? state.phase : "ready";
        root.dataset.knot = String(state.knot);
        root.dataset.beat = begun && onBeat(state, t) ? "on" : "off";
        startButton.classList.toggle("hidden", begun);
        // The track: 2 * STEPS + 1 cells, the knot's cell lit in the colour pushing it.
        if (track.childElementCount !== 2 * STEPS + 1) track.replaceChildren(...Array.from({ length: 2 * STEPS + 1 }, () => document.createElement("i")));
        Array.from(track.children).forEach((cell, i) => cell.classList.toggle("knot", i - STEPS === state.knot));
        clock.textContent = !begun || state.phase === "over" ? "" : state.suddenDeath ? "sudden death" : `${timeLeft(state, t)} s`;
        const live = begun && state.phase === "clash";
        const pending = state.pending.player?.essence;
        for (const pad of pads) {
            const essence = pad.dataset.essence as Essence;
            pad.classList.toggle("selected", state.colour.player === essence);
            pad.classList.toggle("pending", pending === essence);
            pad.disabled = !live;
        }
        const nextSwitch = state.switches.player >= 1 ? SWITCH_COST : 0;
        root.dataset.switchCost = String(nextSwitch);
        pushButton.disabled = !live;
        wardButton.disabled = !live || state.wardUsed.player || state.focus.player < WARD_COST;
        wardButton.classList.toggle("selected", state.wards.player !== undefined);
        rematch.classList.toggle("hidden", state.phase !== "over");
        verdict.classList.toggle("hidden", state.phase !== "over");
        if (state.phase === "over") {
            verdict.textContent = state.winner === "player" ? `${names.player.textContent} win the beam clash ${state.seals.player}–${state.seals.opponent}.` : `${names.opponent.textContent} wins the beam clash ${state.seals.opponent}–${state.seals.player}.`;
        }
        drawBeams();
    }

    /** The two beams meeting in the knot: t runs 0 at the player's hand to 1 at the opponent's. */
    function drawBeams(): void {
        const live = deps.stage().live;
        if (!begun || (state.phase !== "clash" && state.phase !== "pause")) {
            live?.beams?.(undefined);
            live?.bolt(undefined);
            live?.window("player", false);
            return;
        }
        const t = (state.knot + STEPS) / (2 * STEPS);
        // The knot takes the colour of whoever is winning the push, white when level.
        const lead: Side | undefined = state.knot > 0 ? "player" : state.knot < 0 ? "opponent" : undefined;
        live?.beams?.({ player: state.colour.player, opponent: state.colour.opponent, t });
        // The gold ring under your mage breathes with the beat.
        live?.window("player", state.phase === "clash" && onBeat(state, now()));
        live?.bolt({ from: "player", to: "opponent", t, essence: lead ? state.colour[lead] : "spell", magnitude: 1 + Math.abs(state.knot) / 2, speed: 1 });
    }

    function describe(event: BeamEvent): string | undefined {
        const who = event.side === "player" ? "You" : "They";
        switch (event.kind) {
            case "open": return "Push on the beat";
            case "switch": return `${who} switch to ${ESSENCE_LABEL[event.essence!]}`;
            case "ward": return `${who} raise a WARD`;
            case "block": return `${event.side === "player" ? "Your" : "Their"} WARD holds`;
            case "shatter": return `${event.side === "player" ? "Your" : "Their"} WARD shatters`;
            case "seal": return `${event.side === "player" ? "SEAL! You" : "SEAL! They"} score · ${event.magnitude}`;
            case "sudden": return "Time · sudden death";
            case "over": return event.side === "player" ? "You win the clash" : "They win the clash";
            case "offbeat": return event.side === "player" ? "Off the beat · −1 Focus" : undefined;
            default: return undefined;
        }
    }

    function play(events: BeamEvent[]): void {
        const stage = deps.stage();
        for (const event of events) {
            const text = describe(event);
            if (text) say(text);
            switch (event.kind) {
                case "seal":
                    stage.live?.burst(event.side === "player" ? "opponent" : "player", event.essence ?? "fire", "hit");
                    stage.setIdle(stageState());
                    break;
                case "block":
                case "shatter":
                    stage.live?.burst(event.side, event.essence ?? "fire", event.kind);
                    stage.setIdle(stageState());
                    break;
                case "ward":
                    stage.setIdle(stageState());
                    break;
                case "switch":
                    stage.live?.burst(event.side, event.essence ?? "fire", "kindle");
                    break;
                case "over":
                    deps.onOver?.(event.side, state);
                    break;
                default:
                    break;
            }
        }
    }

    function step(): void {
        if (!running) return;
        frame = requestAnimationFrame(step);
        if (!begun) {
            render();
            return;
        }
        const t = now();
        const r = tick(state, t);
        state = r.state;
        if (r.events.length > 0) play(r.events);
        if (state.phase === "clash" && pendingBotTap && pendingBotTap.beat === state.beat && t >= pendingBotTap.at) {
            const res = act(state, "opponent", { kind: "tap" }, pendingBotTap.at);
            state = res.state;
            pendingBotTap = undefined;
        }
        if (state.phase === "clash" && t < state.startedAt - BEAT_WINDOW_MS) {
            // The count-in, spoken and ticked: 4, 3, 2, 1, then the first push beat.
            const left = Math.ceil((state.startedAt - t) / BEAT_MS);
            if (left !== countIn) {
                countIn = left;
                say(String(left));
                deps.cue?.("tick");
            }
        }
        if (state.phase === "clash") {
            // The metronome, once per beat as its window opens.
            const at = beatTime(state, state.beat);
            if (state.beat !== ticked && t >= at - BEAT_WINDOW_MS / 2 && at >= state.startedAt) {
                ticked = state.beat;
                if (state.beat === 0) say("Push!");
                deps.cue?.(state.beat % 4 === 0 ? "tick2" : "tick");
            }
            // The bot plans each beat once, as its window opens, and acts on the beat.
            if (state.beat !== botPlanned && t >= at - BEAT_WINDOW_MS) {
                botPlanned = state.beat;
                const plan = botBeat(state, deps.personalityId(), deps.rng());
                const apply = (action: Parameters<typeof act>[2]): void => {
                    const res = act(state, "opponent", action, Math.max(t, at - BEAT_WINDOW_MS + 1));
                    state = res.state;
                    if (res.events.length > 0) play(res.events);
                };
                if (plan.switchTo) apply({ kind: "switch", essence: plan.switchTo });
                if (plan.ward) apply({ kind: "ward" });
                // A perfect tap lands on the beat; a good one a little either side of it.
                if (plan.tap) {
                    const offset = plan.tap === "perfect" ? 0 : (deps.rng().next() < 0.5 ? -1 : 1) * 80;
                    pendingBotTap = { beat: state.beat, at: at + offset };
                }
            }
        }
        render();
    }

    function playerAct(action: Parameters<typeof act>[2]): void {
        if (!running || !begun) return;
        const r = act(state, "player", action, now());
        state = r.state;
        if (r.events.length > 0) play(r.events);
        render();
    }

    for (const pad of pads) pad.addEventListener("click", () => playerAct({ kind: "switch", essence: pad.dataset.essence as Essence }));
    pushButton.addEventListener("pointerdown", e => {
        e.preventDefault();
        playerAct({ kind: "tap" });
    });
    // Keyboard and assistive tech press buttons without a pointer: count those too.
    pushButton.addEventListener("click", e => {
        if (e.detail === 0) playerAct({ kind: "tap" });
    });
    wardButton.addEventListener("click", () => playerAct({ kind: "ward" }));
    rematch.addEventListener("click", () => {
        reset();
        begin();
    });
    startButton.addEventListener("click", () => begin());
    // The stage itself is one big push pad.
    const surfaces = [document.getElementById("arena"), document.getElementById("stage")].filter((el): el is HTMLElement => el !== null);
    for (const surface of surfaces) {
        surface.addEventListener("pointerdown", () => {
            if (running && begun) playerAct({ kind: "tap" });
        });
    }

    function start(): void {
        if (running) return;
        running = true;
        root.classList.remove("hidden");
        deps.stage().setIdle(stageState());
        deps.stage().setPhase?.("cast");
        if (!begun) {
            // A remount may be a new renderer: its caption has not heard this yet.
            lastSpeech = "";
            say("Press Start");
        }
        frame = requestAnimationFrame(step);
        render();
    }
    function stop(): void {
        running = false;
        cancelAnimationFrame(frame);
        deps.stage().live?.beams?.(undefined);
        deps.stage().live?.bolt(undefined);
        deps.stage().live?.window("player", false);
        root.classList.add("hidden");
    }
    function begin(): void {
        if (begun) return;
        // A fresh clash so the count-in is timed from this press, not from mount.
        state = createBeam({ player: state.colour.player });
        begun = true;
        botPlanned = -1;
        ticked = -1;
        countIn = 0;
        say("");
        render();
    }
    function reset(): void {
        state = createBeam({ player: state.colour.player });
        begun = false;
        botPlanned = -1;
        ticked = -1;
        countIn = 0;
        lastSpeech = "";
        say("Press Start");
        deps.stage().setIdle(stageState());
        render();
    }

    return { start, begin, stop, reset, state: () => state, running: () => running };
}
