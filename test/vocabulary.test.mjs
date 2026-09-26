import assert from "node:assert/strict";
import test from "node:test";
import { createInitialDuelState, resolveEncounter, MEND_RESOLVE } from "../dist/packages/wyrd-resolver/src/index.js";
import { classifySpell, enumerateLegalSpells } from "../dist/packages/wyrd-simulation/src/spells.js";
import { scoreSpell } from "../dist/packages/wyrd-simulation/src/bot.js";
import { glyphHelpText } from "../dist/packages/wyrd-simulation/src/explain.js";
import { buildTimeline } from "../dist/apps/web/src/stage.js";
import { rulesets } from "../dist/packages/wyrd-content/src/rulesets.js";
import { POC_TRAY } from "../dist/packages/wyrd-content/src/tray.js";

function cast(state, casterId, tokens, reaction) {
    const defenderId = casterId === "player" ? "opponent" : "player";
    return resolveEncounter(state, { casterId, defenderId, spellTokens: tokens, ...(reaction ? { reaction } : {}) });
}
const codes = r => r.steps.map(s => s.code);

test("the POC tray grows to 16 glyphs across the documented families", () => {
    assert.deepEqual(POC_TRAY, ["FIRE", "WATER", "SHADOW", "LIFE", "SELF", "ENEMY", "GATE", "SEEK", "BIND", "WARD", "BREAK", "MEND", "OPEN", "CLOSE", "AMPLIFY", "ANCHOR"]);
    for (const token of POC_TRAY) assert.ok(glyphHelpText(token).length > 20, `${token} needs help text`);
});

test("the gate is a contested objective: CLOSE then OPEN score, repeats fail", () => {
    const fresh = createInitialDuelState();
    assert.equal(fresh.gate, "open");
    const closed = cast(fresh, "player", ["GATE", "CLOSE"]);
    assert.equal(closed.sealAwardedTo, "player");
    assert.equal(closed.state.gate, "closed");
    const again = cast(closed.state, "opponent", ["GATE", "CLOSE"]);
    assert.equal(again.sealAwardedTo, undefined);
    assert.ok(codes(again).includes("GATE_ALREADY_CLOSED"));
    const opened = cast(closed.state, "opponent", ["GATE", "OPEN"]);
    assert.equal(opened.sealAwardedTo, "opponent");
    assert.equal(opened.state.gate, "open");
    const openAgain = cast(opened.state, "player", ["OPEN", "GATE"]);
    assert.ok(codes(openAgain).includes("GATE_ALREADY_OPEN"));
    assert.equal(openAgain.sealAwardedTo, undefined);
    // Wards and REFLECT still cannot touch the objective; NULL still can.
    const reflected = cast(fresh, "opponent", ["GATE", "OPEN"], "reflect");
    assert.ok(codes(reflected).includes("REFLECT_NO_HOSTILE_ROUTE"));
    assert.ok(codes(cast(closed.state, "opponent", ["GATE", "OPEN"], "null")).includes("NULL_CANCELED"));
});

test("BREAK GATE takes the objective off the table until MEND GATE repairs it", () => {
    const fresh = createInitialDuelState();
    const broken = cast(fresh, "opponent", ["GATE", "BREAK"]);
    assert.equal(broken.state.gate, "broken");
    assert.equal(broken.sealAwardedTo, undefined, "breaking scores nothing");
    assert.ok(codes(broken).includes("GATE_SHATTERED"));
    assert.ok(codes(cast(broken.state, "player", ["GATE", "CLOSE"])).includes("GATE_BROKEN"));
    assert.ok(codes(cast(broken.state, "player", ["GATE", "OPEN"])).includes("GATE_BROKEN"));
    const mended = cast(broken.state, "player", ["GATE", "MEND"]);
    assert.equal(mended.state.gate, "open");
    assert.ok(codes(mended).includes("GATE_MENDED"));
    assert.equal(mended.sealAwardedTo, undefined);
    assert.equal(cast(mended.state, "player", ["GATE", "CLOSE"]).sealAwardedTo, "player", "the objective is back");
    assert.ok(codes(cast(fresh, "player", ["GATE", "MEND"])).includes("NOTHING_TO_MEND"));
    assert.ok(codes(cast(broken.state, "player", ["GATE", "BREAK"])).includes("NOTHING_TO_BREAK"));
});

test("BREAK ENEMY strips the opponent's ward, ignores wards, and can be REFLECTed onto your own", () => {
    const state = createInitialDuelState(rulesets.teeth.rules);
    state.players.opponent.ward = { ownerId: "opponent", essence: "fire", integrity: 2 };
    const broke = cast(state, "player", ["ENEMY", "BREAK"]);
    assert.equal(broke.state.players.opponent.ward, undefined);
    assert.ok(codes(broke).includes("WARD_BROKEN"));
    assert.ok(!codes(broke).includes("WARD_BLOCKED"), "a ward cannot block the spell that breaks wards");
    assert.equal(broke.sealAwardedTo, undefined, "BREAK scores nothing; it opens the way");

    const both = createInitialDuelState();
    both.players.player.ward = { ownerId: "player" };
    both.players.opponent.ward = { ownerId: "opponent" };
    const back = cast(both, "player", ["ENEMY", "BREAK"], "reflect");
    assert.ok(codes(back).includes("REFLECT_APPLIED"));
    assert.equal(back.state.players.player.ward, undefined, "reflected: your own ward goes");
    assert.ok(back.state.players.opponent.ward, "theirs stands");
    assert.ok(codes(cast(createInitialDuelState(), "player", ["ENEMY", "BREAK"])).includes("NOTHING_TO_BREAK"));
    const anchored = cast(both, "player", ["ENEMY", "BREAK", "ANCHOR"], "reflect");
    assert.ok(codes(anchored).includes("REFLECT_BLOCKED_BY_ANCHOR"));
    assert.equal(anchored.state.players.opponent.ward, undefined);
});

test("MEND SELF restores ward integrity and, under Resolve, heals", () => {
    const teeth = createInitialDuelState(rulesets.teeth.rules);
    teeth.players.player.ward = { ownerId: "player", essence: "fire", integrity: 1 };
    const mended = cast(teeth, "player", ["SELF", "MEND"]);
    assert.equal(mended.state.players.player.ward.integrity, 2);
    assert.ok(codes(mended).includes("WARD_MENDED"));
    assert.equal(mended.sealAwardedTo, undefined);

    const hp = createInitialDuelState(rulesets.resolve.rules);
    hp.players.player.resolve = 5;
    const healed = cast(hp, "player", ["SELF", "MEND"]);
    assert.equal(healed.state.players.player.resolve, 5 + MEND_RESOLVE);
    assert.ok(codes(healed).includes("RESOLVE_MENDED"));
    const full = createInitialDuelState(rulesets.resolve.rules);
    const capped = cast(full, "player", ["SELF", "MEND"]);
    assert.equal(capped.state.players.player.resolve, 10, "never above the starting Resolve");
    assert.ok(codes(cast(createInitialDuelState(), "player", ["SELF", "MEND"])).includes("NOTHING_TO_MEND"));
});

test("new essences filter wards like the old ones", () => {
    const state = createInitialDuelState();
    state.players.opponent.ward = { ownerId: "opponent", essence: "water" };
    assert.ok(codes(cast(state, "player", ["WATER", "SEEK", "ENEMY"])).includes("WARD_BLOCKED"));
    assert.equal(cast(state, "player", ["LIFE", "SEEK", "ENEMY"]).sealAwardedTo, "player");
    assert.equal(cast(createInitialDuelState(), "player", ["SELF", "WARD", "LIFE"]).state.players.player.ward.essence, "life");
});

test("the legal pool includes the new actions even when the fresh-state probe would fail them", () => {
    const pool = enumerateLegalSpells(POC_TRAY);
    const keys = new Set(pool.map(s => s.tokens.join(" ")));
    for (const k of ["GATE OPEN", "GATE BREAK", "GATE MEND", "ENEMY BREAK", "SELF MEND", "WATER SEEK ENEMY", "SELF WARD LIFE", "ENEMY BREAK ANCHOR"]) {
        assert.ok(keys.has(k), `missing ${k}`);
    }
    assert.equal(classifySpell(["GATE", "OPEN"]).action, "open");
    assert.equal(classifySpell(["ENEMY", "BREAK"]).action, "break");
    assert.equal(classifySpell(["ENEMY", "PUSH"]), undefined, "PUSH is not a POC action");
});

test("the bot values BREAK against a ward, MEND when hurt, and reads the gate", () => {
    const pool = enumerateLegalSpells(POC_TRAY);
    const by = (tokens, view) => scoreSpell(pool.find(s => s.tokens.join(" ") === tokens), view);
    const fresh = createInitialDuelState(rulesets.resolve.rules);
    const view = { state: fresh, botId: "opponent" };
    assert.ok(by("GATE CLOSE", view) > by("GATE OPEN", view), "the gate is open: CLOSE scores, OPEN fails");
    assert.ok(by("SELF BREAK", view) < 0 && by("SELF MEND", view) < 0, "nothing to break or mend");

    const warded = createInitialDuelState(rulesets.resolve.rules);
    warded.players.player.ward = { ownerId: "player", essence: "fire", integrity: 2 };
    const v2 = { state: warded, botId: "opponent" };
    assert.ok(by("ENEMY BREAK", v2) > by("FIRE SEEK ENEMY", v2), "break the ward instead of walking into it");

    const hurt = createInitialDuelState(rulesets.resolve.rules);
    hurt.players.opponent.resolve = 3;
    hurt.gate = "closed";
    const v3 = { state: hurt, botId: "opponent" };
    assert.ok(by("SELF MEND", v3) > 0);
    assert.ok(by("GATE OPEN", v3) > by("GATE CLOSE", v3), "the gate is closed: OPEN scores now");
});

test("the stage has beats for the gate states and the new actions", () => {
    const fresh = createInitialDuelState(rulesets.teeth.rules);
    fresh.players.opponent.ward = { ownerId: "opponent", essence: "fire", integrity: 2 };
    const brk = cast(fresh, "player", ["ENEMY", "BREAK"]);
    assert.deepEqual(buildTimeline({ result: brk, casterId: "player", defenderId: "opponent", spell: ["ENEMY", "BREAK"], reaction: undefined }).map(b => b.kind), ["cast", "fly", "ward-break"]);
    const gb = cast(createInitialDuelState(), "player", ["GATE", "BREAK"]);
    assert.deepEqual(buildTimeline({ result: gb, casterId: "player", defenderId: "opponent", spell: ["GATE", "BREAK"], reaction: undefined }).map(b => b.kind), ["cast", "gate-break"]);
    const go = cast(gb.state.gate === "broken" ? cast(gb.state, "player", ["GATE", "MEND"]).state : gb.state, "player", ["GATE", "CLOSE"]);
    const gopen = cast(go.state, "opponent", ["GATE", "OPEN"]);
    assert.deepEqual(buildTimeline({ result: gopen, casterId: "opponent", defenderId: "player", spell: ["GATE", "OPEN"], reaction: undefined }).map(b => b.kind), ["cast", "gate-open", "seal"]);
    const mend = createInitialDuelState(rulesets.teeth.rules);
    mend.players.player.ward = { ownerId: "player", integrity: 1 };
    const m = cast(mend, "player", ["SELF", "MEND"]);
    assert.deepEqual(buildTimeline({ result: m, casterId: "player", defenderId: "opponent", spell: ["SELF", "MEND"], reaction: undefined }).map(b => b.kind), ["cast", "mend"]);
    const failed = cast(createInitialDuelState(), "player", ["GATE", "OPEN"]);
    assert.deepEqual(buildTimeline({ result: failed, casterId: "player", defenderId: "opponent", spell: ["GATE", "OPEN"], reaction: undefined }).map(b => b.kind), ["cast", "fizzle"]);
});
