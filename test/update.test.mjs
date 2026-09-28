import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, updateAvailable } from "../dist/apps/web/src/update.js";

// The installed PWA compares the version it is running (stamped into the
// page) with the one the server now serves (version.json, never cached) and
// offers a reload when the server is ahead.

test("versions compare numerically, part by part", () => {
    assert.equal(compareVersions("0.0.45", "0.0.44"), 1);
    assert.equal(compareVersions("0.0.44", "0.0.45"), -1);
    assert.equal(compareVersions("0.0.44", "0.0.44"), 0);
    assert.equal(compareVersions("0.0.100", "0.0.99"), 1);
    assert.equal(compareVersions("0.1.0", "0.0.99"), 1);
    assert.equal(compareVersions("1.0", "1.0.0"), 0);
});

test("an update is offered only when the served version is newer", () => {
    assert.equal(updateAvailable("0.0.44", "0.0.45"), true);
    assert.equal(updateAvailable("0.0.45", "0.0.45"), false);
    // A rollback or a stale edge answer is not an update: no reload nag.
    assert.equal(updateAvailable("0.0.45", "0.0.44"), false);
});

test("an unstamped dev build or a malformed answer never offers an update", () => {
    assert.equal(updateAvailable("dev", "0.0.45"), false);
    assert.equal(updateAvailable("__WEB_VERSION__", "0.0.45"), false);
    assert.equal(updateAvailable("0.0.44", undefined), false);
    assert.equal(updateAvailable("0.0.44", ""), false);
    assert.equal(updateAvailable("0.0.44", "<!doctype html>"), false);
});
