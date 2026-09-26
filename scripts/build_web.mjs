// Assemble the static web client into apps/web/dist from the tsc output
// in ./dist. Run via `pnpm build:web` (which runs tsc first). The output
// directory sits next to apps/web/functions so `wrangler pages deploy
// dist` from apps/web picks up the /api/* proxy function.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const out = "apps/web/dist";
const webVersion = JSON.parse(readFileSync("apps/web/package.json", "utf8")).version;

rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/apps/web/src`, { recursive: true });

// The web tier version is inlined at build time so the footer can show
// it before (or without) the worker answering /api/version.
const html = readFileSync("apps/web/index.html", "utf8").replaceAll("__WEB_VERSION__", webVersion);
writeFileSync(`${out}/index.html`, html);
cpSync("apps/web/style.css", `${out}/style.css`);
cpSync("apps/web/manifest.webmanifest", `${out}/manifest.webmanifest`);
cpSync("apps/web/sw.js", `${out}/sw.js`);
cpSync("dist/apps/web/src/main.js", `${out}/apps/web/src/main.js`);

mkdirSync(`${out}/packages`, { recursive: true });
for (const pkg of ["wyrd-grammar", "wyrd-content", "wyrd-resolver"]) {
    cpSync(`dist/packages/${pkg}`, `${out}/packages/${pkg}`, { recursive: true });
}

console.log(`Built static web client v${webVersion} into ./${out}`);
