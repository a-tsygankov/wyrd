// Assemble the static web client into apps/web/dist from the tsc output
// in ./dist. Run via `pnpm build:web` (which runs tsc first). The output
// directory sits next to apps/web/functions so `wrangler pages deploy
// dist` from apps/web picks up the /api/* proxy function.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

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
// Every compiled client module ships: a hand-kept list once dropped two new
// modules and Pages served index.html in their place (test/build_web.test.mjs).
for (const file of readdirSync("dist/apps/web/src").filter(f => f.endsWith(".js"))) cpSync(`dist/apps/web/src/${file}`, `${out}/apps/web/src/${file}`);

mkdirSync(`${out}/packages`, { recursive: true });
for (const pkg of ["wyrd-grammar", "wyrd-content", "wyrd-resolver", "wyrd-simulation"]) {
    cpSync(`dist/packages/${pkg}`, `${out}/packages/${pkg}`, { recursive: true });
}

console.log(`Built static web client v${webVersion} into ./${out}`);
