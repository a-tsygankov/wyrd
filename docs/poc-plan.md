# Wyrd — POC-First Implementation Plan (v2)

**v2 change (2026-09-26):** aligned with the browser/PWA-on-iPhone-and-Android directive and with what is now deployed. Status lines added per milestone; the deployment milestone is done; PWA install/verification and a post-POC path were added. Architecture: `docs/architecture.md`. Live state: `handoff.md`.

## Primary goal

Deploy a playable browser/PWA duel as soon as reasonably possible so real players can answer the highest-risk product question:

> Is partially revealed, composable Wyrd spell combat actually understandable, strategic, and fun?

The deployed build is a gameplay experiment, not a complete game. **Status: a playable build is live at https://wyrd-web.pages.dev and auto-deploys from `main`.**

## POC success criteria

The POC is good enough when:
- a new player can finish a duel with minimal explanation;
- spell composition takes seconds, not minutes;
- telegraphing creates inference rather than arbitrary guessing;
- players can explain why a counter worked or failed;
- common threats have more than one plausible response;
- at least some players voluntarily choose a rematch;
- **[v2]** the above holds on a phone: iPhone Safari (installed to home screen) and Android Chrome (installed), not only desktop.

## Scope freeze

### Include
- browser-based, phone-first UI;
- **PWA installability on both iOS and Android** (manifest, service worker, iOS meta tags, install coach mark on iOS) — promoted from "if low-cost" to required, since the product commitment is an installable web app;
- player vs scripted/heuristic bot;
- optional same-device hot-seat;
- 12–16 interaction-rich glyphs;
- 2–4 glyph spell construction;
- Focus budget;
- partial telegraph;
- one reaction/counter window;
- deterministic resolution;
- player-readable combat log;
- first to 3 seals;
- deterministic match replay/state serialization;
- lightweight anonymous telemetry only if easy (the worker + D1 now exist, so "easy" is a `POST` and a migration).

### Exclude for now
- authentication and accounts;
- persistent inventory;
- matchmaking and online PvP;
- geo;
- Masks;
- economy/progression;
- unknown-glyph discovery;
- polished final art and 3D;
- full 30-glyph resolver coverage;
- complete conditional/trigger system;
- **[v2]** app-store packaging (TWA/Capacitor) — the URL is the distribution.

Note: a thin backend now exists (`apps/api`: health, version, `POST /api/duel/resolve` logging to D1). It is infrastructure for later milestones and telemetry; **gameplay stays client-side and offline-capable** until POC-5 evidence says otherwise.

## POC glyph set

Unchanged: FIRE, SHADOW, SELF, ENEMY, SPELL, GATE · SEEK, BIND, WARD, CLOSE · AMPLIFY, REFLECT, ANCHOR, NULL, SILENCE · SPLIT only if it does not delay. The parser may support more grammar than the UI exposes (it does: 30 glyphs).

## Accelerated milestone order

### POC-0 — grammar baseline — **done**
Semantic types, GlyphDefinition, 30-glyph registry, scored candidate parser, ambiguity rejection, Focus/complexity, IF parsing, CI + version-bump workflows.

Remaining: freeze the exact POC glyph subset in content (currently frozen in the web client's tray); stop expanding grammar unless a duel scenario requires it.

### POC-1 — minimal resolver vertical slice — **done**
`DuelState`, `ResolutionContext`, `ResolutionStep`, seals, Focus, wards, NULL/ANCHOR/REFLECT/AMPLIFY/SILENCE stages, SEEK/BIND/WARD/CLOSE. Golden tests in `test/resolver.test.mjs`.

### POC-2 — playable browser duel — **done (zero-dependency shell)**
`apps/web` exists as a plain TypeScript + HTML/CSS shell, portrait-first, importing grammar/content/resolver directly. Flow: telegraph → Focus → glyph tray → spell strip → validity/cost → commit → reaction → resolve → stepped log → seal → next round.

Deviation from v1: React/Vite was deferred (architecture doc §2). Adopt React only when UI complexity (grimoire, replay, map) demands it; grammar/resolver stay untouched.

### POC-3 — simple opponent — **done (bot, challenge seed, hot-seat)**
`packages/wyrd-simulation`: seeded RNG, enumeration of every legal spell the tray allows (parser + resolver as the authority), a scoring-table bot for spells (prefers scoring threats, never walks into a ward, bluffs with AMPLIFY/ANCHOR, never repeats) and reactions (REFLECT open routes, SILENCE modifiers, NULL only at match point). `?seed=<text>` replays the same opponent. Same-device hot-seat (`apps/web/src/hotseat.ts`): Player 2 composes → hand-off → Player 1 reads, reacts, casts → hand-off → Player 2 reacts → resolve; telemetry tags rounds with `mode`.

### POC-4 — deploy — **done**
Cloudflare Pages `wyrd-web` (HTTPS, stable URL, auto-deploy from `main`, per-branch previews), Worker `wyrd-api`, D1 `wyrd-db`, GitHub Actions `deploy.yml`, tier version bumps enforced. Secrets set; first CI deploy green.

### POC-4b — PWA verification on real phones — **[v2 new] code done; human pass pending — use `docs/playtest-checklist.md`**
1. iPhone: Safari → Share → Add to Home Screen; app opens standalone, safe areas respected, offline reload works, a full match completes.
2. Android: Chrome install prompt appears; same checks.
3. Add an iOS install coach mark (no install prompt API on iOS) and Android `beforeinstallprompt` handling.
4. Service worker: versioned cache name tied to the web tier version so a deploy invalidates the shell; the `/api/*` path is never cached.
5. Playwright smoke in CI against the Pages preview: `webkit` (iPhone) + `chromium` (Pixel) projects; asserts the page loads, the service worker registers, and a scripted match reaches a seal. Replaces the current curl smoke.
6. Lighthouse PWA/installability audit run manually before the first external playtest.

Definition of done: a tester with a link, on either platform, installs and finishes a first-to-3-seals match with no help.

### POC-5 — gameplay experiment — **deck ready, playtests pending**
The curated deck ships as data in `packages/wyrd-content/src/scenarios.ts` (8 scenarios: direct threat, open route, protected route, AMPLIFY bluff, SILENCE vs modifier, NULL hard counter, reading a ward, behind your own ward). The client plays it in order before handing over to the bot and prints each scenario's lesson and documented responses after the round; `test/scenarios.test.mjs` proves every documented response resolves as the lesson claims. Rounds 1–4 and 7 use the high-information telegraph, 5, 6 and 8 the medium one.

Original content: 6–10 curated situations (direct threat, AMPLIFY bluff, REFLECT opportunity, ANCHOR protecting route, SILENCE stripping a modifier, NULL as expensive hard counter, WARD interaction, SPLIT if included). Test high-information telegraph first, then medium. Ask after each duel: understood why you won/lost? inference or guess? more than one reasonable choice? useless glyph? mandatory glyph? another duel?

**[v2] Telemetry — done.** `POST /api/telemetry` stores round / rematch / match_end events (telegraph shown, spells, both reactions, seals gained, time-to-commit) in `telemetry_events` (`0001_telemetry.sql`); anonymous session UUID in local storage; fire-and-forget with keepalive, `?telemetry=off` disables it. `GET /api/telemetry/summary` gives the playtest review view: per scenario, reaction distribution, player seal rate and median time-to-commit, plus rematch and session counts.

### POC-5b — explanations — **done**
Players can explain why a counter worked or failed without a facilitator: each glyph added to the strip explains what it does and to whom; the strip's summary is a resolver dry-run ("If the opponent does not react: … → seal to you", "Open to REFLECT …", "SILENCE would strip …"); the chosen reaction is explained against what the telegraph shows; every resolved round opens with a verdict and reasons, and the match ends with the winner, score and winning seals.

### POC-6 — short iterate/deploy loops
Unchanged: change one rule/cost, deploy (CI does it), replay the same scenarios, compare. The tier versions in the footer tell testers which build they are on.

### POC-7 — rulesets for the engagement experiment — **done (code); evidence pending**
The four decisions in `docs/duel-engagement-options.md` §6 were taken as proposed. Players pick one of four rulesets in Settings: Classic, Teeth (ward integrity, reaction Focus costs, ignite), Pulse (Teeth + timers and quick cast), Resolve (Pulse + hit points as a second clock). Every round and match is tagged with its ruleset; the Stats panel shows this device's numbers and everyone's per-ruleset summary. The SVG/CSS stage with sound followed the same day (`apps/web/src/stage.ts`, `sound.ts`). Deferred from the packages: weather/sudden death, progressive telegraph reveal, bot personalities, in-match draft.

## Post-POC path (only after POC-5 evidence) **[v2]**

Ordered per `docs/architecture.md` §24:
1. React + Vite presentation layer if UI complexity warrants it.
2. Server-authoritative duels in a Cloudflare Durable Object room (WebSockets, reconnect, alarms); async duel mode with Web Push.
3. Small React Three Fiber encounter scene within a mobile GPU budget.
4. MapLibre + H3 + simulated location, then foreground device geolocation for check-ins.
5. Versioned content packs from R2.

No Unity or native client at any step; store presence, if ever needed, wraps the same PWA.

## Repository priority

```text
packages/  wyrd-grammar  wyrd-content  wyrd-resolver   (later: wyrd-protocol, wyrd-simulation)
apps/      web (PWA — primary deliverable)   api (Worker + D1)   duel-sim (debug harness, optional)
```

## Immediate coding order **[v2]**

1. ~~POC-4b items 3–5~~ done, plus icons/manifest/installability tests; items 1, 2, 6 need a human with phones → `docs/playtest-checklist.md`.
2. ~~Playwright smoke~~ done.
3. ~~Heuristic bot~~ done.
4. ~~Scenario deck + telegraph presets~~ done.
5. ~~Telemetry endpoint + migration~~ done.
6. Playtest on phones; tune rules/costs (the bot's scoring weights and the deck are the knobs); repeat.
7. Only then decide between deeper resolver work, React migration, or PvP.

## Explicit changes from v1

- Deployment target is Cloudflare Pages + Workers + D1 (done), not GitHub Pages/Vercel/Netlify.
- PWA installability on iOS and Android is a requirement, not a nice-to-have, with a verification milestone (POC-4b).
- React/Vite is deferred until UI complexity demands it; the zero-dependency shell is the shipped POC.
- A minimal backend exists for versions/logging/telemetry; gameplay remains client-side until PvP.
- The post-POC path is browser-only; the Unity client from the v1 architecture is dropped.
