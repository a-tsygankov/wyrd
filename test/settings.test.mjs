import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../dist/apps/web/src/settings.js";

function memory(initial = {}) {
    const map = new Map(Object.entries(initial));
    return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => void map.set(k, String(v)), map };
}

test("defaults: classic rules, timers on, telemetry on", () => {
    assert.deepEqual(DEFAULT_SETTINGS, { ruleset: "classic", timers: true, telemetry: true, glyphHelpOpen: false, animations: true, sound: false, arena3d: true, weather: false, suddenDeath: false, press: false, deck: true, arenaFx: true, game: "arcade", arcadeMode: "volley" });
    assert.deepEqual(loadSettings(memory(), new URLSearchParams()), DEFAULT_SETTINGS);
});

test("saved settings are restored and unknown values fall back", () => {
    const storage = memory();
    saveSettings(storage, { ruleset: "teeth", timers: false, telemetry: true, glyphHelpOpen: true, animations: false, sound: true, arena3d: true, weather: false, suddenDeath: false, press: false, deck: true, arenaFx: true, game: "arcade", arcadeMode: "volley" });
    assert.deepEqual(loadSettings(storage, new URLSearchParams()), { ruleset: "teeth", timers: false, telemetry: true, glyphHelpOpen: true, animations: false, sound: true, arena3d: true, weather: false, suddenDeath: false, press: false, deck: true, arenaFx: true, game: "arcade", arcadeMode: "volley" });
    storage.setItem("wyrd.settings", JSON.stringify({ ruleset: "lightning", timers: "maybe" }));
    assert.deepEqual(loadSettings(storage, new URLSearchParams()), DEFAULT_SETTINGS);
    storage.setItem("wyrd.settings", "not json");
    assert.deepEqual(loadSettings(storage, new URLSearchParams()), DEFAULT_SETTINGS);
});

test("URL parameters override storage for this visit only", () => {
    const storage = memory();
    saveSettings(storage, { ruleset: "teeth", timers: true, telemetry: true, glyphHelpOpen: false, animations: true, sound: false, arena3d: true, weather: false, suddenDeath: false, press: false, deck: true, arenaFx: true, game: "arcade", arcadeMode: "volley" });
    const fromUrl = loadSettings(storage, new URLSearchParams("rules=resolve&timers=off&telemetry=off&animations=off&sound=on"));
    assert.deepEqual(fromUrl, { ruleset: "resolve", timers: false, telemetry: false, glyphHelpOpen: false, animations: false, sound: true, arena3d: true, weather: false, suddenDeath: false, press: false, deck: true, arenaFx: true, game: "arcade", arcadeMode: "volley" });
    assert.deepEqual(loadSettings(storage, new URLSearchParams()), { ruleset: "teeth", timers: true, telemetry: true, glyphHelpOpen: false, animations: true, sound: false, arena3d: true, weather: false, suddenDeath: false, press: false, deck: true, arenaFx: true, game: "arcade", arcadeMode: "volley" }, "storage untouched");
    assert.equal(loadSettings(storage, new URLSearchParams("rules=bogus")).ruleset, "teeth", "an unknown rules= is ignored");
});

test("a throwing storage never breaks settings", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    assert.deepEqual(loadSettings(broken, new URLSearchParams()), DEFAULT_SETTINGS);
    assert.doesNotThrow(() => saveSettings(broken, DEFAULT_SETTINGS));
});

test("the teaching deck is on by default, remembered off after the first match, and ?deck= pins it for a visit", () => {
    assert.equal(DEFAULT_SETTINGS.deck, true);
    const store = memory();
    saveSettings(store, { ...DEFAULT_SETTINGS, deck: false });
    assert.equal(loadSettings(store, new URLSearchParams()).deck, false, "the flip after the first match is remembered");
    assert.equal(loadSettings(store, new URLSearchParams("deck=on")).deck, true);
    assert.equal(loadSettings(memory(), new URLSearchParams("deck=off")).deck, false);
});

test("the arena's full effects (bloom, shadows, embers) are a setting, on by default, with ?fx=light|full for a visit", () => {
    assert.equal(DEFAULT_SETTINGS.arenaFx, true);
    const store = memory();
    assert.equal(loadSettings(store, new URLSearchParams("fx=light")).arenaFx, false);
    assert.equal(loadSettings(store, new URLSearchParams("fx=full")).arenaFx, true);
    saveSettings(store, { ...DEFAULT_SETTINGS, arenaFx: false });
    assert.equal(loadSettings(store, new URLSearchParams()).arenaFx, false, "remembered");
});

test("the game is a setting: arcade (Volley) by default, the word duel on request, ?game= for a visit", () => {
    assert.equal(DEFAULT_SETTINGS.game, "arcade");
    const store = memory();
    assert.equal(loadSettings(store, new URLSearchParams("game=word")).game, "word");
    assert.equal(loadSettings(store, new URLSearchParams("game=arcade")).game, "arcade");
    assert.equal(loadSettings(store, new URLSearchParams("game=chess")).game, "arcade", "unknown values fall back");
    saveSettings(store, { ...DEFAULT_SETTINGS, game: "word" });
    assert.equal(loadSettings(store, new URLSearchParams()).game, "word", "remembered");
});

test("the arcade game is a setting: Volley by default, Quickdraw on request, ?arcade= for a visit", () => {
    assert.equal(DEFAULT_SETTINGS.arcadeMode, "volley");
    const store = memory();
    assert.equal(loadSettings(store, new URLSearchParams("arcade=quickdraw")).arcadeMode, "quickdraw");
    assert.equal(loadSettings(store, new URLSearchParams("arcade=volley")).arcadeMode, "volley");
    assert.equal(loadSettings(store, new URLSearchParams("arcade=beam")).arcadeMode, "beam");
    assert.equal(loadSettings(store, new URLSearchParams("arcade=gatetug")).arcadeMode, "gatetug");
    assert.equal(loadSettings(store, new URLSearchParams("arcade=pinball")).arcadeMode, "volley", "unknown values fall back");
    saveSettings(store, { ...DEFAULT_SETTINGS, arcadeMode: "quickdraw" });
    assert.equal(loadSettings(store, new URLSearchParams()).arcadeMode, "quickdraw", "remembered");
});
