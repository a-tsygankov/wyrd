import assert from "node:assert/strict";
import test from "node:test";
import { fullscreenApi } from "../dist/apps/web/src/fullscreen.js";

// Fakes for the three browser shapes the arcade meets: the standard API
// (Chrome on Android, desktop), the webkit-prefixed one (older Safari on
// iPad), and none at all (Safari on iPhone, which has no element fullscreen).

function standardDoc() {
    const calls = [];
    const doc = {
        fullscreenEnabled: true,
        fullscreenElement: null,
        exitFullscreen() {
            calls.push("exit");
            doc.fullscreenElement = null;
            return Promise.resolve();
        }
    };
    const el = {
        requestFullscreen() {
            calls.push("enter");
            doc.fullscreenElement = el;
            return Promise.resolve();
        }
    };
    return { doc, el, calls };
}

function webkitDoc() {
    const calls = [];
    const doc = {
        webkitFullscreenEnabled: true,
        webkitFullscreenElement: null,
        webkitExitFullscreen() {
            calls.push("exit");
            doc.webkitFullscreenElement = null;
        }
    };
    const el = {
        webkitRequestFullscreen() {
            calls.push("enter");
            doc.webkitFullscreenElement = el;
        }
    };
    return { doc, el, calls };
}

test("the standard Fullscreen API is used when the browser has it", async () => {
    const { doc, el, calls } = standardDoc();
    const api = fullscreenApi(doc, el);
    assert.equal(api.supported, true);
    assert.equal(api.active(), false);
    await api.enter();
    assert.equal(api.active(), true);
    await api.exit();
    assert.equal(api.active(), false);
    assert.deepEqual(calls, ["enter", "exit"]);
});

test("the webkit-prefixed API is used when only it exists", async () => {
    const { doc, el, calls } = webkitDoc();
    const api = fullscreenApi(doc, el);
    assert.equal(api.supported, true);
    await api.enter();
    assert.equal(api.active(), true);
    await api.exit();
    assert.equal(api.active(), false);
    assert.deepEqual(calls, ["enter", "exit"]);
});

test("without any API the helper reports unsupported and its calls are harmless", async () => {
    const api = fullscreenApi({}, {});
    assert.equal(api.supported, false);
    assert.equal(api.active(), false);
    await api.enter();
    await api.exit();
    assert.equal(api.active(), false);
});

test("a refused request does not throw: the immersive layout still applies", async () => {
    const doc = { fullscreenEnabled: true, fullscreenElement: null, exitFullscreen: () => Promise.resolve() };
    const el = { requestFullscreen: () => Promise.reject(new Error("not allowed")) };
    const api = fullscreenApi(doc, el);
    await api.enter();
    assert.equal(api.active(), false);
});
