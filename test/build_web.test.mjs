import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
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

test("build_web writes version.json for the client's update check", () => {
    // The installed app polls this file (never cached by the service worker)
    // and offers a reload when it names a newer web version than the page.
    const served = JSON.parse(readFileSync("apps/web/dist/version.json", "utf8"));
    assert.equal(served.web, version);
    const sw = readFileSync("apps/web/dist/sw.js", "utf8");
    assert.ok(sw.includes("/version.json"), "sw.js must bypass the cache for version.json");
});

test("build_web ships every compiled client module, not a hand-kept list", () => {
    // A module missing from dist is served as the HTML fallback by Pages and
    // the whole client fails to load (juice.js and meter.js, 2026-09-26).
    const compiled = readdirSync("dist/apps/web/src").filter(f => f.endsWith(".js"));
    const shipped = new Set(readdirSync("apps/web/dist/apps/web/src"));
    for (const file of compiled) assert.ok(shipped.has(file), `${file} compiled but not shipped`);
    assert.ok(compiled.includes("juice.js") && compiled.includes("meter.js"));
});

test("build_web ships the PWA icon set the manifest points at", () => {
    const manifest = JSON.parse(readFileSync("apps/web/dist/manifest.webmanifest", "utf8"));
    assert.ok(manifest.icons.length >= 3, "manifest needs 192, 512 and maskable icons");
    for (const icon of manifest.icons) {
        const path = "apps/web/dist/" + icon.src.replace(/^\.\//, "");
        const bytes = readFileSync(path);
        assert.equal(bytes.readUInt32BE(16), Number(icon.sizes.split("x")[0]), `${icon.src} width`);
    }
    assert.ok(readFileSync("apps/web/dist/icons/apple-touch-icon.png").length > 0);
});

test("the service worker never caches /api/ responses", () => {
    const sw = readFileSync("apps/web/sw.js", "utf8");
    assert.match(sw, /\/api\//, "sw.js has no /api/ bypass");
});

test("build_web vendors the bloom chain the arena imports through the import map", () => {
    // The arena's graphics pass imports three/addons/postprocessing/*; each
    // file and the shaders they import must ship or the arena silently falls
    // back to the flat stage.
    const shipped = new Set(readdirSync("apps/web/dist/vendor/three/addons/postprocessing"));
    for (const file of ["EffectComposer.js", "RenderPass.js", "UnrealBloomPass.js", "OutputPass.js", "ShaderPass.js", "MaskPass.js", "Pass.js"]) assert.ok(shipped.has(file), `${file} not vendored`);
    const shaders = new Set(readdirSync("apps/web/dist/vendor/three/addons/shaders"));
    for (const file of ["CopyShader.js", "LuminosityHighPassShader.js", "OutputShader.js"]) assert.ok(shaders.has(file), `${file} not vendored`);
});
