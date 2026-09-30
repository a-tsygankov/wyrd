import type { Rng } from "../../../packages/wyrd-simulation/src/index.js";
import type { Side, Stage, StageState } from "./stage.js";
import { HEARTS, MAX_MAGNITUDE, VOLLEYS, WINDOW_MS, act, botPlanner, createWardRhythm, flightMs, tick, type Planner, type WardRhythmEvent, type WardRhythmState } from "./wardrhythm.js";
import type { Essence } from "./volley.js";

/**
 * Ward rhythm on the page (docs/arcade-duel-ideas.md §1 E): the lane where
 * the volley's bolts slide toward the hit line, the four pads (a ward while
 * they throw, your throw's colour after), hearts, and on the stage the
 * nearest bolt in flight, their ward in its colour and your charged orb.
 * Pads answer on pointerdown: in a rhythm game the release would add the
 * whole press to the touch latency. The clock waits on Start.
 */
export type WardRhythmDeps = {
    root: HTMLElement;
    stage: () => Stage;
    personalityId: () => string;
    rng: () => Rng;
    names: () => { you: string; them: string };
    tempo?: number;
    onOver?: (winner: Side | undefined, state: WardRhythmState) => void;
};

export type WardRhythmMode = {
    start(): void;
    begin(): void;
    stop(): void;
    reset(): void;
    state(): WardRhythmState;
    running(): boolean;
};

const ESSENCE_LABEL: Record<Essence, string> = { fire: "FIRE", water: "WATER", shadow: "SHADOW", life: "LIFE" };
const SWIPE: Record<"up" | "right" | "down" | "left", Essence> = { up: "fire", right: "water", down: "shadow", left: "life" };
/** Where the hit line sits on the lane, in percent from the left. */
const HIT_LINE = 10;

export function createWardRhythmMode(deps: WardRhythmDeps): WardRhythmMode {
    const { root } = deps;
    const q = <T extends HTMLElement>(selector: string): T => {
        const el = root.querySelector<T>(selector);
        if (!el) throw new Error(`wardrhythm: missing ${selector}`);
        return el;
    };
    const caption = q<HTMLElement>("#wr-caption");
    const roundLabel = q<HTMLElement>("#wr-round");
    const lane = q<HTMLElement>("#wr-lane");
    const wardChip = q<HTMLElement>("#wr-ward");
    const hearts: Record<Side, HTMLElement> = { player: q("#wr-hearts-player"), opponent: q("#wr-hearts-opponent") };
    const names: Record<Side, HTMLElement> = { player: q("#wr-name-player"), opponent: q("#wr-name-opponent") };
    const pads = Array.from(root.querySelectorAll<HTMLButtonElement>(".wr-pad"));
    const rematch = q<HTMLButtonElement>("#wr-rematch");
    const verdict = q<HTMLElement>("#wr-verdict");
    const startButton = q<HTMLButtonElement>("#wr-start");

    let state: WardRhythmState = createWardRhythm();
    let planner: Planner = botPlanner(deps.personalityId(), deps.rng());
    let frame = 0;
    let running = false;
    let begun = false;
    let lastSpeech = "";
    const tempo = Math.max(1, deps.tempo ?? 1);
    const now = (): number => performance.now() / tempo;

    function stageState(): StageState {
        const theirs = state.phase === "attack" && state.attack ? { essence: state.attack.ward, integrity: 2 } : undefined;
        return { wards: { player: undefined, opponent: theirs }, bound: { player: false, opponent: false }, gate: "open", seals: { player: 0, opponent: 0 } };
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
            pips(hearts[side], state.hearts[side], HEARTS, "heart");
            root.dataset[side === "player" ? "heartsPlayer" : "heartsOpponent"] = String(state.hearts[side]);
        }
        root.dataset.phase = begun ? state.phase : "ready";
        root.dataset.exchange = String(state.exchange);
        root.dataset.absorbed = String(state.absorbed);
        startButton.classList.toggle("hidden", begun);
        const defending = begun && state.phase === "defend";
        const attacking = begun && state.phase === "attack" && state.attack !== undefined;
        roundLabel.textContent = !begun || state.phase === "over" ? "" : attacking ? `your throw · ${VOLLEYS - state.exchange + 1} left` : `volley ${state.exchange} of ${VOLLEYS}`;

        // The lane: each unanswered bolt slides from the right to the hit line as it flies.
        const bolts = defending ? state.volley.bolts : [];
        const flight = flightMs(state.exchange);
        while (lane.childElementCount < bolts.length + 1) lane.append(document.createElement("i"));
        const cells = Array.from(lane.querySelectorAll<HTMLElement>("i"));
        cells.forEach((cell, i) => {
            const bolt = bolts[i];
            const ahead = bolt ? (bolt.landsAt - t) / flight : 2;
            const visible = bolt !== undefined && !bolt.result && ahead <= 1.4;
            cell.classList.toggle("hidden", !visible);
            if (!bolt || !visible) return;
            cell.style.left = `${HIT_LINE + Math.max(-4, ahead) * (100 - HIT_LINE) / 1.4}%`;
            cell.style.background = `var(--${bolt.essence})`;
            cell.classList.toggle("due", Math.abs(t - bolt.landsAt) <= WINDOW_MS);
        });
        const next = bolts.find(b => !b.result);
        root.dataset.next = next?.essence ?? "";
        const inWindow = bolts.some(b => !b.result && Math.abs(t - b.landsAt) <= WINDOW_MS);
        root.dataset.window = inWindow ? "open" : "closed";

        // Their ward, as a chip on the card while you throw.
        wardChip.classList.toggle("hidden", !attacking);
        if (attacking) {
            wardChip.textContent = `their ward · ${ESSENCE_LABEL[state.attack!.ward]}`;
            wardChip.style.borderColor = `var(--${state.attack!.ward})`;
            root.dataset.ward = state.attack!.ward;
        } else delete root.dataset.ward;
        const thrown = state.attack?.thrown?.essence;
        for (const pad of pads) {
            pad.disabled = !(defending || (attacking && !thrown));
            pad.classList.toggle("selected", attacking ? thrown === pad.dataset.essence : false);
        }
        rematch.classList.toggle("hidden", state.phase !== "over");
        verdict.classList.toggle("hidden", state.phase !== "over");
        if (state.phase === "over") {
            verdict.textContent =
                state.winner === "player" ? `${names.player.textContent} win the ward rhythm ${state.hearts.player}–${state.hearts.opponent}.` : state.winner === "opponent" ? `${names.opponent.textContent} wins the ward rhythm ${state.hearts.opponent}–${state.hearts.player}.` : `A draw at ${state.hearts.player}–${state.hearts.opponent}.`;
        }

        // The stage: the nearest bolt in flight and the window ring; your charged orb while you throw.
        const live = deps.stage().live;
        if (defending && next) {
            live?.bolt({ from: "opponent", to: "player", t: Math.max(0, Math.min(1, 1 - (next.landsAt - t) / flight)), essence: next.essence, magnitude: 1, speed: 2 });
        } else live?.bolt(undefined);
        live?.window("player", inWindow);
        live?.orb("player", attacking ? { essence: thrown ?? state.colour.player, magnitude: Math.min(MAX_MAGNITUDE, 1 + state.absorbed) } : undefined);
    }

    function describe(event: WardRhythmEvent): string | undefined {
        switch (event.kind) {
            case "volley": return `Their volley · ${event.magnitude} bolts`;
            case "block": return `Blocked · ${ESSENCE_LABEL[event.essence!]}`;
            case "absorb": return `Absorbed · +1 to your throw`;
            case "hit": return "HIT! You lose a heart";
            case "attack": return `Your throw · they ward ${ESSENCE_LABEL[event.essence!]}`;
            case "feint": return `They switch to ${ESSENCE_LABEL[event.essence!]}`;
            case "strike": return `STRIKE! They lose ${event.magnitude} heart${event.magnitude === 1 ? "" : "s"}`;
            case "glance": return "A glancing hit · 1 heart";
            case "guarded": return "Their ward holds";
            default: return undefined;
        }
    }

    function play(events: WardRhythmEvent[]): void {
        const stage = deps.stage();
        for (const event of events) {
            const text = describe(event);
            if (text) say(text);
            switch (event.kind) {
                case "block":
                    stage.live?.burst("player", event.essence ?? "fire", "quench");
                    break;
                case "absorb":
                    stage.live?.burst("player", event.essence ?? "fire", "kindle");
                    break;
                case "hit":
                    stage.live?.burst("player", event.essence ?? "fire", "hit");
                    break;
                case "attack":
                case "feint":
                    stage.setIdle(stageState());
                    break;
                case "strike":
                case "glance":
                    stage.live?.burst("opponent", event.essence ?? "fire", "hit");
                    break;
                case "guarded":
                    stage.live?.burst("opponent", event.essence ?? "fire", "block");
                    break;
                case "over":
                    say(state.winner === "player" ? "You win the ward rhythm" : state.winner === "opponent" ? "They win the ward rhythm" : "A draw");
                    deps.onOver?.(state.winner, state);
                    break;
                default:
                    break;
            }
        }
        if (events.some(e => e.kind === "volley" || e.kind === "strike" || e.kind === "glance" || e.kind === "guarded")) stage.setIdle(stageState());
    }

    function step(): void {
        if (!running) return;
        frame = requestAnimationFrame(step);
        if (begun) {
            const r = tick(state, now(), planner);
            state = r.state;
            if (r.events.length > 0) play(r.events);
        }
        render();
    }

    function press(essence: Essence): void {
        if (!running || !begun) return;
        const kind = state.phase === "attack" ? "throw" : "ward";
        const r = act(state, "player", { kind, essence }, now());
        state = r.state;
        if (r.events.length > 0) play(r.events);
        if (kind === "throw" && state.attack?.thrown) say(`You throw ${ESSENCE_LABEL[essence]}`);
        render();
    }

    for (const pad of pads) {
        pad.addEventListener("pointerdown", e => {
            e.preventDefault();
            press(pad.dataset.essence as Essence);
        });
        // Keyboard and assistive tech press buttons without a pointer.
        pad.addEventListener("click", e => {
            if (e.detail === 0) press(pad.dataset.essence as Essence);
        });
    }
    rematch.addEventListener("click", () => {
        reset();
        begin();
    });
    startButton.addEventListener("click", () => begin());

    // On the stage a swipe is a pad: up FIRE, right WATER, down SHADOW, left LIFE.
    let pointer: { x: number; y: number } | undefined;
    const surfaces = [document.getElementById("arena"), document.getElementById("stage")].filter((el): el is HTMLElement => el !== null);
    for (const surface of surfaces) {
        surface.addEventListener("pointerdown", e => {
            if (running && begun) pointer = { x: e.clientX, y: e.clientY };
        });
        surface.addEventListener("pointerup", e => {
            if (!pointer) return;
            const dx = e.clientX - pointer.x;
            const dy = e.clientY - pointer.y;
            pointer = undefined;
            if (Math.hypot(dx, dy) < 24) return;
            press(SWIPE[Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up"]);
        });
        surface.addEventListener("pointercancel", () => (pointer = undefined));
    }

    function start(): void {
        if (running) return;
        running = true;
        root.classList.remove("hidden");
        deps.stage().setIdle(stageState());
        // Volley's camera: both mages and the bolt's whole path in view.
        deps.stage().setPhase?.("resolve");
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
        deps.stage().live?.bolt(undefined);
        deps.stage().live?.orb("player", undefined);
        deps.stage().live?.window("player", false);
        root.classList.add("hidden");
    }
    function begin(): void {
        if (begun) return;
        // A fresh match and a fresh planner, timed from this press.
        state = createWardRhythm({ player: state.colour.player });
        planner = botPlanner(deps.personalityId(), deps.rng());
        begun = true;
        say("");
        render();
    }
    function reset(): void {
        state = createWardRhythm({ player: state.colour.player });
        begun = false;
        lastSpeech = "";
        say("Press Start");
        deps.stage().setIdle(stageState());
        render();
    }

    return { start, begin, stop, reset, state: () => state, running: () => running };
}
