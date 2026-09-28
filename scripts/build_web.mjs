// Assemble the static web client into apps/web/dist from the tsc output
// in ./dist. Run via `pnpm build:web` (which runs tsc first). The output
// directory sits next to apps/web/functions so `wrangler pages deploy
// dist` from apps/web picks up the /api/* proxy function.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const out = "apps/web/dist";
const webVersion = JSON.parse(readFileSync("apps/web/package.json", "utf8")).version;

rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/apps/web/src`, { recursive: true });

// The web tier version is stamped into the footer (so testers can name the
// build they are on) and into the service worker's cache name (so each
// deploy invalidates the previous shell). test/build_web.test.mjs guards both.
const stamp = file => readFileSync(file, "utf8").replaceAll("__WEB_VERSION__", webVersion);
writeFileSync(`${out}/index.html`, stamp("apps/web/index.html"));
writeFileSync(`${out}/sw.js`, stamp("apps/web/sw.js"));
// The live version for the installed app's update check (apps/web/src/update.ts):
// the page compares its own stamped version against this file.
writeFileSync(`${out}/version.json`, JSON.stringify({ web: webVersion }) + "\n");
cpSync("apps/web/style.css", `${out}/style.css`);
cpSync("apps/web/manifest.webmanifest", `${out}/manifest.webmanifest`);
cpSync("apps/web/icons", `${out}/icons`, { recursive: true });
// Every compiled client module ships: a hand-kept list once dropped two new
// modules and Pages served index.html in their place (test/build_web.test.mjs).
for (const file of readdirSync("dist/apps/web/src").filter(f => f.endsWith(".js"))) cpSync(`dist/apps/web/src/${file}`, `${out}/apps/web/src/${file}`);

// The 3D arena's dependencies: Three.js (MIT) vendored from node_modules for the
// import map in index.html, and the prepared KayKit GLBs (CC0) from apps/web/assets.
const three = "apps/web/node_modules/three";
mkdirSync(`${out}/vendor/three/addons/loaders`, { recursive: true });
mkdirSync(`${out}/vendor/three/addons/utils`, { recursive: true });
for (const file of ["three.module.js", "three.core.js"]) cpSync(`${three}/build/${file}`, `${out}/vendor/three/${file}`);
cpSync(`${three}/examples/jsm/loaders/GLTFLoader.js`, `${out}/vendor/three/addons/loaders/GLTFLoader.js`);
for (const file of ["BufferGeometryUtils.js", "SkeletonUtils.js"]) cpSync(`${three}/examples/jsm/utils/${file}`, `${out}/vendor/three/addons/utils/${file}`);
// The bloom chain for the arena's graphics pass (~76 KB): EffectComposer and its passes plus the shaders they import.
mkdirSync(`${out}/vendor/three/addons/postprocessing`, { recursive: true });
mkdirSync(`${out}/vendor/three/addons/shaders`, { recursive: true });
for (const file of ["EffectComposer.js", "Pass.js", "MaskPass.js", "RenderPass.js", "ShaderPass.js", "UnrealBloomPass.js", "OutputPass.js"]) cpSync(`${three}/examples/jsm/postprocessing/${file}`, `${out}/vendor/three/addons/postprocessing/${file}`);
for (const file of ["CopyShader.js", "LuminosityHighPassShader.js", "OutputShader.js"]) cpSync(`${three}/examples/jsm/shaders/${file}`, `${out}/vendor/three/addons/shaders/${file}`);
cpSync(`${three}/LICENSE`, `${out}/vendor/three/LICENSE`);
if (existsSync("apps/web/assets")) cpSync("apps/web/assets", `${out}/assets`, { recursive: true });

mkdirSync(`${out}/packages`, { recursive: true });
for (const pkg of ["wyrd-grammar", "wyrd-content", "wyrd-resolver", "wyrd-simulation"]) {
    cpSync(`dist/packages/${pkg}`, `${out}/packages/${pkg}`, { recursive: true });
}

console.log(`Built static web client v${webVersion} into ./${out}`);
