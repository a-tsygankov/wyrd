import { createRuneArena, type ArenaRune, type RuneArenaCamera } from "./runeArena.js";
import { createStubArena } from "./runeArenaStub.js";
import { COMBOS, GLIMPSE, STROKES, beats, chargeOf, classify, openExchange, progress, readStage, ready, resolveExchange, type Exchange, type Point, type Rune } from "./runeDuel.js";

/**
 * The Rune Lab page (docs/rune-lab.md). The rules live in runeDuel.ts; this
 * file is the loop, the drawing surface, the arena and the text around them.
 *
 * Rune Fencing: the opponent writes its rune stroke by stroke; you read it
 * and ready the rune that undoes it before it lands. Lifting your finger
 * readies a rune, drawing again adjusts it (or builds a combo), and the
 * exchange resolves at impact. Rune Parry: you glimpse the opening of their
 * stroke, commit blind within four seconds, and both runes are revealed.
 */
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("rune-canvas");
const cast = $("cast");
const ctx = canvas.getContext("2d")!;
const recognized = $("recognized");
const confidence = $("confidence");
const quality = $("quality");
const readied = $("readied");
const intent = $("enemy-intent");
const result = $("result");
const timer = $("timer");
const arena = $("arena");
const theirRune = $("their-rune");
const theirPath = document.querySelector<SVGPathElement>("#their-rune path")!;
// `?arena=off`: no WebGL (the e2e suite on software rendering, or a device without it); same interface.
const arena3d = new URLSearchParams(location.search).get("arena") === "off" ? createStubArena(arena) : createRuneArena(arena);

type Mode = "fencing" | "parry";
const names: Record<Rune | "unknown", string> = { line: "PIERCE", arc: "REDIRECT", circle: "WARD", triangle: "POWER", spiral: "ABSORB", unknown: "—" };
const glyphs: Record<Rune, string> = { line: "—", arc: "⌒", circle: "○", triangle: "△", spiral: "⌣" };
/** Their rune on the HUD: the shared-opening stroke they actually write (runeDuel.ts STROKES). */
const pathOf = (rune: Rune): string => STROKES[rune].map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
/** The first sign of the shape once it leaves the shared flat opening. */
const hints: Record<Rune, string> = { triangle: "A CORNER · POWER?", circle: "CURLING BACK · WARD?", spiral: "BOWING DOWN · ABSORB?", arc: "BOWING UP · REDIRECT?", line: "STILL FLAT · PIERCE?" };

let gameSpeed = 1;
let mode: Mode = "fencing";
let ended = false;
/** Bumped on every new duel so timers from the old one do nothing. */
let lifecycle = 0;
let points: Point[] = [];
let drawing = false;
let hpYou = 100;
let hpEnemy = 100;
/** Fencing: the exchange in play, and whether its rune has left their hand. */
let exchange: Exchange | undefined;
let released = false;
let clockLeft = 60;
let clockTick = 0;
/** Parry: the hidden rune, the commit deadline, whether the round is open. */
let parryRune: Rune = "line";
let parryDeadline = 0;
let parryOpen = false;
let parryGlimpseAt = 0;

const wait = (ms: number): number => ms / gameSpeed;
const chooseRune = (): Rune => (["line", "arc", "circle", "triangle", "spiral"] as const)[Math.floor(Math.random() * 5)]!;

// --- The drawing surface.
function resize(): void {
    const r = canvas.getBoundingClientRect();
    const d = devicePixelRatio || 1;
    canvas.width = r.width * d;
    canvas.height = r.height * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    redraw();
}
new ResizeObserver(resize).observe(canvas);

function redraw(): void {
    const r = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    if (points.length < 2) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#a978ff";
    ctx.shadowColor = "#8b5cff";
    ctx.shadowBlur = 14;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);
    for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
}

function pointOf(e: PointerEvent): Point {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
}

function showRecognition(c: ReturnType<typeof classify>): void {
    recognized.textContent = names[c.rune];
    confidence.textContent = `Confidence ${Math.round(c.score * 100)}%`;
    quality.textContent = `Execution ${c.detail}`;
}

// In fencing an answer counts until impact, the flight included, so drawing stays open until it lands.
const canDraw = (): boolean => !ended && (mode === "fencing" ? exchange !== undefined : parryOpen);

cast.addEventListener("pointerdown", e => {
    if (!canDraw()) return;
    drawing = true;
    points = [pointOf(e)];
    canvas.setPointerCapture(e.pointerId);
    redraw();
});
cast.addEventListener("pointermove", e => {
    if (!drawing) return;
    const p = pointOf(e);
    if (Math.hypot(points.at(-1)!.x - p.x, points.at(-1)!.y - p.y) > 2) points.push(p);
    redraw();
    if (points.length > 8) showRecognition(classify(points));
});
cast.addEventListener("pointerup", () => {
    if (!drawing) return;
    drawing = false;
    const c = classify(points);
    showRecognition(c);
    if (c.rune === "unknown") {
        log("<strong>Fizzle</strong> · gesture not recognized");
        flash("FIZZLE", false);
    } else if (mode === "fencing") readyRune(c.rune, c.score);
    else commitParry(c.rune, c.score);
    // A clean surface for the next stroke: an adjustment or a combo finisher. Only if that stroke
    // has not already begun: a quick finisher would otherwise lose its first points.
    window.setTimeout(() => {
        if (drawing) return;
        points = [];
        redraw();
    }, wait(220));
});

// --- The log: oldest first, newest at the bottom, scrolled into view.
function log(html: string): void {
    const list = $("combat-log");
    const li = document.createElement("li");
    li.innerHTML = html;
    list.append(li);
    list.scrollTop = list.scrollHeight;
}

function flash(text: string, good: boolean): void {
    result.textContent = text;
    result.style.color = good ? "#72e5ff" : "#ff776f";
    result.classList.remove("show");
    void result.offsetWidth;
    result.classList.add("show");
}

function setHp(): void {
    $("hp-you").style.width = `${hpYou}%`;
    $("hp-enemy").style.width = `${hpEnemy}%`;
}

function finish(win: boolean | undefined, why: string): void {
    ended = true;
    exchange = undefined;
    parryOpen = false;
    arena.classList.add("battle-ended");
    const label = win === undefined ? "DRAW" : win ? "VICTORY" : "DEFEAT";
    $("battle-state").textContent = label;
    flash(label, win !== false);
    log(`<strong>${label}</strong> · ${why} · final HP ${hpYou} / ${hpEnemy}`);
}

function finishIfNeeded(): boolean {
    if (ended) return true;
    if (hpEnemy <= 0 || hpYou <= 0) {
        finish(hpEnemy <= 0, hpEnemy <= 0 ? "their HP is gone" : "your HP is gone");
        return true;
    }
    return false;
}

function damage(side: "you" | "enemy", n: number): void {
    if (side === "you") hpYou = Math.max(0, hpYou - n);
    else hpEnemy = Math.max(0, hpEnemy - n);
    setHp();
    arena3d.presentHit(side === "you" ? "player" : "opponent", n);
    log(`<strong>${side === "you" ? "You" : "Opponent"} received ${n} damage</strong> · HP ${side === "you" ? hpYou : hpEnemy}/100`);
    finishIfNeeded();
}

function heal(n: number): void {
    hpYou = Math.min(100, hpYou + n);
    setHp();
    log(`<strong>You drink ${n}</strong> · HP ${hpYou}/100`);
}
// Deterministic hook for the e2e suite: the win condition without random runes.
window.addEventListener("rune-test-damage", e => {
    const d = (e as CustomEvent<{ side: "you" | "enemy"; amount: number }>).detail;
    if (d) damage(d.side, d.amount);
});

// --- Their rune on the HUD: the same stroke the arena draws, big enough to read on a phone.
function showTheirRune(rune: Rune | undefined, p: number): void {
    theirRune.classList.toggle("hidden", rune === undefined);
    if (!rune) return;
    theirPath.setAttribute("d", pathOf(rune));
    theirPath.style.strokeDashoffset = String(1 - p);
    theirRune.dataset.progress = p.toFixed(2);
}

function showReadied(): void {
    const r = exchange?.readied;
    if (!exchange || !r) {
        readied.textContent = "Ready —";
        delete cast.dataset.readied;
        return;
    }
    const charge = Math.round(chargeOf(exchange) * 100);
    readied.textContent = exchange.combo ? `COMBO ${COMBOS[exchange.combo].label} · ${glyphs[COMBOS[exchange.combo].first]}→${glyphs[r.rune]} · charge ${charge}%` : `Ready ${glyphs[r.rune]} ${names[r.rune]} · charge ${charge}%`;
    cast.dataset.readied = r.rune;
    cast.dataset.combo = exchange.combo ?? "";
}

// --- Rune Fencing.
function scheduleFencing(): void {
    const token = lifecycle;
    exchange = undefined;
    released = false;
    showReadied();
    intent.classList.remove("show");
    showTheirRune(undefined, 0);
    arena3d.showOpponentRune("unknown", false);
    $("cast-label").textContent = "WAIT FOR THEIR RUNE";
    window.setTimeout(() => {
        if (token !== lifecycle || mode !== "fencing" || ended) return;
        const threat = chooseRune();
        exchange = openExchange(threat, performance.now(), gameSpeed);
        arena3d.showOpponentRune(threat as ArenaRune, true);
        arena3d.setOpponentProgress(0);
        arena3d.pulseOpponentCast();
        intent.textContent = "FLAT OPENING…";
        intent.classList.add("show");
        $("cast-label").textContent = "READ IT · READY YOUR COUNTER";
        log("They begin to write a rune");
    }, wait(700));
}

function readyRune(rune: Rune, score: number): void {
    if (!exchange) return;
    const r = ready(exchange, rune, score, performance.now());
    if (r.kind === "late") return;
    exchange = r.exchange;
    const charge = Math.round(chargeOf(exchange) * 100);
    if (r.kind === "combo" && exchange.combo) {
        const c = COMBOS[exchange.combo];
        log(`Combo <strong>${c.label}</strong>: ${names[c.first]} → ${names[rune]} · charge ${charge}%`);
        flash(c.label, true);
    } else if (r.kind === "replace") {
        log(`Adjusted: <strong>${names[rune]}</strong> replaces your answer · charge restarts at ${charge}%`);
    } else {
        log(`Readied <strong>${names[rune]}</strong> · charge ${charge}%`);
    }
    showReadied();
}

function fencingFrame(now: number): void {
    if (!exchange) return;
    const p = progress(exchange, now);
    arena3d.setOpponentProgress(p);
    showTheirRune(exchange.threat, p);
    const stage = readStage(exchange, now);
    intent.textContent = stage === "sensing" ? "FLAT OPENING…" : stage === "hint" ? hints[exchange.threat] : `${glyphs[exchange.threat]} ${names[exchange.threat]}`;
    arena.dataset.read = stage;
    if (!released && now >= exchange.drawnAt) {
        // Written: the rune leaves their hand. Your answer still counts until it lands.
        released = true;
        arena3d.pulseOpponentCast();
        arena3d.presentSpell("opponent", exchange.threat as ArenaRune);
        $("cast-label").textContent = "IN FLIGHT · LAST CHANCE";
    }
    if (exchange.readied) showReadied();
    if (now >= exchange.impactAt) impact();
}

function impact(): void {
    const ex = exchange!;
    exchange = undefined;
    const res = resolveExchange(ex);
    const charge = Math.round(res.charge * 100);
    if (res.answer) arena3d.presentSpell("player", res.answer as ArenaRune);
    if (res.outcome === "counter") {
        const combo = res.combo ? ` · ${COMBOS[res.combo].label}` : "";
        log(`Counter: <strong>${names[res.answer!]}</strong> undoes ${names[ex.threat]} · charge ${charge}%${combo} · ${res.damageToEnemy} damage`);
        damage("enemy", res.damageToEnemy);
        if (res.heal > 0) heal(res.heal);
        flash(res.combo ? COMBOS[res.combo].label : res.answer === "arc" ? "REDIRECT" : "PARRY", true);
    } else if (res.outcome === "fail") {
        log(`Counter failed: ${names[res.answer!]} does not answer <strong>${names[ex.threat]}</strong> · incoming ${res.damageToYou}`);
        damage("you", res.damageToYou);
        flash("HIT", false);
    } else {
        log(`No answer to <strong>${names[ex.threat]}</strong> · incoming ${res.damageToYou}`);
        damage("you", res.damageToYou);
        flash("TOO SLOW", false);
    }
    if (!ended) scheduleFencing();
}

// --- Rune Parry: a glimpse of the opening, a blind commit, the reveal.
function startParry(): void {
    parryOpen = true;
    points = [];
    redraw();
    parryRune = chooseRune();
    arena3d.showOpponentRune(parryRune as ArenaRune, true);
    arena3d.setOpponentProgress(0);
    parryGlimpseAt = performance.now();
    parryDeadline = performance.now() + wait(4000);
    intent.textContent = "GLIMPSE · THEN HIDDEN";
    intent.classList.add("show");
    $("cast-label").textContent = "COMMIT BEFORE REVEAL";
    timer.textContent = "4.0";
}

function parryFrame(now: number): void {
    if (!parryOpen) return;
    // The opening is written over the first second, then the rest stays hidden.
    const p = Math.min(GLIMPSE, (GLIMPSE * (now - parryGlimpseAt)) / wait(1000));
    arena3d.setOpponentProgress(p);
    showTheirRune(parryRune, p);
    const left = Math.max(0, parryDeadline - now);
    timer.textContent = (left / 1000).toFixed(1);
    if (left <= 0) {
        parryOpen = false;
        log(`Too slow: their <strong>${names[parryRune]}</strong> lands unanswered`);
        damage("you", 12);
        flash("TOO SLOW", false);
        const token = lifecycle;
        window.setTimeout(() => token === lifecycle && !ended && startParry(), wait(900));
    }
}

function commitParry(rune: Rune, score: number): void {
    if (!parryOpen) return;
    parryOpen = false;
    arena3d.setOpponentProgress(1);
    showTheirRune(parryRune, 1);
    arena3d.pulseOpponentCast();
    intent.textContent = `REVEAL · ${glyphs[parryRune]} ${names[parryRune]}`;
    const playerWins = beats(rune, parryRune);
    const enemyWins = beats(parryRune, rune);
    const token = lifecycle;
    window.setTimeout(() => {
        if (token !== lifecycle) return;
        arena3d.presentSpell("player", rune as ArenaRune);
        arena3d.presentSpell("opponent", parryRune as ArenaRune);
        log(`Reveal: <strong>${names[rune]}</strong> vs <strong>${names[parryRune]}</strong>`);
        if (playerWins && !enemyWins) {
            damage("enemy", Math.round(12 + score * 10));
            flash("PARRY", true);
        } else if (enemyWins && !playerWins) {
            damage("you", 18);
            flash("COUNTERED", false);
        } else {
            log("Clash: neither rune undoes the other");
            flash("CLASH", true);
        }
        if (!ended) window.setTimeout(() => token === lifecycle && !ended && startParry(), wait(1200));
    }, wait(550));
}

// --- Modes and the clock.
const MODE_TEXT: Record<Mode, { title: string; help: string }> = {
    fencing: { title: "Real-time spell fencing", help: "Read their rune as it is written. Ready the counter before it lands; draw again to adjust or combo." },
    parry: { title: "Simultaneous rune parry", help: "Glimpse the opening of their stroke, commit within 4 seconds, then both runes are revealed." }
};

function setMode(m: Mode): void {
    lifecycle++;
    mode = m;
    ended = false;
    exchange = undefined;
    parryOpen = false;
    arena.classList.remove("battle-ended");
    $("battle-state").textContent = "DUEL ACTIVE";
    $("combat-log").replaceChildren();
    log(`<strong>New ${m === "fencing" ? "Rune Fencing" : "Rune Parry"} duel</strong>`);
    document.querySelectorAll<HTMLElement>(".tab").forEach(x => x.classList.toggle("active", x.dataset.mode === m));
    hpYou = hpEnemy = 100;
    setHp();
    points = [];
    redraw();
    $("mode-title").textContent = MODE_TEXT[m].title;
    $("mode-help").textContent = MODE_TEXT[m].help;
    showTheirRune(undefined, 0);
    showReadied();
    if (m === "fencing") {
        clockLeft = 60;
        clockTick = 0;
        timer.textContent = "60";
        scheduleFencing();
    } else startParry();
}

function frame(): void {
    requestAnimationFrame(frame);
    const now = performance.now();
    if (ended) return;
    if (mode === "fencing") fencingFrame(now);
    else parryFrame(now);
}
requestAnimationFrame(frame);

// The fencing clock: a minute at 1×, faster at a higher game speed. At zero the healthier mage wins.
window.setInterval(() => {
    if (mode !== "fencing" || ended) return;
    clockTick += 100 * gameSpeed;
    if (clockTick >= 1000 && clockLeft > 0) {
        clockTick -= 1000;
        clockLeft--;
        timer.textContent = String(clockLeft);
        if (clockLeft === 0) finish(hpYou === hpEnemy ? undefined : hpYou > hpEnemy, "time");
    }
}, 100);

// --- Help: the five strokes over each other, the shared opening in white, each branch in its own colour.
(function drawOpenings(): void {
    const svg = document.getElementById("help-openings-diagram");
    if (!svg) return;
    // Pierce in pink, not white, so the white shared lead stands out from it.
    const colours: Record<Rune, string> = { line: "#ff9fb2", triangle: "#ffc86b", arc: "#65d9ff", spiral: "#9b6cff", circle: "#72e5a0" };
    const ns = "http://www.w3.org/2000/svg";
    for (const rune of ["circle", "triangle", "arc", "spiral", "line"] as const) {
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", pathOf(rune));
        path.setAttribute("stroke", colours[rune]);
        path.dataset.rune = rune;
        svg.append(path);
    }
    const lead = document.createElementNS(ns, "path");
    lead.setAttribute("d", "M12 50 H34");
    lead.setAttribute("class", "lead");
    svg.append(lead);
})();

// --- Drawers, speed and camera.
$("log-toggle").onclick = () => $("combat-log-panel").classList.toggle("hidden");
$("help-toggle").onclick = () => $("rune-help").classList.toggle("hidden");
$("log-clear").onclick = () => $("combat-log").replaceChildren();
const speed = $<HTMLSelectElement>("speed");
speed.onchange = () => {
    gameSpeed = Number(speed.value) || 1;
    try {
        localStorage.setItem("wyrd-rune-speed", String(gameSpeed));
    } catch {
        /* private mode: the speed lasts for this page */
    }
    log(`Game speed changed to <strong>${gameSpeed}×</strong>`);
};
try {
    const s = localStorage.getItem("wyrd-rune-speed");
    if (s) {
        speed.value = s;
        gameSpeed = Number(s) || 1;
    }
} catch {
    /* no storage: 1× */
}
// `?speed=0.25` for one visit (slow play, and the e2e suite on slow software-WebGL frames); not remembered.
const urlSpeed = Number(new URLSearchParams(location.search).get("speed"));
if (urlSpeed > 0) {
    gameSpeed = urlSpeed;
    // Show it when the selector has it (0.5, 1, 1.5, 2); slower test speeds leave the selector alone.
    const option = Array.from(speed.options).find(o => Number(o.value) === urlSpeed);
    if (option) speed.value = option.value;
}
$("camera-left").onclick = () => arena3d.orbit(-0.24, 0);
$("camera-right").onclick = () => arena3d.orbit(0.24, 0);
$("camera-zoom-in").onclick = () => arena3d.zoom(-0.8);
$("camera-zoom-out").onclick = () => arena3d.zoom(0.8);
$("camera-reset").onclick = () => arena3d.resetCamera();
type Camera = "behind" | "side" | "top" | "abstract";
const cameraHelp: Record<Camera, string> = {
    behind: "Both fighters framed from behind your caster.",
    side: "Both fighters in a readable duel profile.",
    top: "Both fighters visible with tactical spacing.",
    abstract: "Both fighters visible; opponent is ghosted to emphasize rune language."
};
function setCamera(camera: Camera): void {
    arena3d.setCamera(camera as RuneArenaCamera);
    arena.dataset.camera = camera;
    document.querySelectorAll<HTMLButtonElement>("[data-camera]").forEach(b => b.classList.toggle("active", b.dataset.camera === camera));
    $("camera-help").textContent = cameraHelp[camera];
    try {
        localStorage.setItem("wyrd-rune-camera", camera);
    } catch {
        /* the view lasts for this page */
    }
}
$("camera-toggle").onclick = () => $("camera-panel").classList.toggle("hidden");
document.querySelectorAll<HTMLButtonElement>("button[data-camera]").forEach(b => (b.onclick = () => setCamera(b.dataset.camera as Camera)));
let initialCamera: Camera = "behind";
try {
    const saved = localStorage.getItem("wyrd-rune-camera");
    if (saved && saved in cameraHelp) initialCamera = saved as Camera;
} catch {
    /* default view */
}
setCamera(initialCamera);
document.querySelectorAll<HTMLButtonElement>(".tab").forEach(b => (b.onclick = () => setMode(b.dataset.mode as Mode)));
$("reset").onclick = () => setMode(mode);
setMode("fencing");
