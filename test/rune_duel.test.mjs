import assert from "node:assert/strict";
import test from "node:test";
import {
    COMBOS,
    COUNTERS,
    DRAW_MS,
    FLIGHT_MS,
    GLIMPSE,
    RUNES,
    beats,
    chargeOf,
    classify,
    comboOf,
    openExchange,
    progress,
    readStage,
    ready,
    resolveExchange
} from "../dist/apps/web/src/runeDuel.js";

// Rune Lab's fencing exchange (docs/rune-lab.md): the opponent writes its
// rune stroke by stroke, you read it and ready a counter before it lands.
// Readying early charges your answer; redrawing replaces it (and resets the
// charge); two runes in a known order make a combo. Pure over timestamps.

const at = (ex, fraction) => ex.startedAt + fraction * (ex.impactAt - ex.startedAt);

test("every rune has two counters, and the counter chart never lets a rune beat itself", () => {
    assert.deepEqual([...RUNES].sort(), ["arc", "circle", "line", "spiral", "triangle"]);
    for (const threat of RUNES) {
        assert.equal(COUNTERS[threat].length, 2, threat);
        assert.ok(!COUNTERS[threat].includes(threat), threat);
    }
    assert.ok(beats("circle", "line"), "a Ward blocks a Pierce");
    assert.ok(!beats("line", "circle"));
});

test("an exchange: the opponent writes for DRAW_MS, then the rune flies for FLIGHT_MS and lands", () => {
    const ex = openExchange("triangle", 1000);
    assert.equal(ex.impactAt, 1000 + DRAW_MS + FLIGHT_MS);
    assert.equal(progress(ex, 1000), 0);
    assert.equal(progress(ex, 1000 + DRAW_MS / 2), 0.5);
    assert.equal(progress(ex, 1000 + DRAW_MS + 10), 1);
    // A slower game speed stretches every duration.
    const slow = openExchange("triangle", 0, 0.5);
    assert.equal(slow.impactAt, 2 * (DRAW_MS + FLIGHT_MS));
});

test("the read sharpens as the rune is written: sensing, then a hint, then the name", () => {
    const ex = openExchange("arc", 0);
    assert.equal(readStage(ex, 0), "sensing");
    assert.equal(readStage(ex, DRAW_MS * 0.4), "hint");
    assert.equal(readStage(ex, DRAW_MS * 0.8), "named");
    assert.ok(GLIMPSE > 0.2 && GLIMPSE < 0.5, "the parry glimpse shows an opening, not the rune");
});

test("readying early charges the answer; the charge is the share of the exchange still to come", () => {
    const ex = openExchange("line", 0);
    const early = ready(ex, "circle", 0.9, at(ex, 0.25)).exchange;
    assert.equal(early.readied.rune, "circle");
    assert.ok(Math.abs(chargeOf(early) - 0.75) < 1e-9);
    const late = ready(ex, "circle", 0.9, at(ex, 0.9)).exchange;
    assert.ok(chargeOf(late) < chargeOf(early));
    // After impact nothing more can be readied.
    assert.equal(ready(ex, "circle", 0.9, ex.impactAt + 1).kind, "late");
});

test("a different rune replaces the readied one (adjusting a misread) and restarts its charge", () => {
    const ex = openExchange("line", 0);
    let r = ready(ex, "triangle", 0.9, at(ex, 0.2));
    assert.equal(r.kind, "ready");
    r = ready(r.exchange, "circle", 0.9, at(ex, 0.6));
    assert.equal(r.kind, "replace");
    assert.equal(r.exchange.readied.rune, "circle");
    assert.ok(Math.abs(chargeOf(r.exchange) - 0.4) < 1e-9);
});

test("two runes in a known order make a combo: Empower (— then △), Reflect (○ then ⌒), Siphon (⌣ then —)", () => {
    assert.deepEqual(Object.keys(COMBOS).sort(), ["empower", "reflect", "siphon"]);
    assert.equal(comboOf("line", "triangle"), "empower");
    assert.equal(comboOf("circle", "arc"), "reflect");
    assert.equal(comboOf("spiral", "line"), "siphon");
    assert.equal(comboOf("triangle", "line"), undefined, "order matters");
    assert.equal(comboOf("triangle", "circle"), undefined, "a correction is not a combo");
    // Every threat can be met with at least one combo: its final rune counters it.
    for (const threat of RUNES) {
        assert.ok(Object.values(COMBOS).some(c => beats(c.second, threat)), `no combo answers ${threat}`);
    }
    const ex = openExchange("line", 0);
    let r = ready(ex, "circle", 0.9, at(ex, 0.2));
    r = ready(r.exchange, "arc", 0.9, at(ex, 0.4));
    assert.equal(r.kind, "combo");
    assert.equal(r.exchange.combo, "reflect");
    assert.equal(r.exchange.readied.rune, "arc", "the second rune is the one that answers");
    // A combo keeps the first rune's charge: building it early pays.
    assert.ok(Math.abs(chargeOf(r.exchange) - 0.8) < 1e-9);
    // A third rune starts over.
    r = ready(r.exchange, "line", 0.9, at(ex, 0.6));
    assert.equal(r.kind, "replace");
    assert.equal(r.exchange.combo, undefined);
});

test("at impact a counter hits them harder the earlier it was readied; a wrong rune or none takes the hit", () => {
    const ex = openExchange("line", 0);
    const early = resolveExchange(ready(ex, "circle", 1, at(ex, 0.1)).exchange);
    const late = resolveExchange(ready(ex, "circle", 1, at(ex, 0.95)).exchange);
    assert.equal(early.outcome, "counter");
    assert.ok(early.damageToEnemy > late.damageToEnemy);
    assert.equal(early.damageToYou, 0);
    const wrong = resolveExchange(ready(ex, "spiral", 1, at(ex, 0.5)).exchange);
    assert.equal(wrong.outcome, "fail");
    assert.ok(wrong.damageToYou > 0);
    assert.equal(wrong.damageToEnemy, 0);
    const none = resolveExchange(ex);
    assert.equal(none.outcome, "none");
    assert.ok(none.damageToYou >= wrong.damageToYou, "not answering at all is the worst");
});

test("combos pay only on a counter: Empower hits harder, Reflect returns their blow, Siphon heals", () => {
    const ward = openExchange("circle", 0); // Power breaks a Ward
    const power = resolveExchange(ready(ward, "triangle", 1, at(ward, 0.3)).exchange);
    let r = ready(ward, "line", 1, at(ward, 0.3));
    const empowered = resolveExchange(ready(r.exchange, "triangle", 1, at(ward, 0.4)).exchange);
    assert.equal(empowered.combo, "empower");
    assert.ok(empowered.damageToEnemy > power.damageToEnemy);
    const ex = openExchange("line", 0);
    const plain = resolveExchange(ready(ex, "circle", 1, at(ex, 0.3)).exchange);
    r = ready(ex, "circle", 1, at(ex, 0.3));
    const reflected = resolveExchange(ready(r.exchange, "arc", 1, at(ex, 0.4)).exchange); // Redirect counters Pierce
    assert.equal(reflected.combo, "reflect");
    assert.ok(reflected.damageToEnemy > plain.damageToEnemy);
    const drain = openExchange("arc", 0); // Pierce counters Redirect
    r = ready(drain, "spiral", 1, at(drain, 0.3));
    const siphoned = resolveExchange(ready(r.exchange, "line", 1, at(drain, 0.4)).exchange);
    assert.equal(siphoned.combo, "siphon");
    assert.ok(siphoned.heal > 0);
    assert.equal(siphoned.heal, siphoned.damageToEnemy);
    // A combo whose final rune misses the counter is just a miss (Power does not answer a Pierce).
    r = ready(ex, "line", 1, at(ex, 0.3));
    const missed = resolveExchange(ready(r.exchange, "triangle", 1, at(ex, 0.4)).exchange);
    assert.equal(missed.combo, "empower");
    assert.equal(missed.outcome, "fail");
    assert.equal(missed.heal, 0);
});

test("a cleaner stroke hits harder: execution quality scales the counter", () => {
    const ex = openExchange("line", 0);
    const clean = resolveExchange(ready(ex, "circle", 1, at(ex, 0.5)).exchange);
    const rough = resolveExchange(ready(ex, "circle", 0.6, at(ex, 0.5)).exchange);
    assert.ok(clean.damageToEnemy > rough.damageToEnemy);
});

/** Points along a path, `n` samples of f(t) for t in [0, 1]. */
const path = (f, n = 24) => Array.from({ length: n + 1 }, (_, i) => ({ ...f(i / n), t: i * 16 }));

test("recognition: a straight stroke, an upward arc, a downward arc, a closed loop and a triangle", () => {
    assert.equal(classify(path(t => ({ x: t * 200, y: 100 }))).rune, "line");
    assert.equal(classify(path(t => ({ x: t * 200, y: 100 - Math.sin(Math.PI * t) * 80 }))).rune, "arc");
    assert.equal(classify(path(t => ({ x: t * 200, y: 100 + Math.sin(Math.PI * t) * 80 }))).rune, "spiral");
    assert.equal(classify(path(t => ({ x: 100 + Math.cos(2 * Math.PI * t) * 60, y: 100 + Math.sin(2 * Math.PI * t) * 60 }), 36)).rune, "circle");
    const corners = [{ x: 100, y: 20 }, { x: 180, y: 160 }, { x: 20, y: 160 }, { x: 100, y: 22 }];
    const tri = [];
    for (let s = 0; s < 3; s++) for (let i = 0; i < 10; i++) {
        const a = corners[s], b = corners[s + 1], t = i / 10;
        tri.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, t: tri.length * 16 });
    }
    tri.push({ ...corners[3], t: tri.length * 16 });
    assert.equal(classify(tri).rune, "triangle");
    assert.equal(classify(path(t => ({ x: t * 4, y: 0 }), 3)).rune, "unknown", "too short");
});

test("a triangle with a blunt top is still Power, not Ward: closed shapes are told apart by their corners", () => {
    // Total turning of a triangle drawn corner to corner is 180° plus its top angle, so a top wider
    // than 60° crosses the old 4.2 rad circle threshold; the corner test catches it.
    const corners = [{ x: 100, y: 60 }, { x: 190, y: 160 }, { x: 10, y: 160 }, { x: 100, y: 62 }];
    const tri = [];
    for (let s = 0; s < 3; s++) for (let i = 0; i < 12; i++) {
        const a = corners[s], b = corners[s + 1], t = i / 12;
        tri.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, t: tri.length * 16 });
    }
    tri.push({ ...corners[3], t: tri.length * 16 });
    assert.equal(classify(tri).rune, "triangle");
    // A wobbly hand-drawn loop is still a Ward.
    const wobbly = path(t => ({ x: 100 + Math.cos(2 * Math.PI * t) * (60 + 4 * Math.sin(9 * t)), y: 100 + Math.sin(2 * Math.PI * t) * (55 + 3 * Math.cos(7 * t)) }), 40);
    assert.equal(classify(wobbly).rune, "circle");
});
