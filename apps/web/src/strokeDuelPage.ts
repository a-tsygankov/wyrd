import {
    canonicalTracePoints,
    evaluateParry,
    projectilePosition,
    scoreTrace,
    type IncomingPath,
    type ParryScore,
    type TraceRune,
    type TraceScore
} from "./strokeDuel.js";
import { createStrokeDuelArena, type StrokeDuelArena } from "./strokeDuelArena.js";
import {
    pickOpponentSpell,
    pickTraceRune,
    playerSuggestion,
    seededRandom,
    type OpponentSpellProfile
} from "./strokeDuelScenario.js";
import type { Point } from "./runeDuel.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const root = $("stroke-duel");
const canvas = $<HTMLCanvasElement>("stroke-canvas");
const surface = $("stroke-surface");
const ctx = canvas.getContext("2d")!;
const prompt = $("prompt");
const hint = $("hint");
const phaseLabel = $("phase-label");
const phasePill = $("phase-pill");
const result = $("stroke-result");
const next = $<HTMLButtonElement>("next");
const reset = $<HTMLButtonElement>("reset");
const logRoot = $<HTMLOListElement>("combat-log");
const recognized = $("recognized");
const effect = $("effect");
const qualityFill = $("quality-fill");
const surfaceLabel = $("surface-label");
const helpToggle = $<HTMLButtonElement>("help-toggle");
const helpCard = $("help-card");
const dynamicMode = $<HTMLInputElement>("dynamic-mode");
const suggestionsMode = $<HTMLInputElement>("suggestions-mode");
const suggestion = $("suggestion");
const opponentSpellLabel = $("opponent-spell");
const opponentBehavior = $("opponent-behavior");
const opponentDanger = $("opponent-danger");
const arenaRoot = $("stroke-arena");

const runeNames: Record<TraceRune, string> = {
    line: "PIERCE",
    arc: "REDIRECT",
    triangle: "POWER"
};

type Phase = "trace" | "parry" | "round-over" | "finished";
let phase: Phase = "trace";
let round = 1;
let hpYou = 100;
let hpEnemy = 100;
let target: TraceRune = "line";
let previousTarget: TraceRune | undefined;
let opponentSpell: OpponentSpellProfile;
let previousOpponentId: OpponentSpellProfile["id"] | undefined;
let points: Point[] = [];
let drawing = false;
let incoming: IncomingPath | undefined;
let parryResolved = false;
let frameId = 0;
let autoTimer = 0;

const seedParam = new URLSearchParams(location.search).get("seed");
const random = seedParam === null ? Math.random : seededRandom(Number(seedParam) || 1);

let arena: StrokeDuelArena | undefined;
try {
    arena = createStrokeDuelArena(arenaRoot);
} catch {
    arenaRoot.querySelector(".arena-fallback")?.replaceChildren("3D arena unavailable on this device.");
}

function size(): { width: number; height: number } {
    const rect = canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
}

function resize(): void {
    const rect = canvas.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw(performance.now());
}
new ResizeObserver(resize).observe(canvas);

function pointOf(event: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, t: performance.now() };
}

function drawPolyline(path: readonly { x: number; y: number }[], colour: string, width: number, alpha = 1): void {
    if (path.length < 2) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(path[0]!.x, path[0]!.y);
    for (const point of path.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.restore();
}

function drawUserStroke(): void {
    if (points.length < 2) return;
    ctx.save();
    ctx.shadowColor = phase === "trace" ? "#8e65ff" : "#62ddff";
    ctx.shadowBlur = 16;
    drawPolyline(points, phase === "trace" ? "#b594ff" : "#78e8ff", 5);
    ctx.restore();
}

function drawTraceGuide(): void {
    const { width, height } = size();
    const guide = canonicalTracePoints(target, width, height);
    ctx.save();
    ctx.setLineDash([7, 7]);
    drawPolyline(guide, "#ffc86b", 4, 0.42);
    ctx.restore();
    const start = guide[0];
    const end = guide.at(-1);
    if (start && end) {
        ctx.fillStyle = "#72e5ac";
        ctx.beginPath();
        ctx.arc(start.x, start.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffc86b";
        ctx.beginPath();
        ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawParryLane(now: number): void {
    const { width, height } = size();
    const y = height * (incoming?.laneY ?? 0.5);
    ctx.save();
    ctx.setLineDash([7, 9]);
    ctx.strokeStyle = "#ff9d6b66";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(width * 0.08, y);
    ctx.lineTo(width * 0.92, y);
    ctx.stroke();
    ctx.restore();

    if (!incoming) return;
    const orb = projectilePosition(incoming, now);
    const color = "#" + opponentSpell.color.toString(16).padStart(6, "0");
    ctx.save();
    const gradient = ctx.createRadialGradient(orb.x, orb.y, 1, orb.x, orb.y, 20);
    gradient.addColorStop(0, "#fff");
    gradient.addColorStop(0.25, color);
    gradient.addColorStop(1, color + "22");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, opponentSpell.id === "void-orb" ? 24 : 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function redraw(now: number): void {
    const { width, height } = size();
    ctx.clearRect(0, 0, width, height);
    if (phase === "trace") drawTraceGuide();
    if (phase === "parry") drawParryLane(now);
    drawUserStroke();
}

function percent(value: number): string { return Math.round(value * 100) + "%"; }

function qualityTier(value: number): string {
    if (value >= 0.9) return "MASTERFUL";
    if (value >= 0.75) return "STRONG";
    if (value >= 0.55) return "STABLE";
    if (value >= 0.35) return "WEAK";
    return "FAILED";
}

function setMetrics(a: string, b: string, c: string, d: string, labels = ["Accuracy", "Form", "Direction", "Speed"]): void {
    $("metric-a").textContent = a;
    $("metric-b").textContent = b;
    $("metric-c").textContent = c;
    $("metric-d").textContent = d;
    $("metric-a-label").textContent = labels[0]!;
    $("metric-b-label").textContent = labels[1]!;
    $("metric-c-label").textContent = labels[2]!;
    $("metric-d-label").textContent = labels[3]!;
}

function setReadout(read: string, gameEffect: string, quality: number): void {
    recognized.textContent = read;
    effect.textContent = gameEffect;
    qualityFill.style.width = Math.round(Math.max(0, Math.min(1, quality)) * 100) + "%";
}

function setResult(text: string, good: boolean | undefined): void {
    result.textContent = text;
    result.classList.toggle("good", good === true);
    result.classList.toggle("bad", good === false);
}

function log(text: string): void {
    const li = document.createElement("li");
    li.textContent = text;
    logRoot.append(li);
    logRoot.scrollTop = logRoot.scrollHeight;
}

function updateHp(): void {
    $("hp-you-label").textContent = String(hpYou);
    $("hp-enemy-label").textContent = String(hpEnemy);
    $("hp-you").style.width = hpYou + "%";
    $("hp-enemy").style.width = hpEnemy + "%";
    $("round").textContent = String(round);
}

function updateOpponentRead(): void {
    opponentSpellLabel.textContent = opponentSpell.name;
    opponentBehavior.textContent =
        opponentSpell.behavior.toUpperCase() + " · " +
        (opponentSpell.travelMs / 1000).toFixed(1) + "s travel · lane " +
        Math.round(opponentSpell.laneY * 100) + "%";
    opponentDanger.textContent = opponentSpell.damage + " DMG";
    suggestion.classList.toggle("hidden", !suggestionsMode.checked);
    suggestion.innerHTML = "<b>Suggestion:</b> " + playerSuggestion(target, opponentSpell);
}

function highlightTarget(): void {
    document.querySelectorAll<HTMLElement>(".spell-card").forEach(card => {
        card.classList.toggle("active", card.dataset.rune === target);
    });
}

function clearAutoTimer(): void {
    if (autoTimer) {
        window.clearTimeout(autoTimer);
        autoTimer = 0;
    }
}

function finish(): void {
    clearAutoTimer();
    phase = "finished";
    root.dataset.phase = phase;
    arena?.setPhase(phase);
    phasePill.textContent = hpEnemy <= 0 ? "VICTORY" : "DEFEAT";
    prompt.textContent = hpEnemy <= 0 ? "You broke their guard." : "Your ward collapsed.";
    hint.textContent = "Start a new duel to keep testing the dynamic exchange.";
    surfaceLabel.textContent = "Duel complete";
    next.classList.add("hidden");
    setResult(hpEnemy <= 0 ? "Victory. Your traced spells won the duel." : "Defeat. The incoming magic got through.", hpEnemy <= 0);
    log(hpEnemy <= 0 ? "Victory." : "Defeat.");
}

function advanceExchange(): void {
    if (phase !== "round-over") return;
    clearAutoTimer();
    round++;
    beginTrace();
}

function endExchange(): void {
    if (hpYou <= 0 || hpEnemy <= 0) {
        finish();
        return;
    }
    phase = "round-over";
    root.dataset.phase = phase;
    arena?.setPhase(phase);
    phasePill.textContent = "RESOLVED";
    prompt.textContent = "Exchange complete";
    surfaceLabel.textContent = "Exchange resolved";
    if (dynamicMode.checked) {
        hint.textContent = "Dynamic duel: next exchange begins automatically.";
        next.classList.add("hidden");
        autoTimer = window.setTimeout(advanceExchange, 1250);
    } else {
        hint.textContent = "Manual mode: review the exchange, then continue.";
        next.classList.remove("hidden");
    }
}

function chooseScenario(): void {
    target = pickTraceRune(random, previousTarget);
    previousTarget = target;
    opponentSpell = pickOpponentSpell(random, previousOpponentId);
    previousOpponentId = opponentSpell.id;
}

function beginTrace(): void {
    clearAutoTimer();
    chooseScenario();
    phase = "trace";
    root.dataset.phase = phase;
    arena?.setPhase(phase);
    parryResolved = false;
    incoming = undefined;
    points = [];
    canvas.dataset.target = target;
    root.dataset.opponentSpell = opponentSpell.id;
    highlightTarget();
    updateOpponentRead();
    phaseLabel.textContent = "Offense · Rune Trace";
    phasePill.textContent = "TRACE";
    prompt.textContent = "Trace " + runeNames[target];
    hint.textContent = "Start at green, follow the randomized ghost rune, finish at gold. The opponent is already preparing " + opponentSpell.name + ".";
    surfaceLabel.textContent = "Draw " + runeNames[target] + " · green → gold";
    setMetrics("—", "—", "—", "—");
    setReadout("Waiting for " + runeNames[target], "Successful trace deals 6–24 damage based on quality", 0);
    setResult("Draw the highlighted rune. After your cast, the opponent attacks automatically.", undefined);
    next.classList.add("hidden");
    redraw(performance.now());
}

function beginParry(): void {
    if (phase === "finished") return;
    phase = "parry";
    root.dataset.phase = phase;
    arena?.setPhase(phase);
    points = [];
    const { width, height } = size();
    const launchedAt = performance.now() + opponentSpell.launchDelayMs;
    incoming = {
        width,
        height,
        launchedAt,
        impactAt: launchedAt + opponentSpell.travelMs,
        laneY: opponentSpell.laneY,
        damage: opponentSpell.damage
    };
    arena?.presentOpponentCast(opponentSpell);
    phaseLabel.textContent = "Defense · Arcane Parry";
    phasePill.textContent = "PARRY";
    prompt.textContent = opponentSpell.name + " incoming";
    hint.textContent = opponentSpell.tip + " You still have to intersect the actual moving spell.";
    surfaceLabel.textContent = "Parry " + opponentSpell.name + " · lane " + Math.round(opponentSpell.laneY * 100) + "%";
    setMetrics("—", "—", "—", "—", ["Timing", "Angle", "Curve", "Quality"]);
    result.textContent += " " + opponentSpell.name + " is incoming for up to " + opponentSpell.damage + " damage.";
    redraw(performance.now());
}

function applyTrace(score: TraceScore): void {
    setMetrics(percent(score.accuracy), percent(score.form), percent(score.direction), percent(score.speed));
    const targetName = runeNames[score.target];
    const recognizedName = score.recognized === "unknown"
        ? "UNKNOWN"
        : runeNames[score.recognized as TraceRune] ?? String(score.recognized).toUpperCase();

    if (score.correct) {
        hpEnemy = Math.max(0, hpEnemy - score.attackDamage);
        updateHp();
        const tier = qualityTier(score.total);
        arena?.presentPlayerCast(score.target, score.total);
        setReadout(targetName + " recognized · " + percent(score.total), tier + " cast · " + score.attackDamage + " damage", score.total);
        setResult(targetName + " landed. " + percent(score.total) + " (" + tier + ") produced " + score.attackDamage + " damage.", true);
        log("Rune Trace: " + targetName + " · " + percent(score.total) + " · " + score.attackDamage + " damage.");
    } else {
        setReadout(recognizedName + " recognized instead of " + targetName, "MISCAST · 0 damage", score.total);
        setResult("Miscast: requested " + targetName + ", recognized " + recognizedName + ". No attack damage.", false);
        log("Rune Trace miscast: target " + targetName + ", recognized " + recognizedName + ".");
    }

    if (hpEnemy <= 0) finish();
    else window.setTimeout(beginParry, 760);
}

function parryEffect(score: ParryScore): string {
    if (score.outcome === "block") return opponentSpell.damage + " damage prevented";
    if (score.outcome === "deflect") return opponentSpell.damage + " prevented + " + score.counterDamage + " counter";
    if (score.outcome === "reflect") return opponentSpell.damage + " prevented + " + score.counterDamage + " reflected";
    return score.incomingDamage + " damage taken";
}

function applyParry(score: ParryScore): void {
    setMetrics(
        percent(score.timing),
        Math.round(score.crossingAngleDeg) + "°",
        percent(score.curvature),
        percent(score.quality),
        ["Timing", "Angle", "Curve", "Quality"]
    );
    if (score.incomingDamage > 0) hpYou = Math.max(0, hpYou - score.incomingDamage);
    if (score.counterDamage > 0) hpEnemy = Math.max(0, hpEnemy - score.counterDamage);
    updateHp();
    arena?.presentParry(score.outcome);

    const label = score.outcome.toUpperCase();
    const tier = score.outcome === "miss" ? "FAILED" : qualityTier(score.quality);
    setReadout(label + " recognized · " + percent(score.quality), tier + " parry · " + parryEffect(score), score.quality);
    setResult(
        label + " vs " + opponentSpell.name + " · " + parryEffect(score) + ". " + score.detail +
        " Timing " + percent(score.timing) + ", angle " + Math.round(score.crossingAngleDeg) + "°, curve " + percent(score.curvature) + ".",
        score.outcome !== "miss"
    );
    log("Arcane Parry: " + label + " vs " + opponentSpell.name + " · effect: " + parryEffect(score) + ".");
    endExchange();
}

function missedImpact(): void {
    if (phase !== "parry" || parryResolved) return;
    parryResolved = true;
    hpYou = Math.max(0, hpYou - opponentSpell.damage);
    updateHp();
    arena?.presentParry("miss");
    setMetrics("0%", "—", "—", "0%", ["Timing", "Angle", "Curve", "Quality"]);
    setReadout("NO PARRY", "FAILED · " + opponentSpell.damage + " damage taken", 0);
    setResult("TOO SLOW · " + opponentSpell.name + " landed for " + opponentSpell.damage + " damage.", false);
    log("Arcane Parry: TOO SLOW vs " + opponentSpell.name + " · " + opponentSpell.damage + " damage taken.");
    endExchange();
}

surface.addEventListener("pointerdown", event => {
    if (phase !== "trace" && phase !== "parry") return;
    drawing = true;
    points = [pointOf(event)];
    recognized.textContent = "Drawing… release to resolve";
    canvas.setPointerCapture(event.pointerId);
    redraw(performance.now());
});

surface.addEventListener("pointermove", event => {
    if (!drawing) return;
    const point = pointOf(event);
    const previous = points.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 2) points.push(point);
    redraw(performance.now());
});

function finishStroke(): void {
    if (!drawing) return;
    drawing = false;
    if (phase === "trace") {
        applyTrace(scoreTrace(points, target));
    } else if (phase === "parry" && incoming && !parryResolved) {
        parryResolved = true;
        applyParry(evaluateParry(points, incoming));
    }
}

surface.addEventListener("pointerup", finishStroke);
surface.addEventListener("pointercancel", finishStroke);
next.addEventListener("click", advanceExchange);

dynamicMode.addEventListener("change", () => {
    root.dataset.dynamic = String(dynamicMode.checked);
    if (phase !== "round-over") return;
    clearAutoTimer();
    if (dynamicMode.checked) {
        next.classList.add("hidden");
        hint.textContent = "Dynamic duel: next exchange begins automatically.";
        autoTimer = window.setTimeout(advanceExchange, 700);
    } else {
        next.classList.remove("hidden");
        hint.textContent = "Manual mode: press Next exchange when ready.";
    }
});

suggestionsMode.addEventListener("change", updateOpponentRead);

reset.addEventListener("click", () => {
    clearAutoTimer();
    round = 1;
    hpYou = 100;
    hpEnemy = 100;
    previousTarget = undefined;
    previousOpponentId = undefined;
    arena?.reset();
    logRoot.replaceChildren();
    log("New dynamic Rune Trace + Arcane Parry duel.");
    updateHp();
    beginTrace();
});

helpToggle.addEventListener("click", () => {
    const hidden = helpCard.classList.toggle("hidden");
    helpToggle.textContent = hidden ? "Help" : "Hide help";
    helpToggle.setAttribute("aria-expanded", String(!hidden));
});

function frame(now: number): void {
    if (phase === "parry") {
        redraw(now);
        if (incoming && now >= incoming.impactAt) missedImpact();
    }
    frameId = requestAnimationFrame(frame);
}
frameId = requestAnimationFrame(frame);

window.addEventListener("pagehide", () => {
    clearAutoTimer();
    cancelAnimationFrame(frameId);
    arena?.dispose();
});

root.dataset.dynamic = String(dynamicMode.checked);
updateHp();
log("New dynamic Rune Trace + Arcane Parry duel.");
chooseScenario();
beginTrace();
