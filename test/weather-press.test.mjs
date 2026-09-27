import assert from "node:assert/strict";
import test from "node:test";
import { WEATHERS, weatherForRound, weatherAnnouncedFor } from "../dist/packages/wyrd-content/src/weather.js";
import { createRng } from "../dist/packages/wyrd-simulation/src/rng.js";
import { createInitialDuelState, resolveEncounter, resolveRound, REACTION_COSTS, reactionPrice } from "../dist/packages/wyrd-resolver/src/index.js";
import { rulesets } from "../dist/packages/wyrd-content/src/rulesets.js";
import { PERSONALITIES, botPresses, botRetreats } from "../dist/packages/wyrd-simulation/src/bot.js";
import { pressResult, suddenDeathWinner, isSuddenDeath, applyStake, stakeLines } from "../dist/apps/web/src/stakes.js";
import { loadSettings, DEFAULT_SETTINGS } from "../dist/apps/web/src/settings.js";

// Option H (weather rounds, sudden death) and idea J (press the round), both
// behind Rules switches, both seeded, both explained in the log.

function cast(state, casterId, tokens, reaction) {
    const defenderId = casterId === "player" ? "opponent" : "player";
    return resolveEncounter(state, { casterId, defenderId, spellTokens: tokens, ...(reaction ? { reaction } : {}) });
}
const codes = r => r.steps.map(s => s.code);

// --- weather -----------------------------------------------------------------

test("four weathers, each with a title, a rule line and an effect id; every third round draws one, announced the round before", () => {
    assert.deepEqual(WEATHERS.map(w => w.id), ["storm", "hush", "ironbound", "opensky"]);
    for (const w of WEATHERS) assert.ok(w.title.length > 2 && w.text.length > 20, w.id);
    assert.equal(weatherForRound(1, createRng(1)), undefined);
    assert.equal(weatherForRound(2, createRng(1)), undefined);
    assert.ok(WEATHERS.some(w => w.id === weatherForRound(3, createRng(1))));
    assert.ok(weatherForRound(6, createRng(1)));
    assert.equal(weatherForRound(3, createRng(4)), weatherForRound(3, createRng(4)), "seeded");
    const seen = new Set(Array.from({ length: 30 }, (_, i) => weatherForRound(3, createRng(i))));
    assert.ok(seen.size >= 3, "the seed varies the weather");
    assert.equal(weatherAnnouncedFor(2), 3, "round 2 announces round 3's weather");
    assert.equal(weatherAnnouncedFor(3), undefined);
    assert.equal(weatherAnnouncedFor(5), 6);
});

test("storm: AMPLIFY costs no Focus", () => {
    const state = createInitialDuelState(rulesets.teeth.rules);
    state.weather = "storm";
    const result = cast(state, "player", ["FIRE", "SEEK", "ENEMY", "AMPLIFY"]);
    assert.equal(result.state.players.player.focus, 7 - 3, "the AMPLIFY was free");
    assert.ok(codes(result).includes("WEATHER_STORM"));
    const calm = createInitialDuelState(rulesets.teeth.rules);
    assert.equal(cast(calm, "player", ["FIRE", "SEEK", "ENEMY", "AMPLIFY"]).state.players.player.focus, 7 - 4);
});

test("hush: SILENCE is free and strips the essence too, so any ward catches the spell", () => {
    const state = createInitialDuelState(rulesets.teeth.rules);
    state.weather = "hush";
    state.players.opponent.ward = { ownerId: "opponent", essence: "shadow", integrity: 2 };
    const hushed = cast(state, "player", ["FIRE", "SEEK", "ENEMY"], "silence");
    assert.ok(codes(hushed).includes("WARD_BLOCKED"), "FIRE stripped, the SHADOW ward catches an untyped spell");
    assert.equal(hushed.state.players.opponent.focus, 7, "SILENCE cost nothing");
    assert.ok(codes(hushed).includes("WEATHER_HUSH"));
    const plain = cast({ ...state, weather: undefined }, "player", ["FIRE", "SEEK", "ENEMY"], "silence");
    assert.equal(plain.sealAwardedTo, "player", "without the hush FIRE passes a SHADOW ward");
});

test("ironbound: wards have integrity 1 whatever the ruleset", () => {
    const classic = createInitialDuelState();
    classic.weather = "ironbound";
    const warded = cast(classic, "player", ["SELF", "WARD"]);
    assert.equal(warded.state.players.player.ward.integrity, 1);
    const shattered = cast(warded.state, "opponent", ["FIRE", "SEEK", "ENEMY"]);
    assert.ok(codes(shattered).includes("WARD_BROKEN"), "one hit shatters an ironbound ward even under Classic");
});

test("open sky: no ward may be cast", () => {
    const state = createInitialDuelState();
    state.weather = "opensky";
    const result = cast(state, "player", ["SELF", "WARD", "FIRE"]);
    assert.ok(codes(result).includes("WEATHER_OPENSKY"));
    assert.equal(result.effect, undefined);
    assert.equal(result.state.players.player.ward, undefined);
    assert.equal(cast(state, "player", ["GATE", "WARD"]).effect, undefined, "the gate ward too");
    assert.equal(cast(state, "player", ["FIRE", "SEEK", "ENEMY"]).sealAwardedTo, "player", "other spells are untouched");
});

// --- sudden death --------------------------------------------------------------

test("sudden death: at 2-2 the next round doubles reaction prices and one round decides", () => {
    const state = createInitialDuelState(rulesets.teeth.rules);
    state.players.player.seals = 2;
    state.players.opponent.seals = 2;
    assert.equal(isSuddenDeath(state, true), true);
    assert.equal(isSuddenDeath(state, false), false, "off unless the switch is on");
    assert.equal(isSuddenDeath({ ...state, players: { ...state.players, player: { ...state.players.player, seals: 1 } } }, true), false);
    state.suddenDeath = true;
    assert.equal(reactionPrice(state, "reflect"), REACTION_COSTS.reflect * 2);
    assert.equal(reactionPrice({ ...state, suddenDeath: false }, "reflect"), REACTION_COSTS.reflect);
    const r = cast(state, "opponent", ["FIRE", "SEEK", "ENEMY"], "reflect");
    assert.equal(r.state.players.player.focus, 7 - 4, "REFLECT cost 4");
    // Both score in the deciding round: the seal that landed first wins.
    const round = resolveRound(state, { player: { spellTokens: ["SEEK", "ENEMY"] }, opponent: { spellTokens: ["FIRE", "SEEK", "ENEMY"] } });
    assert.equal(round.state.players.player.seals, 3);
    assert.equal(round.state.players.opponent.seals, 3);
    assert.equal(suddenDeathWinner(round), "player", "the cheaper spell resolved first and its seal landed first");
    const none = resolveRound(state, { player: { spellTokens: ["SELF", "WARD"] }, opponent: { spellTokens: ["SELF", "WARD"] } });
    assert.equal(suddenDeathWinner(none), undefined, "nobody scored: another round");
});

// --- press the round -------------------------------------------------------------

test("press: the round's seal counts double for its winner, both pressing makes it four; a retreat concedes one seal and keeps the stake single", () => {
    assert.deepEqual(pressResult({ pressed: {}, yours: 1, theirs: 0 }), {});
    assert.deepEqual(pressResult({ pressed: { player: true }, yours: 1, theirs: 0 }), { extra: { to: "player", seals: 1 } });
    assert.deepEqual(pressResult({ pressed: { player: true }, yours: 0, theirs: 1 }), { extra: { to: "opponent", seals: 1 } }, "pressing cuts both ways");
    assert.deepEqual(pressResult({ pressed: { player: true, opponent: true }, yours: 0, theirs: 1 }), { extra: { to: "opponent", seals: 3 } }, "both pressed: the seal counts four");
    assert.deepEqual(pressResult({ pressed: { opponent: true }, yours: 1, theirs: 1 }), {}, "an even round doubles nothing");
    assert.deepEqual(pressResult({ pressed: { opponent: true }, retreated: "player", yours: 0, theirs: 1 }), { conceded: { from: "player", to: "opponent" } }, "the retreater concedes one to the presser, no double");
    assert.deepEqual(pressResult({ pressed: { opponent: true }, retreated: "player", yours: 1, theirs: 0 }), { conceded: { from: "player", to: "opponent" } }, "even when the retreater's own spell scored");
    const state = createInitialDuelState();
    state.players.player.seals = 1;
    const doubled = applyStake(state, { extra: { to: "player", seals: 1 } });
    assert.equal(doubled.players.player.seals, 2);
    assert.equal(state.players.player.seals, 1, "pure");
    assert.equal(applyStake(state, { conceded: { from: "player", to: "opponent" } }).players.opponent.seals, 1);
    const lines = stakeLines({ pressed: { player: true }, yours: 1, theirs: 0 }, { extra: { to: "player", seals: 1 } }, { you: "You", them: "The Adept" });
    assert.match(lines[0], /You pressed the round/);
    assert.match(lines[1], /2 seals/);
});

test("the bot presses by personality when it likes its spell, and retreats when a double would decide the match against it", () => {
    const state = createInitialDuelState(rulesets.teeth.rules);
    const aggressor = PERSONALITIES.find(p => p.id === "aggressor");
    const warden = PERSONALITIES.find(p => p.id === "warden");
    let presses = 0;
    const rng = createRng(2);
    for (let i = 0; i < 200; i++) if (botPresses({ state, botId: "opponent", personality: aggressor }, ["FIRE", "SEEK", "ENEMY"], rng)) presses++;
    assert.ok(presses > 30 && presses < 120, `aggressor presses ${presses}/200`);
    let wardenPresses = 0;
    for (let i = 0; i < 200; i++) if (botPresses({ state, botId: "opponent", personality: warden }, ["FIRE", "SEEK", "ENEMY"], rng)) wardenPresses++;
    assert.ok(wardenPresses < presses, "the warden presses less");
    assert.equal(botPresses({ state, botId: "opponent", personality: aggressor }, ["SELF", "WARD"], rng), false, "never presses a non-scoring spell");
    // Retreat: when the player is at 2 seals a double loss ends the match; when the bot is safe it plays on.
    const danger = createInitialDuelState(rulesets.teeth.rules);
    danger.players.player.seals = 1;
    danger.players.opponent.seals = 0;
    assert.equal(botRetreats({ state: danger, botId: "opponent", personality: warden }, ["SELF", "WARD"]), true, "its own spell scores nothing: it retreats rather than risk a double");
    assert.equal(botRetreats({ state: danger, botId: "opponent", personality: aggressor }, ["FIRE", "SEEK", "ENEMY"]), false, "a scoring spell is worth the stake");
    const matchPoint = createInitialDuelState(rulesets.teeth.rules);
    matchPoint.players.player.seals = 2;
    assert.equal(botRetreats({ state: matchPoint, botId: "opponent", personality: warden }, ["SELF", "WARD"]), false, "conceding a seal at match point loses outright: no retreat");
});

test("weather, sudden death and press are settings, off by default, with URL switches", () => {
    const store = { getItem: () => null, setItem: () => undefined };
    assert.equal(DEFAULT_SETTINGS.weather, false);
    assert.equal(DEFAULT_SETTINGS.suddenDeath, false);
    assert.equal(DEFAULT_SETTINGS.press, false);
    const on = loadSettings(store, new URLSearchParams("weather=on&sudden=on&press=on"));
    assert.deepEqual([on.weather, on.suddenDeath, on.press], [true, true, true]);
});
