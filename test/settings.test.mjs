import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../dist/apps/web/src/settings.js";

function memory(initial = {}) {
    const map = new Map(Object.entries(initial));
    return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => void map.set(k, String(v)), map };
}

test("defaults: classic rules, timers on, telemetry on", () => {
    assert.deepEqual(DEFAULT_SETTINGS, { ruleset: "classic", timers: true, telemetry: true, glyphHelpOpen: false });
    assert.deepEqual(loadSettings(memory(), new URLSearchParams()), DEFAULT_SETTINGS);
});

test("saved settings are restored and unknown values fall back", () => {
    const storage = memory();
    saveSettings(storage, { ruleset: "teeth", timers: false, telemetry: true, glyphHelpOpen: true });
    assert.deepEqual(loadSettings(storage, new URLSearchParams()), { ruleset: "teeth", timers: false, telemetry: true, glyphHelpOpen: true });
    storage.setItem("wyrd.settings", JSON.stringify({ ruleset: "lightning", timers: "maybe" }));
    assert.deepEqual(loadSettings(storage, new URLSearchParams()), DEFAULT_SETTINGS);
    storage.setItem("wyrd.settings", "not json");
    assert.deepEqual(loadSettings(storage, new URLSearchParams()), DEFAULT_SETTINGS);
});

test("URL parameters override storage for this visit only", () => {
    const storage = memory();
    saveSettings(storage, { ruleset: "teeth", timers: true, telemetry: true, glyphHelpOpen: false });
    const fromUrl = loadSettings(storage, new URLSearchParams("rules=resolve&timers=off&telemetry=off"));
    assert.deepEqual(fromUrl, { ruleset: "resolve", timers: false, telemetry: false, glyphHelpOpen: false });
    assert.deepEqual(loadSettings(storage, new URLSearchParams()), { ruleset: "teeth", timers: true, telemetry: true, glyphHelpOpen: false }, "storage untouched");
    assert.equal(loadSettings(storage, new URLSearchParams("rules=bogus")).ruleset, "teeth", "an unknown rules= is ignored");
});

test("a throwing storage never breaks settings", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    assert.deepEqual(loadSettings(broken, new URLSearchParams()), DEFAULT_SETTINGS);
    assert.doesNotThrow(() => saveSettings(broken, DEFAULT_SETTINGS));
});
