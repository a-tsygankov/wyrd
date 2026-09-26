import assert from "node:assert/strict";
import test from "node:test";
import { installHint } from "../dist/apps/web/src/install.js";

const IOS_SAFARI =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const IPAD_SAFARI =
    "Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const IOS_CHROME =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
    "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const DESKTOP_CHROME =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const base = { standalone: false, dismissed: false, canPrompt: false };

test("iPhone Safari in the browser gets the manual Add-to-Home-Screen hint", () => {
    assert.equal(installHint({ ...base, userAgent: IOS_SAFARI }), "ios");
    assert.equal(installHint({ ...base, userAgent: IPAD_SAFARI }), "ios");
});

test("iOS Chrome cannot install a web app, so no hint", () => {
    assert.equal(installHint({ ...base, userAgent: IOS_CHROME }), null);
});

test("Android gets the native prompt only once the browser offered it", () => {
    assert.equal(installHint({ ...base, userAgent: ANDROID_CHROME }), null);
    assert.equal(installHint({ ...base, userAgent: ANDROID_CHROME, canPrompt: true }), "prompt");
});

test("desktop follows the same rule: prompt only when offered", () => {
    assert.equal(installHint({ ...base, userAgent: DESKTOP_CHROME }), null);
    assert.equal(installHint({ ...base, userAgent: DESKTOP_CHROME, canPrompt: true }), "prompt");
});

test("already installed or dismissed means silence", () => {
    assert.equal(installHint({ ...base, userAgent: IOS_SAFARI, standalone: true }), null);
    assert.equal(installHint({ ...base, userAgent: IOS_SAFARI, dismissed: true }), null);
    assert.equal(installHint({ ...base, userAgent: ANDROID_CHROME, canPrompt: true, standalone: true }), null);
    assert.equal(installHint({ ...base, userAgent: ANDROID_CHROME, canPrompt: true, dismissed: true }), null);
});
