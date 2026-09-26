import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

// The build assembles apps/web/dist from the tsc output that `pnpm test`
// has already produced. It must stamp the web tier version into the page
// footer AND the service worker cache name, so every deploy invalidates
// the previous shell instead of serving it forever.
const version = JSON.parse(readFileSync("apps/web/package.json", "utf8")).version;

test("build_web stamps the web version into index.html and sw.js", () => {
    execFileSync(process.execPath, ["scripts/build_web.mjs"], { stdio: "pipe" });
    const html = readFileSync("apps/web/dist/index.html", "utf8");
    const sw = readFileSync("apps/web/dist/sw.js", "utf8");
    assert.match(html, new RegExp(`web v${version.replaceAll(".", "\\.")}`));
    assert.ok(!html.includes("__WEB_VERSION__"), "placeholder left in index.html");
    assert.ok(sw.includes(`wyrd-web-v${version}`), "sw.js cache name not versioned");
    assert.ok(!sw.includes("__WEB_VERSION__"), "placeholder left in sw.js");
});

test("the service worker never caches /api/ responses", () => {
    const sw = readFileSync("apps/web/sw.js", "utf8");
    assert.match(sw, /\/api\//, "sw.js has no /api/ bypass");
});
