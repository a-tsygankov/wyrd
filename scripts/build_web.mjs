// Assemble the static web client into apps/web/dist from the tsc output
// in ./dist. Run via `pnpm build:web` (which runs tsc first). The output
// directory sits next to apps/web/functions so `wrangler pages deploy
// dist` from apps/web picks up the /api/* proxy function.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

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
cpSync("apps/web/style.css", `${out}/style.css`);
cpSync("apps/web/manifest.webmanifest", `${out}/manifest.webmanifest`);
cpSync("apps/web/icons", `${out}/icons`, { recursive: true });
cpSync("dist/apps/web/src/main.js", `${out}/apps/web/src/main.js`);
cpSync("dist/apps/web/src/install.js", `${out}/apps/web/src/install.js`);
cpSync("dist/apps/web/src/telemetry.js", `${out}/apps/web/src/telemetry.js`);
cpSync("dist/apps/web/src/log.js", `${out}/apps/web/src/log.js`);

mkdirSync(`${out}/packages`, { recursive: true });
for (const pkg of ["wyrd-grammar", "wyrd-content", "wyrd-resolver", "wyrd-simulation"]) {
    cpSync(`dist/packages/${pkg}`, `${out}/packages/${pkg}`, { recursive: true });
}

console.log(`Built static web client v${webVersion} into ./${out}`);
