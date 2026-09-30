import type { Rng } from "../../../packages/wyrd-simulation/src/index.js";
import type { Side, Stage, StageState } from "./stage.js";
import { CHARGE_STEP_MS, FOCUS, RING_MS, WARD_COST, chargeOf, ringProgress, type BotPlan } from "./quickdraw.js";
import { ROUND_LIMIT, STEPS, botAnswer, botDraw, choose, createGateTug, hold, release, tick, ward, type GateTugEvent, type GateTugState } from "./gatetug.js";
import type { Essence } from "./volley.js";

/**
 * Gate tug on the page (docs/arcade-duel-ideas.md §1 D): Quickdraw's ring,
 * orbs, pads, Charge and Ward, with the gate on a rail between the mages
 * instead of hearts. At the close each orb flies to wherever the gate
 * stands (the live bolt, one after the other), then the gate slides and
 * takes the colour of the push that moved it (`Stage.live.gate`). The clock
 * waits on Start like the other arcade games.
 */
export type GateTugDeps = {
    root: HTMLElement;
    stage: () => Stage;
    personalityId: () => string;
    rng: () => Rng;
    names: () => { you: string; them: string };
    tempo?: number;
    onOver?: (winner: Side, state: GateTugState) => void;
};

export type GateTugMode = {
    start(): void;
    begin(): void;
    stop(): void;
    reset(): void;
    state(): GateTugState;
    running(): boolean;
};

const ESSENCE_LABEL: Record<Essence, string> = { fire: "FIRE", water: "WATER", shadow: "SHADOW", life: "LIFE" };
const SWIPE: Record<"up" | "right" | "down" | "left", Essence> = { up: "fire", right: "water", down: "shadow", left: "life" };

type Schedule = { plan: BotPlan; chooseAt?: number; holdAt?: number; releaseAt?: number; wardAt?: number; done: Set<string> };

export function createGateTugMode(deps: GateTugDeps): GateTugMode {
    const { root } = deps;
    const q = <T extends HTMLElement>(selector: string): T => {
        const el = root.querySelector<T>(selector);
        if (!el) throw new Error(`gatetug: missing ${selector}`);
        return el;
    };
    const caption = q<HTMLElement>("#gatetug-caption");
    const roundLabel = q<HTMLElement>("#gatetug-round");
    const ringFill = q<HTMLElement>("#gatetug-ring-fill");
    const rail = q<HTMLElement>("#gatetug-rail");
    const focus: Record<Side, HTMLElement> = { player: q("#gatetug-focus-player"), opponent: q("#gatetug-focus-opponent") };
    const names: Record<Side, HTMLElement> = { player: q("#gatetug-name-player"), opponent: q("#gatetug-name-opponent") };
    const orbs: Record<Side, HTMLElement> = { player: q("#gatetug-orb-player"), opponent: q("#gatetug-orb-opponent") };
    const pads = Array.from(root.querySelectorAll<HTMLButtonElement>(".gatetug-pad"));
    const chargeButton = q<HTMLButtonElement>("#gatetug-charge");
    const wardButton = q<HTMLButtonElement>("#gatetug-ward");
    const rematch = q<HTMLButtonElement>("#gatetug-rematch");
    const verdict = q<HTMLElement>("#gatetug-verdict");
    const startButton = q<HTMLButtonElement>("#gatetug-start");

    let state: GateTugState = createGateTug();
    let frame = 0;
    let running = false;
    let begun = false;
    let replaying = false;
    let schedule: Schedule | undefined;
    let lastSpeech = "";
    /** The gate as drawn, which lags the state while the clash animates. */
    let shownGate = 0;
    const tempo = Math.max(1, deps.tempo ?? 1);
    const now = (): number => performance.now() / tempo;

    function stageState(): StageState {
        const guard = (side: Side): StageState["wards"][Side] => (state.qd.round.draws[side]?.ward ? { essence: state.qd.colour[side], integrity: 2 } : undefined);
        return { wards: { player: guard("player"), opponent: guard("opponent") }, bound: { player: false, opponent: false }, gate: "open", seals: { player: 0, opponent: 0 } };
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

    function telegraph(side: Side, t: number): { essence: Essence; magnitude: number; quick: boolean } | undefined {
        const draw = state.qd.round.draws[side];
        if (!draw?.essence || draw.ward) return undefined;
        return { essence: draw.essence, magnitude: Math.min(3, chargeOf(state.qd, side, t) + (draw.quick ? 1 : 0)), quick: draw.quick };
    }

    function drawGate(): void {
        deps.stage().live?.gate?.(begun ? shownGate / STEPS : 0, begun ? state.temper : undefined);
    }

    function render(): void {
        const t = now();
        const draw = state.qd;
        const who = deps.names();
        names.player.textContent = who.you.charAt(0).toUpperCase() + who.you.slice(1);
        names.opponent.textContent = who.them.charAt(0).toUpperCase() + who.them.slice(1);
        for (const side of ["player", "opponent"] as const) {
            pips(focus[side], draw.focus[side], FOCUS, "focus-pip");
            const key = side === "player" ? "Player" : "Opponent";
            root.dataset[`focus${key}`] = String(draw.focus[side]);
            const shown = telegraph(side, t);
            const mine = draw.round.draws[side];
            orbs[side].style.setProperty("--orb", shown ? `var(--${shown.essence})` : "#3a2f55");
            orbs[side].style.setProperty("--mag", shown ? String(0.7 + shown.magnitude * 0.3) : "0.6");
            orbs[side].classList.toggle("quick", shown?.quick === true);
            orbs[side].classList.toggle("warded", mine?.ward === true);
            orbs[side].textContent = mine?.ward ? "W" : shown ? String(shown.magnitude) : "";
            root.dataset[`essence${key}`] = shown?.essence ?? (mine?.ward ? "ward" : "");
            root.dataset[`charge${key}`] = shown ? String(shown.magnitude) : "0";
        }
        root.dataset.phase = begun ? draw.phase : "ready";
        root.dataset.round = String(draw.round.number);
        root.dataset.gate = String(state.gate);
        root.dataset.temper = state.temper ?? "";
        startButton.classList.toggle("hidden", begun);
        const ring = ringProgress(draw, t);
        ringFill.style.width = `${Math.round((1 - ring) * 100)}%`;
        root.dataset.quickWindow = draw.phase === "draw" && t - draw.round.startedAt < 1000 ? "open" : "closed";
        roundLabel.textContent = !begun || draw.phase === "over" ? "" : state.suddenDeath ? "sudden death" : `round ${draw.round.number} of ${ROUND_LIMIT}`;
        // The rail: 2 * STEPS + 1 cells, the ends are the circles, the gate's cell in its temper.
        if (rail.childElementCount !== 2 * STEPS + 1) rail.replaceChildren(...Array.from({ length: 2 * STEPS + 1 }, () => document.createElement("i")));
        Array.from(rail.children).forEach((cell, i) => {
            const here = i - STEPS === shownGate;
            cell.classList.toggle("gate", here);
            (cell as HTMLElement).style.background = here && state.temper ? `var(--${state.temper})` : "";
        });
        const drawing = draw.phase === "draw" && !replaying && begun;
        const mine = draw.round.draws.player;
        for (const pad of pads) {
            pad.classList.toggle("selected", mine?.essence === pad.dataset.essence);
            pad.disabled = !drawing;
        }
        chargeButton.disabled = !drawing || mine?.ward === true || draw.focus.player < 1;
        chargeButton.classList.toggle("selected", mine?.holdFrom !== undefined);
        wardButton.disabled = !drawing || mine?.ward === true || draw.focus.player < WARD_COST;
        wardButton.classList.toggle("selected", mine?.ward === true);
        rematch.classList.toggle("hidden", draw.phase !== "over");
        verdict.classList.toggle("hidden", draw.phase !== "over");
        if (draw.phase === "over") {
            verdict.textContent = draw.winner === "player" ? `${names.player.textContent} push the gate home.` : `${names.opponent.textContent} pushes the gate home.`;
        }
        const stage = deps.stage();
        for (const side of ["player", "opponent"] as const) {
            const shown = draw.phase === "draw" && begun ? telegraph(side, t) : undefined;
            stage.live?.orb(side, shown ? { essence: shown.essence, magnitude: shown.magnitude } : undefined);
        }
        if (!replaying) drawGate();
    }

    function describe(event: GateTugEvent): string | undefined {
        const who = event.side === "player" ? "You" : "They";
        switch (event.kind) {
            case "open": return "Draw";
            case "ward": return `${who} raise a ${event.essence ? ESSENCE_LABEL[event.essence] + " " : ""}WARD`;
            case "move": return `${event.side === "player" ? "You push" : "They push"} the gate ${Math.abs(event.magnitude ?? 0)} · ${ESSENCE_LABEL[event.essence!]}`;
            case "hold": return "The gate holds";
            case "block": return `${event.side === "player" ? "Your" : "Their"} WARD holds the gate`;
            case "deflect": return `${who} glance off the ${event.essence ? "tempered " : ""}gate`;
            case "sudden": return "Sudden death: the next push wins";
            case "over": return event.side === "player" ? "You push the gate home" : "They push the gate home";
            default: return undefined;
        }
    }

    const tween = (ms: number, fn: (t: number) => void): Promise<void> =>
        new Promise(resolve => {
            if (deps.stage().reducedMotion() || ms <= 0) {
                fn(1);
                resolve();
                return;
            }
            const start = performance.now();
            const stepFrame = (): void => {
                const t = Math.min(1, (performance.now() - start) / ms);
                fn(t);
                if (t < 1) requestAnimationFrame(stepFrame);
                else resolve();
            };
            requestAnimationFrame(stepFrame);
        });

    /** The clash: each orb flies to the gate, the effects land, the gate slides. */
    async function play(events: GateTugEvent[], from: number): Promise<void> {
        const stage = deps.stage();
        for (const event of events) if (event.kind === "ward") stage.setIdle(stageState());
        if (events.some(e => e.kind === "open")) say("Draw");
        const flies = events.filter(e => e.kind === "fly");
        const settled = events.some(e => e.kind === "move" || e.kind === "hold");
        if (!settled) return;
        replaying = true;
        for (const side of ["player", "opponent"] as const) stage.live?.orb(side, undefined);
        // The gate's point on the arc: t runs 0 at the player's hand to 1 at the opponent's.
        const gateT = (from / STEPS + 1) / 2;
        for (const fly of flies) {
            const reach = fly.side === "player" ? gateT : 1 - gateT;
            const to: Side = fly.side === "player" ? "opponent" : "player";
            await tween(260 * tempo, t => stage.live?.bolt({ from: fly.side, to, t: t * reach, essence: fly.essence ?? "fire", magnitude: fly.magnitude ?? 1, speed: 2 }));
        }
        stage.live?.bolt(undefined);
        for (const e of events) {
            if (e.kind === "block") stage.live?.burst(e.side, e.essence ?? "fire", "block");
            if (e.kind === "cancel") stage.live?.burst(e.side, e.essence ?? "fire", "quench");
        }
        const last = [...events].reverse().find(e => e.kind === "move" || e.kind === "hold" || e.kind === "block" || e.kind === "deflect");
        if (last) say(describe(last) ?? "");
        const target = state.gate;
        await tween(380 * tempo, t => {
            shownGate = Math.round(from + (target - from) * t);
            stage.live?.gate?.((from + (target - from) * t) / STEPS, state.temper);
        });
        shownGate = target;
        replaying = false;
        const over = events.find(e => e.kind === "over");
        const sudden = events.find(e => e.kind === "sudden");
        if (sudden) say(describe(sudden) ?? "");
        if (over) {
            say(describe(over) ?? "");
            deps.onOver?.(over.side, state);
        }
        stage.setIdle(stageState());
        render();
    }

    function planBot(): void {
        const plan = botDraw(state, deps.personalityId(), deps.rng());
        const start = state.qd.round.startedAt;
        const r = deps.rng().next();
        const s: Schedule = { plan, done: new Set() };
        if (plan.ward) s.wardAt = start + 500 + r * 900;
        else {
            s.chooseAt = plan.quick ? start + 150 + r * 700 : start + 1100 + r * 1000;
            const steps = Math.max(0, (plan.charge ?? 1) - 1);
            if (steps > 0) {
                s.holdAt = Math.min(s.chooseAt, start + RING_MS - steps * CHARGE_STEP_MS - 80);
                s.releaseAt = s.holdAt + steps * CHARGE_STEP_MS + 40;
            }
        }
        schedule = s;
    }

    function runBot(t: number): void {
        if (!schedule || state.qd.phase !== "draw") return;
        const s = schedule;
        const apply = (key: string, at: number | undefined, fn: () => void): void => {
            if (at !== undefined && t >= at && !s.done.has(key)) {
                s.done.add(key);
                fn();
            }
        };
        apply("ward", s.wardAt, () => {
            const r = ward(state, "opponent", t);
            state = r.state;
            void play(r.events, shownGate);
        });
        apply("choose", s.chooseAt, () => {
            if (!s.plan.essence) return;
            // A late draw reads an orb you have already shown.
            const essence = s.plan.quick ? s.plan.essence : botAnswer(state, deps.personalityId(), deps.rng(), s.plan.essence);
            state = choose(state, "opponent", essence, t).state;
        });
        apply("hold", s.holdAt, () => (state = hold(state, "opponent", t).state));
        apply("release", s.releaseAt, () => (state = release(state, "opponent", t).state));
    }

    function step(): void {
        if (!running) return;
        frame = requestAnimationFrame(step);
        if (!begun) {
            render();
            return;
        }
        const t = now();
        if (!replaying) {
            const from = state.gate;
            const r = tick(state, t);
            state = r.state;
            if (r.events.some(e => e.kind === "open")) planBot();
            if (r.events.length > 0) void play(r.events, from);
            if (state.qd.phase === "draw") runBot(t);
        }
        render();
    }

    function playerChoose(essence: Essence): void {
        if (!running || replaying || !begun) return;
        state = choose(state, "player", essence, now()).state;
        render();
    }
    function playerHold(): void {
        if (!running || replaying || !begun) return;
        state = hold(state, "player", now()).state;
        render();
    }
    function playerRelease(): void {
        if (!running || !begun) return;
        state = release(state, "player", now()).state;
        render();
    }
    function playerWard(): void {
        if (!running || replaying || !begun) return;
        const r = ward(state, "player", now());
        state = r.state;
        void play(r.events, shownGate);
        render();
    }

    for (const pad of pads) pad.addEventListener("click", () => playerChoose(pad.dataset.essence as Essence));
    chargeButton.addEventListener("pointerdown", e => {
        e.preventDefault();
        playerHold();
    });
    for (const type of ["pointerup", "pointercancel", "pointerleave"] as const) chargeButton.addEventListener(type, playerRelease);
    wardButton.addEventListener("click", playerWard);
    rematch.addEventListener("click", () => {
        reset();
        begin();
    });
    startButton.addEventListener("click", () => begin());

    // Gestures on the stage, as in Quickdraw: swipe picks a colour, press and hold charges.
    let pointer: { x: number; y: number; timer: number; holding: boolean } | undefined;
    function onDown(e: PointerEvent): void {
        if (!running || !begun) return;
        const timer = window.setTimeout(() => {
            if (pointer) {
                pointer.holding = true;
                playerHold();
            }
        }, 250);
        pointer = { x: e.clientX, y: e.clientY, timer, holding: false };
    }
    function onUp(e: PointerEvent): void {
        if (!pointer) return;
        window.clearTimeout(pointer.timer);
        const { x, y, holding } = pointer;
        pointer = undefined;
        if (holding) {
            playerRelease();
            return;
        }
        const dx = e.clientX - x;
        const dy = e.clientY - y;
        if (Math.hypot(dx, dy) >= 24) {
            const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
            playerChoose(SWIPE[dir]);
        }
    }
    const surfaces = [document.getElementById("arena"), document.getElementById("stage")].filter((el): el is HTMLElement => el !== null);
    for (const surface of surfaces) {
        surface.addEventListener("pointerdown", onDown);
        surface.addEventListener("pointerup", onUp);
        surface.addEventListener("pointercancel", () => {
            if (pointer) window.clearTimeout(pointer.timer);
            if (pointer?.holding) playerRelease();
            pointer = undefined;
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
        replaying = false;
        cancelAnimationFrame(frame);
        for (const side of ["player", "opponent"] as const) deps.stage().live?.orb(side, undefined);
        deps.stage().live?.bolt(undefined);
        // Other games expect the gate in the middle and untinted.
        deps.stage().live?.gate?.(0, undefined);
        root.classList.add("hidden");
    }
    function begin(): void {
        if (begun) return;
        // A fresh match so the first ring is timed from this press, not from mount.
        state = createGateTug({ player: state.qd.colour.player });
        shownGate = 0;
        begun = true;
        say("");
        render();
    }
    function reset(): void {
        state = createGateTug({ player: state.qd.colour.player });
        shownGate = 0;
        begun = false;
        schedule = undefined;
        replaying = false;
        lastSpeech = "";
        say("Press Start");
        deps.stage().setIdle(stageState());
        render();
    }

    return { start, begin, stop, reset, state: () => state, running: () => running };
}
