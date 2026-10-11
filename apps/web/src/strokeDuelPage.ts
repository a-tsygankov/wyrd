import {
    TRACE_RUNES,
    canonicalTracePoints,
    evaluateParry,
    projectilePosition,
    scoreTrace,
    type IncomingPath,
    type ParryScore,
    type TraceRune,
    type TraceScore
} from "./strokeDuel.js";
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
let target: TraceRune = TRACE_RUNES[0]!;
let points: Point[] = [];
let drawing = false;
let incoming: IncomingPath | undefined;
let parryResolved = false;
let frameId = 0;

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
    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        t: performance.now()
    };
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
    const y = height * 0.5;
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
    ctx.save();
    const gradient = ctx.createRadialGradient(orb.x, orb.y, 1, orb.x, orb.y, 20);
    gradient.addColorStop(0, "#fff");
    gradient.addColorStop(0.25, "#ffcb8c");
    gradient.addColorStop(1, "#ff5f5233");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, 20, 0, Math.PI * 2);
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

function percent(value: number): string {
    return Math.round(value * 100) + "%";
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

function finish(): void {
    phase = "finished";
    root.dataset.phase = phase;
    phasePill.textContent = hpEnemy <= 0 ? "VICTORY" : "DEFEAT";
    prompt.textContent = hpEnemy <= 0 ? "You broke their guard." : "Your ward collapsed.";
    hint.textContent = "Start a new duel to keep testing stroke quality.";
    next.classList.add("hidden");
    setResult(hpEnemy <= 0 ? "Victory. Your traced spells won the duel." : "Defeat. The incoming magic got through.", hpEnemy <= 0);
    log(hpEnemy <= 0 ? "Victory." : "Defeat.");
}

function endExchange(): void {
    if (hpYou <= 0 || hpEnemy <= 0) {
        finish();
        return;
    }
    phase = "round-over";
    root.dataset.phase = phase;
    phasePill.textContent = "RESOLVED";
    prompt.textContent = "Exchange complete";
    hint.textContent = "Review the scores, then begin the next exchange.";
    next.classList.remove("hidden");
}

function beginTrace(): void {
    phase = "trace";
    root.dataset.phase = phase;
    parryResolved = false;
    incoming = undefined;
    points = [];
    target = TRACE_RUNES[(round - 1) % TRACE_RUNES.length]!;
    canvas.dataset.target = target;
    phaseLabel.textContent = "Offense · Rune Trace";
    phasePill.textContent = "TRACE";
    prompt.textContent = "Trace " + runeNames[target];
    hint.textContent = "Follow the ghost rune from left to right. Shape, speed and direction all matter.";
    setMetrics("—", "—", "—", "—");
    setResult("Trace the glowing guide to cast.", undefined);
    next.classList.add("hidden");
    redraw(performance.now());
}

function beginParry(): void {
    if (phase === "finished") return;
    phase = "parry";
    root.dataset.phase = phase;
    points = [];
    const { width, height } = size();
    const launchedAt = performance.now() + 350;
    incoming = { width, height, launchedAt, impactAt: launchedAt + 2200 };
    phaseLabel.textContent = "Defense · Arcane Parry";
    phasePill.textContent = "PARRY";
    prompt.textContent = "Cross the incoming bolt";
    hint.textContent = "Steep = block · diagonal = deflect · curve = reflect. Timing decides whether you touch it at all.";
    setMetrics("—", "—", "—", "—", ["Timing", "Angle", "Curve", "Quality"]);
    setResult("Wait for the bolt, then draw one decisive stroke across its path.", undefined);
    redraw(performance.now());
}

function applyTrace(score: TraceScore): void {
    setMetrics(percent(score.accuracy), percent(score.form), percent(score.direction), percent(score.speed));
    if (score.correct) {
        hpEnemy = Math.max(0, hpEnemy - score.attackDamage);
        updateHp();
        setResult(
            runeNames[score.target] + " landed for " + score.attackDamage + " · cast quality " + percent(score.total) + ".",
            true
        );
        log("Rune Trace: " + runeNames[score.target] + " · quality " + percent(score.total) + " · " + score.attackDamage + " damage.");
    } else {
        setResult("Miscast: the stroke read as " + String(score.recognized).toUpperCase() + ". No attack damage.", false);
        log("Rune Trace miscast: target " + runeNames[score.target] + ", recognized " + score.recognized + ".");
    }

    if (hpEnemy <= 0) finish();
    else window.setTimeout(beginParry, 700);
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

    const label = score.outcome.toUpperCase();
    const suffix = score.counterDamage > 0 ? " · counter " + score.counterDamage : score.incomingDamage > 0 ? " · took " + score.incomingDamage : "";
    setResult(label + suffix + " · " + score.detail, score.outcome !== "miss");
    log("Arcane Parry: " + label + " · timing " + percent(score.timing) + " · angle " + Math.round(score.crossingAngleDeg) + "°" + suffix + ".");
    endExchange();
}

function missedImpact(): void {
    if (phase !== "parry" || parryResolved) return;
    parryResolved = true;
    hpYou = Math.max(0, hpYou - 14);
    updateHp();
    setMetrics("0%", "—", "—", "0%", ["Timing", "Angle", "Curve", "Quality"]);
    setResult("TOO SLOW · the bolt landed before your parry.", false);
    log("Arcane Parry: too slow · 14 damage.");
    endExchange();
}

surface.addEventListener("pointerdown", event => {
    if (phase !== "trace" && phase !== "parry") return;
    drawing = true;
    points = [pointOf(event)];
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
        const score = scoreTrace(points, target);
        applyTrace(score);
    } else if (phase === "parry" && incoming && !parryResolved) {
        parryResolved = true;
        applyParry(evaluateParry(points, incoming));
    }
}

surface.addEventListener("pointerup", finishStroke);
surface.addEventListener("pointercancel", finishStroke);

next.addEventListener("click", () => {
    if (phase !== "round-over") return;
    round++;
    beginTrace();
});

reset.addEventListener("click", () => {
    round = 1;
    hpYou = 100;
    hpEnemy = 100;
    logRoot.replaceChildren();
    log("New Rune Trace + Arcane Parry duel.");
    updateHp();
    beginTrace();
});

function frame(now: number): void {
    if (phase === "parry") {
        redraw(now);
        if (incoming && now >= incoming.impactAt) missedImpact();
    }
    frameId = requestAnimationFrame(frame);
}
frameId = requestAnimationFrame(frame);

window.addEventListener("pagehide", () => cancelAnimationFrame(frameId));

updateHp();
log("New Rune Trace + Arcane Parry duel.");
beginTrace();
