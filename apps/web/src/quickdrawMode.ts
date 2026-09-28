import type { Rng } from "../../../packages/wyrd-simulation/src/index.js";
import type { Beat, Side, Stage, StageState } from "./stage.js";
import { CHARGE_STEP_MS, FOCUS, HEARTS, RING_MS, WARD_COST, botDraw, chargeOf, choose, createQuickdraw, hold, release, ringProgress, tick, ward, type BotPlan, type QuickdrawEvent, type QuickdrawState } from "./quickdraw.js";
import type { Essence } from "./volley.js";

/**
 * Quickdraw on the page (docs/arcade-duel-ideas.md §1 C): the ring, the two
 * orbs as telegraphs, the pads, Charge (hold) and Ward, the bot's plan
 * applied across the ring, and the clash replayed through the stage's beat
 * timeline so both renderers play their full effects.
 */
export type QuickdrawDeps = {
    root: HTMLElement;
    stage: () => Stage;
    personalityId: () => string;
    rng: () => Rng;
    names: () => { you: string; them: string };
    tempo?: number;
    onOver?: (winner: Side, state: QuickdrawState) => void;
};

export type QuickdrawMode = {
    start(): void;
    stop(): void;
    reset(): void;
    state(): QuickdrawState;
    running(): boolean;
};

const ESSENCE_LABEL: Record<Essence, string> = { fire: "FIRE", water: "WATER", shadow: "SHADOW", life: "LIFE" };
const SWIPE: Record<"up" | "right" | "down" | "left", Essence> = { up: "fire", right: "water", down: "shadow", left: "life" };
const other = (side: Side): Side => (side === "player" ? "opponent" : "player");

type Schedule = { plan: BotPlan; chooseAt?: number; holdAt?: number; releaseAt?: number; wardAt?: number; done: Set<string> };

export function createQuickdrawMode(deps: QuickdrawDeps): QuickdrawMode {
    const { root } = deps;
    const q = <T extends HTMLElement>(selector: string): T => {
        const el = root.querySelector<T>(selector);
        if (!el) throw new Error(`quickdraw: missing ${selector}`);
        return el;
    };
    const caption = q<HTMLElement>("#quickdraw-caption");
    const roundLabel = q<HTMLElement>("#quickdraw-round");
    const ringFill = q<HTMLElement>("#quickdraw-ring-fill");
    const hearts: Record<Side, HTMLElement> = { player: q("#quickdraw-hearts-player"), opponent: q("#quickdraw-hearts-opponent") };
    const focus: Record<Side, HTMLElement> = { player: q("#quickdraw-focus-player"), opponent: q("#quickdraw-focus-opponent") };
    const names: Record<Side, HTMLElement> = { player: q("#quickdraw-name-player"), opponent: q("#quickdraw-name-opponent") };
    const orbs: Record<Side, HTMLElement> = { player: q("#quickdraw-orb-player"), opponent: q("#quickdraw-orb-opponent") };
    const pads = Array.from(root.querySelectorAll<HTMLButtonElement>(".quickdraw-pad"));
    const chargeButton = q<HTMLButtonElement>("#quickdraw-charge");
    const wardButton = q<HTMLButtonElement>("#quickdraw-ward");
    const rematch = q<HTMLButtonElement>("#quickdraw-rematch");
    const verdict = q<HTMLElement>("#quickdraw-verdict");

    let state: QuickdrawState = createQuickdraw();
    let frame = 0;
    let running = false;
    let replaying = false;
    let schedule: Schedule | undefined;
    let lastSpeech = "";
    const tempo = Math.max(1, deps.tempo ?? 1);
    const now = (): number => performance.now() / tempo;

    function stageState(): StageState {
        const guard = (side: Side): StageState["wards"][Side] => (state.round.draws[side]?.ward ? { essence: state.colour[side], integrity: 2 } : undefined);
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

    /** The orb a side is showing: colour and size as the opponent sees it. */
    function telegraph(side: Side, t: number): { essence: Essence; magnitude: number; quick: boolean } | undefined {
        const draw = state.round.draws[side];
        if (!draw?.essence || draw.ward) return undefined;
        return { essence: draw.essence, magnitude: Math.min(3, chargeOf(state, side, t) + (draw.quick ? 1 : 0)), quick: draw.quick };
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
            const shown = telegraph(side, t);
            const draw = state.round.draws[side];
            orbs[side].style.setProperty("--orb", shown ? `var(--${shown.essence})` : "#3a2f55");
            orbs[side].style.setProperty("--mag", shown ? String(0.7 + shown.magnitude * 0.3) : "0.6");
            orbs[side].classList.toggle("quick", shown?.quick === true);
            orbs[side].classList.toggle("warded", draw?.ward === true);
            orbs[side].textContent = draw?.ward ? "W" : shown ? String(shown.magnitude) : "";
            root.dataset[side === "player" ? "essencePlayer" : "essenceOpponent"] = shown?.essence ?? (draw?.ward ? "ward" : "");
            root.dataset[side === "player" ? "chargePlayer" : "chargeOpponent"] = shown ? String(shown.magnitude) : "0";
        }
        root.dataset.phase = state.phase;
        root.dataset.round = String(state.round.number);
        const ring = ringProgress(state, t);
        root.dataset.ring = String(Math.round(ring * 100));
        ringFill.style.width = `${Math.round((1 - ring) * 100)}%`;
        root.dataset.quickWindow = state.phase === "draw" && t - state.round.startedAt < 1000 ? "open" : "closed";
        roundLabel.textContent = state.phase === "draw" ? `round ${state.round.number} · ${(Math.max(0, RING_MS - (t - state.round.startedAt)) / 1000).toFixed(1)} s` : state.phase === "over" ? "" : `round ${state.round.number}`;
        const drawing = state.phase === "draw" && !replaying;
        const mine = state.round.draws.player;
        for (const pad of pads) {
            const essence = pad.dataset.essence as Essence;
            pad.classList.toggle("selected", mine?.essence === essence);
            pad.disabled = !drawing;
        }
        chargeButton.disabled = !drawing || mine?.ward === true || state.focus.player < 1;
        chargeButton.classList.toggle("selected", mine?.holdFrom !== undefined);
        wardButton.disabled = !drawing || mine?.ward === true || state.focus.player < WARD_COST;
        wardButton.classList.toggle("selected", mine?.ward === true);
        rematch.classList.toggle("hidden", state.phase !== "over");
        verdict.classList.toggle("hidden", state.phase !== "over");
        if (state.phase === "over") {
            verdict.textContent = state.winner === "player" ? `${names.player.textContent} win the quickdraw ${state.hearts.player}–${state.hearts.opponent}.` : `${names.opponent.textContent} wins the quickdraw ${state.hearts.opponent}–${state.hearts.player}.`;
        }
        // The orbs in the mages' hands: the telegraph on the stage.
        const stage = deps.stage();
        for (const side of ["player", "opponent"] as const) {
            const shown = state.phase === "draw" ? telegraph(side, t) : undefined;
            stage.live?.orb(side, shown ? { essence: shown.essence, magnitude: shown.magnitude } : undefined);
        }
    }

    function describe(event: QuickdrawEvent): string | undefined {
        const who = event.side === "player" ? "You" : "They";
        switch (event.kind) {
            case "open": return "Draw";
            case "ward": return `${who} raise a ${ESSENCE_LABEL[event.essence!]} WARD`;
            case "hit": return `${event.side === "player" ? "HIT! You" : "HIT! They"} lose ${event.magnitude} heart${event.magnitude === 1 ? "" : "s"}`;
            case "block": return `${who} block · WARD holds`;
            case "shatter": return `${who} block · WARD shatters`;
            case "cancel": return "The orbs cancel";
            case "over": return event.side === "player" ? "You win the quickdraw" : "They win the quickdraw";
            default: return undefined;
        }
    }

    /** The clash as beats, so the renderers play their full effects. */
    function beatsOf(events: QuickdrawEvent[]): Beat[] {
        const beats: Beat[] = [];
        for (const e of events) {
            if (e.kind === "fly") beats.push({ kind: "fly", from: e.side, to: other(e.side), ...(e.essence ? { essence: e.essence } : {}), magnitude: e.magnitude ?? 1, action: "seek" });
        }
        for (const e of events) {
            if (e.kind === "hit") beats.push({ kind: "hit", side: e.side, magnitude: e.magnitude ?? 1, ...(e.hearts === 0 ? { emphasis: "decisive" as const } : {}) });
            if (e.kind === "block" || e.kind === "shatter") beats.push({ kind: "ward-block", side: e.side, broken: e.kind === "shatter", integrity: e.kind === "shatter" ? 0 : 2 - (e.magnitude ?? 1) });
            if (e.kind === "cancel") beats.push({ kind: "fizzle", side: "player", reason: "the orbs cancel" });
        }
        return beats;
    }

    async function play(events: QuickdrawEvent[]): Promise<void> {
        const stage = deps.stage();
        const clash = events.filter(e => e.kind === "fly" || e.kind === "hit" || e.kind === "block" || e.kind === "shatter" || e.kind === "cancel");
        for (const event of events) {
            if (event.kind === "ward") stage.setIdle(stageState());
            if (event.kind === "open") say("Draw");
        }
        if (clash.length > 0) {
            replaying = true;
            for (const side of ["player", "opponent"] as const) stage.live?.orb(side, undefined);
            await stage.play(beatsOf(clash), stageState());
            replaying = false;
            const last = [...clash].reverse().find(e => e.kind !== "fly");
            if (last) say(describe(last) ?? "");
        }
        const over = events.find(e => e.kind === "over");
        if (over) {
            say(describe(over) ?? "");
            deps.onOver?.(over.side, state);
        }
        stage.setIdle(stageState());
    }

    function planBot(): void {
        const plan = botDraw(state, deps.personalityId(), deps.rng());
        const start = state.round.startedAt;
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
        if (!schedule || state.phase !== "draw") return;
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
            void play(r.events);
        });
        apply("choose", s.chooseAt, () => {
            if (s.plan.essence) state = choose(state, "opponent", s.plan.essence, t).state;
        });
        apply("hold", s.holdAt, () => (state = hold(state, "opponent", t).state));
        apply("release", s.releaseAt, () => (state = release(state, "opponent", t).state));
    }

    function step(): void {
        if (!running) return;
        frame = requestAnimationFrame(step);
        const t = now();
        if (!replaying) {
            const before = state;
            const { state: next, events } = tick(state, t);
            state = next;
            if (events.some(e => e.kind === "open")) planBot();
            if (events.length > 0) void play(events);
            if (before !== state && state.phase === "draw") runBot(t);
            else if (state.phase === "draw") runBot(t);
        }
        render();
    }

    function playerChoose(essence: Essence): void {
        if (!running || replaying) return;
        state = choose(state, "player", essence, now()).state;
        render();
    }
    function playerHold(): void {
        if (!running || replaying) return;
        state = hold(state, "player", now()).state;
        render();
    }
    function playerRelease(): void {
        if (!running) return;
        state = release(state, "player", now()).state;
        render();
    }
    function playerWard(): void {
        if (!running || replaying) return;
        const r = ward(state, "player", now());
        state = r.state;
        void play(r.events);
        render();
    }

    for (const pad of pads) pad.addEventListener("click", () => playerChoose(pad.dataset.essence as Essence));
    chargeButton.addEventListener("pointerdown", e => {
        e.preventDefault();
        playerHold();
    });
    for (const type of ["pointerup", "pointercancel", "pointerleave"] as const) chargeButton.addEventListener(type, playerRelease);
    wardButton.addEventListener("click", playerWard);
    rematch.addEventListener("click", () => reset());

    // Gestures on the stage: swipe picks a colour; press and hold charges.
    let pointer: { x: number; y: number; timer: number; holding: boolean } | undefined;
    function onDown(e: PointerEvent): void {
        if (!running) return;
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
        frame = requestAnimationFrame(step);
        render();
    }
    function stop(): void {
        running = false;
        replaying = false;
        cancelAnimationFrame(frame);
        for (const side of ["player", "opponent"] as const) deps.stage().live?.orb(side, undefined);
        root.classList.add("hidden");
    }
    function reset(): void {
        state = createQuickdraw({ player: state.colour.player });
        schedule = undefined;
        replaying = false;
        lastSpeech = "";
        say("");
        deps.stage().setIdle(stageState());
        render();
    }

    return { start, stop, reset, state: () => state, running: () => running };
}
