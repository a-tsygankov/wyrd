import type { Rng } from "../../../packages/wyrd-simulation/src/index.js";
import type { Side, Stage, StageState } from "./stage.js";
import { ESSENCES, FOCUS, HEARTS, SMASH_COST, WARD_COST, act, botActions, createVolley, progress, tick, windowMs, windowOpen, type Action, type Essence, type VolleyEvent, type VolleyState } from "./volley.js";

/**
 * The Volley mode on the page (docs/arcade-duel-ideas.md §1 A): a frame loop
 * over the pure state machine in volley.ts, the card's hearts, Focus, speed
 * and pads, the bot's decisions, and the live bolt on whichever renderer is
 * mounted (`Stage.live`). Input arrives from the pads and from gestures on
 * the stage: tap returns, a swipe picks a colour, a long press wards.
 */
export type VolleyDeps = {
    root: HTMLElement;
    stage: () => Stage;
    personalityId: () => string;
    rng: () => Rng;
    names: () => { you: string; them: string };
    /** Divides the clock: 3 makes everything three times slower (tests, accessibility). */
    tempo?: number;
    onOver?: (winner: Side, state: VolleyState) => void;
};

export type VolleyMode = {
    start(): void;
    stop(): void;
    reset(): void;
    act(action: Action): void;
    state(): VolleyState;
    running(): boolean;
};

const ESSENCE_LABEL: Record<Essence, string> = { fire: "FIRE", water: "WATER", shadow: "SHADOW", life: "LIFE" };
/** Swipe direction to essence: up FIRE, right WATER, down SHADOW, left LIFE (the pads sit the same way). */
const SWIPE: Record<"up" | "right" | "down" | "left", Essence> = { up: "fire", right: "water", down: "shadow", left: "life" };

export function createVolleyMode(deps: VolleyDeps): VolleyMode {
    const { root } = deps;
    const q = <T extends HTMLElement>(selector: string): T => {
        const el = root.querySelector<T>(selector);
        if (!el) throw new Error(`volley: missing ${selector}`);
        return el;
    };
    const caption = q<HTMLElement>("#volley-caption");
    const hearts: Record<Side, HTMLElement> = { player: q("#volley-hearts-player"), opponent: q("#volley-hearts-opponent") };
    const focus: Record<Side, HTMLElement> = { player: q("#volley-focus-player"), opponent: q("#volley-focus-opponent") };
    const names: Record<Side, HTMLElement> = { player: q("#volley-name-player"), opponent: q("#volley-name-opponent") };
    const speed = q<HTMLElement>("#volley-speed");
    const pads = Array.from(root.querySelectorAll<HTMLButtonElement>(".volley-pad"));
    const returnButton = q<HTMLButtonElement>("#volley-return");
    const wardButton = q<HTMLButtonElement>("#volley-ward");
    const smashButton = q<HTMLButtonElement>("#volley-smash");
    const rematch = q<HTMLButtonElement>("#volley-rematch");
    const verdict = q<HTMLElement>("#volley-verdict");

    let state: VolleyState = createVolley("opponent");
    let frame = 0;
    let running = false;
    let botDecided = false;
    let lastSpeech = "";
    const tempo = Math.max(1, deps.tempo ?? 1);
    const now = (): number => performance.now() / tempo;

    function stageState(): StageState {
        const ward = (side: Side): StageState["wards"][Side] => {
            const w = state.wards[side];
            return w ? { essence: w.essence, integrity: w.integrity } : undefined;
        };
        return { wards: { player: ward("player"), opponent: ward("opponent") }, bound: { player: false, opponent: false }, gate: "open", seals: { player: 0, opponent: 0 } };
    }

    function say(text: string): void {
        if (text === lastSpeech) return;
        lastSpeech = text;
        caption.textContent = text;
        deps.stage().live?.caption(text);
    }

    function pips(el: HTMLElement, filled: number, total: number, cls: string): void {
        if (el.childElementCount !== total) {
            el.replaceChildren(...Array.from({ length: total }, () => Object.assign(document.createElement("i"), { className: cls })));
        }
        Array.from(el.children).forEach((pip, i) => pip.classList.toggle("lit", i < filled));
        el.setAttribute("aria-label", `${filled} of ${total}`);
    }

    function render(): void {
        const t = now();
        const who = deps.names();
        names.player.textContent = who.you.charAt(0).toUpperCase() + who.you.slice(1);
        names.opponent.textContent = who.them.charAt(0).toUpperCase() + who.them.slice(1);
        for (const side of ["player", "opponent"] as const) {
            pips(hearts[side], state.hearts[side], HEARTS, "heart");
            pips(focus[side], state.focus[side], FOCUS, "focus-pip");
            root.dataset[side === "player" ? "heartsPlayer" : "heartsOpponent"] = String(state.hearts[side]);
            root.dataset[side === "player" ? "focusPlayer" : "focusOpponent"] = String(state.focus[side]);
        }
        root.dataset.phase = state.phase;
        root.dataset.server = state.server;
        const bolt = state.bolt;
        root.dataset.speed = bolt ? String(bolt.speed) : "0";
        root.dataset.owner = bolt ? bolt.owner : "";
        root.dataset.essence = bolt ? bolt.essence : "";
        root.dataset.window = windowOpen(state, t) && bolt?.to === "player" ? "open" : "closed";
        speed.textContent = bolt ? `speed ${bolt.speed} · ${ESSENCE_LABEL[bolt.essence]}${bolt.magnitude > 1 ? ` ×${bolt.magnitude}` : ""}` : state.phase === "over" ? "" : "…";
        const receiving = state.phase === "flight" && bolt?.to === "player";
        for (const pad of pads) {
            const essence = pad.dataset.essence as Essence;
            pad.classList.toggle("selected", state.colour.player === essence);
            pad.disabled = !receiving && state.phase !== "pause" && state.phase !== "serve";
        }
        returnButton.disabled = !receiving;
        wardButton.disabled = !receiving || state.wards.player !== undefined || state.focus.player < WARD_COST;
        wardButton.classList.toggle("selected", state.wards.player !== undefined);
        smashButton.disabled = !receiving || state.armed.player !== undefined || state.focus.player < SMASH_COST;
        smashButton.classList.toggle("selected", state.armed.player !== undefined);
        rematch.classList.toggle("hidden", state.phase !== "over");
        verdict.classList.toggle("hidden", state.phase !== "over");
        if (state.phase === "over") {
            verdict.textContent = state.winner === "player" ? `${names.player.textContent} win the volley ${state.hearts.player}–${state.hearts.opponent}.` : `${names.opponent.textContent} wins the volley ${state.hearts.opponent}–${state.hearts.player}.`;
        }
    }

    function describe(event: VolleyEvent): string | undefined {
        const who = event.side === "player" ? "You" : "They";
        switch (event.kind) {
            case "serve": return `${who} serve · ${ESSENCE_LABEL[event.essence!]}`;
            case "return": return `${who} return · speed ${event.speed}`;
            case "quench": return `${who} quench it · ${ESSENCE_LABEL[event.essence!]}`;
            case "kindle": return `${who} kindle it · ×${event.magnitude}`;
            case "weak": return `${who} barely reach it`;
            case "block": return `${who} block · WARD holds`;
            case "shatter": return `${who} block · WARD shatters`;
            case "hit": return `${event.side === "player" ? "HIT! You" : "HIT! They"} lose ${event.magnitude} heart${event.magnitude === 1 ? "" : "s"}`;
            case "smash": return event.speed ? `${who} SMASH · speed ${event.speed}` : `${who} arm a SMASH`;
            case "ward": return `${who} raise a ${ESSENCE_LABEL[event.essence!]} WARD`;
            case "over": return event.side === "player" ? "You win the volley" : "They win the volley";
            default: return undefined;
        }
    }

    function play(events: VolleyEvent[]): void {
        const stage = deps.stage();
        for (const event of events) {
            const text = describe(event);
            if (text) say(text);
            switch (event.kind) {
                case "hit":
                    stage.live?.burst(event.side, event.essence ?? "fire", "hit");
                    break;
                case "block":
                case "shatter":
                    stage.live?.burst(event.side, event.essence ?? "fire", event.kind);
                    break;
                case "quench":
                case "kindle":
                    stage.live?.burst(event.side, event.essence ?? "fire", event.kind);
                    break;
                case "ward":
                    stage.setIdle(stageState());
                    break;
                case "over":
                    stage.live?.bolt(undefined);
                    deps.onOver?.(event.side, state);
                    break;
                default:
                    break;
            }
        }
        if (events.some(e => e.kind === "block" || e.kind === "shatter" || e.kind === "return" || e.kind === "quench" || e.kind === "kindle" || e.kind === "weak")) stage.setIdle(stageState());
    }

    function step(): void {
        if (!running) return;
        frame = requestAnimationFrame(step);
        const t = now();
        const before = state;
        const { state: next, events } = tick(state, t);
        state = next;
        if (state.phase === "flight" && before.bolt !== state.bolt) botDecided = false;
        if (events.length > 0) play(events);
        // The bot decides once per flight, when its window opens.
        const bolt = state.bolt;
        if (bolt && bolt.to === "opponent" && !botDecided && windowOpen(state, t)) {
            botDecided = true;
            for (const action of botActions(state, deps.personalityId(), deps.rng())) {
                const r = act(state, "opponent", action, t);
                state = r.state;
                if (r.events.length > 0) play(r.events);
            }
        }
        const stage = deps.stage();
        if (bolt && state.phase === "flight") {
            stage.live?.bolt({ from: bolt.owner, to: bolt.to, t: progress(state, t), essence: bolt.essence, magnitude: bolt.magnitude, speed: bolt.speed });
            stage.live?.window(bolt.to, windowOpen(state, t));
        } else {
            stage.live?.bolt(undefined);
            stage.live?.window("player", false);
            stage.live?.window("opponent", false);
        }
        render();
    }

    function playerAct(action: Action): void {
        if (!running) return;
        const r = act(state, "player", action, now());
        state = r.state;
        if (r.events.length > 0) play(r.events);
        render();
    }

    // Pads and buttons.
    for (const pad of pads) pad.addEventListener("click", () => playerAct({ kind: "swipe", essence: pad.dataset.essence as Essence }));
    returnButton.addEventListener("click", () => playerAct({ kind: "tap" }));
    wardButton.addEventListener("click", () => playerAct({ kind: "ward" }));
    smashButton.addEventListener("click", () => playerAct({ kind: "smash" }));
    rematch.addEventListener("click", () => reset());

    // Gestures on the stage: tap = return, swipe = colour, long press = ward.
    let pointer: { x: number; y: number; at: number; timer: number } | undefined;
    function onDown(e: PointerEvent): void {
        if (!running) return;
        const timer = window.setTimeout(() => {
            if (pointer) {
                pointer = undefined;
                playerAct({ kind: "ward" });
            }
        }, 350);
        pointer = { x: e.clientX, y: e.clientY, at: performance.now(), timer };
    }
    function onUp(e: PointerEvent): void {
        if (!pointer) return;
        window.clearTimeout(pointer.timer);
        const dx = e.clientX - pointer.x;
        const dy = e.clientY - pointer.y;
        pointer = undefined;
        if (Math.hypot(dx, dy) >= 24) {
            const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
            playerAct({ kind: "swipe", essence: SWIPE[dir] });
        } else {
            playerAct({ kind: "tap" });
        }
    }
    const surfaces = [document.getElementById("arena"), document.getElementById("stage")].filter((el): el is HTMLElement => el !== null);
    for (const surface of surfaces) {
        surface.addEventListener("pointerdown", onDown);
        surface.addEventListener("pointerup", onUp);
        surface.addEventListener("pointercancel", () => {
            if (pointer) window.clearTimeout(pointer.timer);
            pointer = undefined;
        });
    }

    function start(): void {
        if (running) return;
        running = true;
        root.classList.remove("hidden");
        deps.stage().setIdle(stageState());
        deps.stage().setPhase?.("resolve");
        frame = requestAnimationFrame(step);
        render();
    }
    function stop(): void {
        running = false;
        cancelAnimationFrame(frame);
        deps.stage().live?.bolt(undefined);
        deps.stage().live?.window("player", false);
        deps.stage().live?.window("opponent", false);
        root.classList.add("hidden");
    }
    function reset(): void {
        state = createVolley("opponent", { player: state.colour.player });
        botDecided = false;
        lastSpeech = "";
        say("");
        deps.stage().setIdle(stageState());
        render();
    }

    return { start, stop, reset, act: playerAct, state: () => state, running: () => running };
}

export { ESSENCES, windowMs };
