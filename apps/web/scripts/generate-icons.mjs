#!/usr/bin/env node
/**
 * Generate the PWA icon set into apps/web/icons/ (committed; CI never
 * runs this). Rerun after changing the mark:
 *
 *     node apps/web/scripts/generate-icons.mjs
 *
 * Without 192/512 icons Android Chrome never offers "Install", and iOS
 * falls back to a screenshot for the home-screen icon - both would fail
 * the phone playtest checklist before a single duel.
 *
 * The mark is pure SVG shapes (no <text>: font rendering inside librsvg
 * is unreliable across platforms): a night-violet tile with a sigil -
 * a ring, a vertical stave and a crossing stroke - in the app's accent.
 *
 * Variants:
 *   icon-192 / icon-512   rounded tile (purpose "any")
 *   maskable-512          square full-bleed, sigil inside the 80% safe zone
 *   apple-touch-icon      180px square (iOS rounds it itself)
 *   favicon-32            small rounded tile
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
const NIGHT = "#15111f";
const ACCENT_A = "#744eff";
const ACCENT_B = "#ad63ff";

function markSvg(size, { rounded, safe }) {
    const rx = rounded ? Math.round(size * 0.18) : 0;
    const scale = safe ? 0.8 : 1;
    const c = size / 2;
    const r = size * 0.3 * scale;
    const stroke = Math.max(2, size * 0.06 * scale);
    const staveTop = c - r * 1.25;
    const staveBottom = c + r * 1.25;
    const cross = r * 0.9;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${ACCENT_A}"/>
      <stop offset="1" stop-color="${ACCENT_B}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${rx}" fill="${NIGHT}"/>
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="url(#g)" stroke-width="${stroke}"/>
  <line x1="${c}" y1="${staveTop}" x2="${c}" y2="${staveBottom}" stroke="url(#g)" stroke-width="${stroke}" stroke-linecap="round"/>
  <line x1="${c - cross}" y1="${c + cross * 0.45}" x2="${c + cross}" y2="${c - cross * 0.45}" stroke="url(#g)" stroke-width="${stroke}" stroke-linecap="round"/>
  <circle cx="${c}" cy="${c}" r="${stroke * 0.9}" fill="#f4f0ff"/>
</svg>`;
}

const variants = [
    { file: "icon-192.png", size: 192, rounded: true, safe: false },
    { file: "icon-512.png", size: 512, rounded: true, safe: false },
    { file: "maskable-512.png", size: 512, rounded: false, safe: true },
    { file: "apple-touch-icon.png", size: 180, rounded: false, safe: false },
    { file: "favicon-32.png", size: 32, rounded: true, safe: false }
];

await mkdir(OUT, { recursive: true });
for (const v of variants) {
    const png = await sharp(Buffer.from(markSvg(v.size, v))).png().toBuffer();
    await writeFile(join(OUT, v.file), png);
    console.log(`${v.file} ${v.size}x${v.size} ${png.length} bytes`);
}
// The SVG source too, for anyone touching the mark later.
await writeFile(join(OUT, "mark.svg"), markSvg(512, { rounded: true, safe: false }));
