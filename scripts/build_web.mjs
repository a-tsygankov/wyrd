import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("site", { recursive: true, force: true });
mkdirSync("site/apps/web/src", { recursive: true });

cpSync("apps/web/index.html", "site/index.html");
cpSync("apps/web/style.css", "site/style.css");
cpSync("apps/web/manifest.webmanifest", "site/manifest.webmanifest");
cpSync("apps/web/sw.js", "site/sw.js");
cpSync("dist/apps/web/src/main.js", "site/apps/web/src/main.js");

mkdirSync("site/packages", { recursive: true });
cpSync("dist/packages/wyrd-grammar", "site/packages/wyrd-grammar", { recursive: true });
cpSync("dist/packages/wyrd-content", "site/packages/wyrd-content", { recursive: true });
cpSync("dist/packages/wyrd-resolver", "site/packages/wyrd-resolver", { recursive: true });

console.log("Built static POC into ./site");
