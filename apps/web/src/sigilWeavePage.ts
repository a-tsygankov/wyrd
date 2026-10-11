import {
    WEAVE_RECIPES,
    canReleaseWeave,
    nextWeaveStep,
    placeWeaveRune,
    recipeFor,
    releaseWeave,
    resolveWeaveParry,
    startWeave,
    type WeaveMode,
    type WeaveState
} from "./sigilWeave.js";
import { createSigilWeaveArena, type SigilWeaveArena } from "./sigilWeaveArena.js";
import {
    evaluateParry,
    projectilePosition,
    type IncomingPath,
    type ParryScore
} from "./strokeDuel.js";
import {
    pickOpponentSpell,
    seededRandom,
    type OpponentSpellProfile
} from "./strokeDuelScenario.js";
import type { Point, Rune } from "./runeDuel.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const root = $("sigil-weave");
const arenaRoot = $("sigil-arena");
const recipeTitle = $("recipe-title");
const recipeSubtitle = $("recipe-subtitle");
const recipeEffect = $("recipe-effect");
const stepsRoot = $("weave-steps");
const instruction = $("instruction");
const statusText = $("weave-status");
const result = $("weave-result");
const stabilityText = $("stability-text");
const stabilityFill = $("stability-fill");
const chargeText = $("charge-text");
const releaseButton = $<HTMLButtonElement>("release-weave");
const resetButton = $<HTMLButtonElement>("reset-weave");
const parryToggle = $<HTMLInputElement>("parry-toggle");
const hintsToggle = $<HTMLInputElement>("hints-toggle");
const parryPanel = $("parry-panel");
const parryCanvas = $<HTMLCanvasElement>("parry-canvas");
const parryCtx = parryCanvas.getContext("2d")!;
const parrySpellLabel = $("parry-spell");
const parryHint = $("parry-hint");
const helpToggle = $<HTMLButtonElement>("help-toggle");
const helpCard = $("help-card");
const logRoot = $<HTMLOListElement>("weave-log");

const runeNames: Record<Rune, string> = {
    line: "PIERCE",
    arc: "REDIRECT",
    circle: "WARD",
    triangle: "POWER",
    spiral: "ABSORB"
};

const runeGlyphs: Record<Rune, string> = {
    line: "—",
    arc: "⌒",
    circle: "○",
    triangle: "△",
    spiral: "⌣"
};

const seedParam = new URLSearchParams(location.search).get("seed");
const random = seedParam === null ? Math.random : seededRandom(Number(seedParam) || 1);
const parryParam = new URLSearchParams(location.search).get("parry");
parryToggle.checked = parryParam !== "off";

let mode: WeaveMode = "aegis";
let state: WeaveState = startWeave(mode, parryToggle.checked);
let selectedRune: Rune = "circle";
let phase: "weave" | "parry" | "released" = "weave";
let arena: SigilWeaveArena | undefined;
let currentSpell: OpponentSpellProfile | undefined;
let previousSpellId: OpponentSpellProfile["id"] | undefined;
let incoming: IncomingPath | undefined;
let parryPoints: Point[] = [];
let parryDrawing = false;
let parryResolved = false;
let frameId = 0;

try {
    arena = createSigilWeaveArena(arenaRoot);
} catch {
    arenaRoot.querySelector(".arena-fallback")?.replaceChildren("3D field unavailable on this device.");
}

function log(text: string): void {
    const li = document.createElement("li");
    li.textContent = text;
    logRoot.append(li);
    logRoot.scrollTop = logRoot.scrollHeight;
}

function setResult(text: string, tone: "good" | "bad" | "neutral" = "neutral"): void {
    result.textContent = text;
    result.classList.toggle("good", tone === "good");
    result.classList.toggle("bad", tone === "bad");
}

function setPhase(next: typeof phase): void {
    phase = next;
    root.dataset.phase = next;
    parryToggle.disabled = next === "parry";
}

function defaultRuneForMode(nextMode: WeaveMode): Rune {
    return recipeFor(nextMode)?.steps[0]?.rune ?? "circle";
}

function renderRecipeButtons(): void {
    document.querySelectorAll<HTMLButtonElement>("[data-recipe]").forEach(button => {
        button.classList.toggle("active", button.dataset.recipe === mode);
    });
}

function renderRuneButtons(): void {
    document.querySelectorAll<HTMLButtonElement>("[data-rune]").forEach(button => {
        button.classList.toggle("active", button.dataset.rune === selectedRune);
        button.disabled = phase !== "weave" || state.released;
    });
}

function renderAnchors(): void {
    const next = nextWeaveStep(state);
    document.querySelectorAll<HTMLButtonElement>("[data-anchor]").forEach(button => {
        const anchor = Number(button.dataset.anchor);
        const placement = state.placements.find(item => item.anchor === anchor);
        button.classList.toggle("occupied", !!placement);
        button.classList.toggle("next", hintsToggle.checked && next?.anchor === anchor);
        button.disabled = phase !== "weave" || state.released;
        const label = button.querySelector("span");
        if (label) {
            label.textContent = placement ? runeGlyphs[placement.rune] : String(anchor + 1);
            label.setAttribute("aria-label", placement ? runeNames[placement.rune] : "Anchor " + (anchor + 1));
        }
    });
}

function renderSteps(): void {
    stepsRoot.replaceChildren();
    const recipe = recipeFor(mode);
    if (!recipe) {
        const items = [
            "Place at least 3 runes on different anchors.",
            "Mix rune families for a more stable structure.",
            "With Arcade Parry on, interruptions arrive after layers 2 and 4.",
            "Release any time after 3 placements; five anchors forms the fullest free weave."
        ];
        items.forEach((text, index) => {
            const li = document.createElement("li");
            li.className = index < Math.min(state.placements.length, 3) ? "done" : index === Math.min(state.placements.length, 3) ? "current" : "";
            li.textContent = text;
            stepsRoot.append(li);
        });
        return;
    }

    recipe.steps.forEach((step, index) => {
        const li = document.createElement("li");
        if (index < state.placements.length) li.className = "done";
        else if (index === state.placements.length) li.className = "current";
        const strong = document.createElement("strong");
        strong.textContent = (index + 1) + " · " + step.label + " → anchor " + (step.anchor + 1);
        const span = document.createElement("span");
        span.textContent = step.reason;
        li.append(strong, span);
        stepsRoot.append(li);
    });
}

function renderInstruction(): void {
    if (phase === "parry") {
        instruction.textContent = "Interrupt: parry the incoming spell before you continue weaving.";
        return;
    }
    if (state.released) {
        instruction.textContent = "Sigil released. Reset or choose another gameplay.";
        return;
    }
    const step = nextWeaveStep(state);
    if (step) {
        instruction.textContent = hintsToggle.checked
            ? "Next: select " + step.label + " " + runeGlyphs[step.rune] + " and tap anchor " + (step.anchor + 1) + ". " + step.reason
            : "Choose the next rune and anchor from the recipe.";
        return;
    }
    if (mode === "free") {
        instruction.textContent = canReleaseWeave(state)
            ? "The free weave can be released now, or you can add more layers."
            : "Choose any rune, then tap an empty anchor. Build at least three layers.";
        return;
    }
    instruction.textContent = "The recipe is complete. Release the sigil.";
}

function renderHeader(): void {
    const recipe = recipeFor(mode);
    if (recipe) {
        recipeTitle.textContent = recipe.name;
        recipeSubtitle.textContent = recipe.difficulty + " · " + recipe.subtitle;
        recipeEffect.textContent = recipe.effect;
    } else {
        recipeTitle.textContent = "FREE WEAVE";
        recipeSubtitle.textContent = "SANDBOX · improvise a sigil without a prescribed sequence.";
        recipeEffect.textContent = "Experiment with rune families and geometry; release after at least three anchored layers.";
    }
}

function renderState(): void {
    renderRecipeButtons();
    renderRuneButtons();
    renderAnchors();
    renderSteps();
    renderInstruction();
    renderHeader();

    stabilityText.textContent = state.stability + "%";
    stabilityFill.style.width = state.stability + "%";
    chargeText.textContent = state.charge + "/10";
    statusText.textContent =
        phase === "parry" ? "INTERRUPTED" :
        state.released ? "RELEASED" :
        canReleaseWeave(state) ? "READY" :
        state.placements.length + " LAYERS";
    releaseButton.disabled = !canReleaseWeave(state) || phase !== "weave";
    releaseButton.classList.toggle("ready", !releaseButton.disabled);
    parryPanel.classList.toggle("hidden", phase !== "parry");

    const step = nextWeaveStep(state);
    arena?.setPlacements(state.placements, state.complete || (mode === "free" && state.placements.length >= 3));
    arena?.highlightAnchor(hintsToggle.checked ? step?.anchor : undefined);

    root.dataset.mode = mode;
    root.dataset.layers = String(state.placements.length);
    root.dataset.parry = String(state.parryEnabled);
}

function startMode(nextMode: WeaveMode): void {
    mode = nextMode;
    state = startWeave(mode, parryToggle.checked);
    selectedRune = defaultRuneForMode(mode);
    currentSpell = undefined;
    incoming = undefined;
    parryPoints = [];
    parryResolved = false;
    setPhase("weave");
    arena?.reset();
    logRoot.replaceChildren();
    const recipe = recipeFor(mode);
    log("Started " + (recipe?.name ?? "Free Weave") + ".");
    setResult("Select the highlighted rune and place it on the field.", "neutral");
    renderState();
}

function parrySize(): { width: number; height: number } {
    const rect = parryCanvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
}

function resizeParry(): void {
    const rect = parryCanvas.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    parryCanvas.width = Math.max(1, Math.round(rect.width * dpr));
    parryCanvas.height = Math.max(1, Math.round(rect.height * dpr));
    parryCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawParry(performance.now());
}
new ResizeObserver(resizeParry).observe(parryCanvas);

function parryPoint(event: PointerEvent): Point {
    const rect = parryCanvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, t: performance.now() };
}

function drawParryStroke(): void {
    if (parryPoints.length < 2) return;
    parryCtx.save();
    parryCtx.strokeStyle = "#78e8ff";
    parryCtx.lineWidth = 5;
    parryCtx.lineCap = "round";
    parryCtx.lineJoin = "round";
    parryCtx.shadowColor = "#62ddff";
    parryCtx.shadowBlur = 14;
    parryCtx.beginPath();
    parryCtx.moveTo(parryPoints[0]!.x, parryPoints[0]!.y);
    for (const point of parryPoints.slice(1)) parryCtx.lineTo(point.x, point.y);
    parryCtx.stroke();
    parryCtx.restore();
}

function drawParry(now: number): void {
    const { width, height } = parrySize();
    parryCtx.clearRect(0, 0, width, height);
    if (phase !== "parry" || !incoming || !currentSpell) return;
    const y = height * (incoming.laneY ?? 0.5);
    parryCtx.save();
    parryCtx.setLineDash([7, 9]);
    parryCtx.strokeStyle = "#ffb06b66";
    parryCtx.lineWidth = 3;
    parryCtx.beginPath();
    parryCtx.moveTo(width * 0.08, y);
    parryCtx.lineTo(width * 0.92, y);
    parryCtx.stroke();
    parryCtx.restore();

    const orb = projectilePosition(incoming, now);
    const color = "#" + currentSpell.color.toString(16).padStart(6, "0");
    const gradient = parryCtx.createRadialGradient(orb.x, orb.y, 1, orb.x, orb.y, 22);
    gradient.addColorStop(0, "#fff");
    gradient.addColorStop(0.25, color);
    gradient.addColorStop(1, color + "22");
    parryCtx.fillStyle = gradient;
    parryCtx.beginPath();
    parryCtx.arc(orb.x, orb.y, currentSpell.id === "void-orb" ? 24 : 18, 0, Math.PI * 2);
    parryCtx.fill();
    drawParryStroke();
}

function beginParry(): void {
    if (!state.parryPending || phase !== "weave") return;
    currentSpell = pickOpponentSpell(random, previousSpellId);
    previousSpellId = currentSpell.id;
    parryPoints = [];
    parryResolved = false;
    setPhase("parry");
    parryPanel.classList.remove("hidden");
    resizeParry();
    const { width, height } = parrySize();
    const launchedAt = performance.now() + currentSpell.launchDelayMs;
    incoming = {
        width,
        height,
        launchedAt,
        impactAt: launchedAt + currentSpell.travelMs,
        laneY: currentSpell.laneY,
        damage: currentSpell.damage
    };
    parrySpellLabel.textContent = currentSpell.name + " · " + currentSpell.damage + " DMG";
    parryHint.textContent = currentSpell.tip + " A successful parry protects the weave; DEFLECT/REFLECT can add charge.";
    arena?.presentInterrupt(currentSpell);
    log("Arcade Parry interruption: " + currentSpell.name + ".");
    setResult("The weave is exposed. Parry the moving spell before adding the next layer.", "neutral");
    renderState();
}

function parryEffect(score: ParryScore): string {
    if (score.outcome === "reflect") return "REFLECT · stability and +2 charge";
    if (score.outcome === "deflect") return "DEFLECT · stability and +1 charge";
    if (score.outcome === "block") return "BLOCK · weave protected";
    return "MISS · weave frayed";
}

function finishParry(score: ParryScore): void {
    if (parryResolved) return;
    parryResolved = true;
    state = resolveWeaveParry(state, score.outcome, score.quality);
    arena?.presentParry(score.outcome);
    log("Parry: " + parryEffect(score) + ".");
    setResult(parryEffect(score) + ". Stability " + state.stability + "%.", score.outcome === "miss" ? "bad" : "good");
    window.setTimeout(() => {
        incoming = undefined;
        currentSpell = undefined;
        parryPoints = [];
        setPhase("weave");
        renderState();
    }, 650);
    renderState();
}

function missedParry(): void {
    if (phase !== "parry" || parryResolved) return;
    finishParry({
        outcome: "miss",
        timing: 0,
        crossingAngleDeg: 0,
        curvature: 0,
        quality: 0,
        incomingDamage: currentSpell?.damage ?? 14,
        counterDamage: 0,
        detail: "The interrupt reached the weave."
    });
}

parryCanvas.addEventListener("pointerdown", event => {
    if (phase !== "parry") return;
    parryDrawing = true;
    parryPoints = [parryPoint(event)];
    parryCanvas.setPointerCapture(event.pointerId);
    drawParry(performance.now());
});

parryCanvas.addEventListener("pointermove", event => {
    if (!parryDrawing) return;
    const point = parryPoint(event);
    const previous = parryPoints.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 2) parryPoints.push(point);
    drawParry(performance.now());
});

function endParryStroke(): void {
    if (!parryDrawing) return;
    parryDrawing = false;
    if (phase === "parry" && incoming && !parryResolved) finishParry(evaluateParry(parryPoints, incoming));
}
parryCanvas.addEventListener("pointerup", endParryStroke);
parryCanvas.addEventListener("pointercancel", endParryStroke);

document.querySelectorAll<HTMLButtonElement>("[data-recipe]").forEach(button => {
    button.addEventListener("click", () => startMode(button.dataset.recipe as WeaveMode));
});

document.querySelectorAll<HTMLButtonElement>("[data-rune]").forEach(button => {
    button.addEventListener("click", () => {
        if (phase !== "weave") return;
        selectedRune = button.dataset.rune as Rune;
        renderRuneButtons();
    });
});

document.querySelectorAll<HTMLButtonElement>("[data-anchor]").forEach(button => {
    button.addEventListener("click", () => {
        if (phase !== "weave") return;
        const anchor = Number(button.dataset.anchor);
        const placed = placeWeaveRune(state, selectedRune, anchor);
        state = placed.state;
        const good = placed.verdict === "correct" || placed.verdict === "free";
        setResult(placed.message + " Stability " + state.stability + "%.", good ? "good" : "bad");
        log(runeNames[selectedRune] + " → anchor " + (anchor + 1) + ": " + placed.verdict + ".");
        const next = nextWeaveStep(state);
        if (next) selectedRune = next.rune;
        renderState();
        if (state.parryPending) window.setTimeout(beginParry, 350);
    });
});

releaseButton.addEventListener("click", () => {
    if (phase !== "weave") return;
    const release = releaseWeave(state);
    state = release.state;
    if (!state.released) {
        setResult(release.detail, "bad");
        return;
    }
    setPhase("released");
    arena?.presentRelease(release.score);
    setResult(release.title + " released at " + release.score + "% coherence. " + release.detail, "good");
    log("Released " + release.title + " · " + release.score + "% coherence.");
    renderState();
});

resetButton.addEventListener("click", () => startMode(mode));

parryToggle.addEventListener("change", () => {
    state = { ...state, parryEnabled: parryToggle.checked };
    root.dataset.parry = String(state.parryEnabled);
    setResult(parryToggle.checked ? "Arcade Parry interruptions enabled." : "Arcade Parry disabled; weave without interruptions.", "neutral");
    renderState();
});

hintsToggle.addEventListener("change", renderState);

helpToggle.addEventListener("click", () => {
    const hidden = helpCard.classList.toggle("hidden");
    helpToggle.textContent = hidden ? "Instructions" : "Hide instructions";
    helpToggle.setAttribute("aria-expanded", String(!hidden));
});

function frame(now: number): void {
    if (phase === "parry") {
        drawParry(now);
        if (incoming && now >= incoming.impactAt) missedParry();
    }
    frameId = requestAnimationFrame(frame);
}
frameId = requestAnimationFrame(frame);

window.addEventListener("pagehide", () => {
    cancelAnimationFrame(frameId);
    arena?.dispose();
});

startMode("aegis");
