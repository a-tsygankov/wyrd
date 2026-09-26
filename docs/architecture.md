# Wyrd — Architecture and Toolchain Strategy (v2, browser/PWA-first)

**v2 change (2026-09-26):** gameplay ships as a browser / PWA application on both iPhone and Android. The native Unity client that v1 positioned as the "full-game" target is removed from the roadmap; the web client *is* the production client. Sections that changed are marked **[v2]**. Everything about the authoritative TypeScript kernel, protocol, replays, geo and testing carries over unchanged in spirit.

Source of truth for product/design: `Wyrd_Masks_Game_Concept` (Google Docs). Live engineering state: `handoff.md` in the repo.

---

## Purpose

This document separates the architecture into two deliberately different targets:

1. a **minimal POC architecture** optimized for validating whether the Wyrd duel mechanic is understandable and fun;
2. a **full-game architecture** that can grow into PvP, geo discovery, persistent progression, 3D encounter scenes and downloadable city content — **while staying a browser/PWA app on iOS and Android**.

The most important architectural rule is unchanged:

> The renderer must never own the game rules.

The TypeScript grammar and resolver remain the authoritative foundation. The same packages run in the browser today, in the Cloudflare Worker today, and in duel rooms later.

---

## 1. Architectural core

```text
┌─────────────────────────────────────────────────────┐
│ Clients                                             │
│ PWA (iOS Safari / Android Chrome / desktop)         │
│ Admin & replay tools (same web codebase)            │
├─────────────────────────────────────────────────────┤
│ Game Protocol                                       │
│ CastIntent / ReactionIntent / MatchEvent / etc.     │
├─────────────────────────────────────────────────────┤
│ Authoritative Game Kernel                           │
│ Grammar → Resolver → Duel rules → Outcomes          │
├─────────────────────────────────────────────────────┤
│ Persistent World                                    │
│ Players / grimoire / geo cells / puzzles / content  │
└─────────────────────────────────────────────────────┘
```

The game kernel stays deterministic, pure where possible, independent of React, GPS, databases, HTTP and WebSockets, and replayable from `initial state + intents + seed`:

```text
same spell + same initial state + same seed → identical result
```

Package structure (current, plus planned):

```text
packages/
  wyrd-content/     glyphs, encounters, puzzles, balance tables   (exists)
  wyrd-grammar/     parser, AST, type system, diagnostics         (exists)
  wyrd-resolver/    deterministic game resolution                 (exists)
  wyrd-protocol/    intents, events, serialized contracts         (planned, with PvP)
  wyrd-simulation/  bots, replay verification, balance batches    (planned)
apps/
  web/              the PWA (client)                              (exists)
  api/              Cloudflare Worker + D1                        (exists)
  duel-sim/         text harness                                  (stub)
```

---

## 2. Minimal POC architecture

Remain browser-first. The POC exists to answer:

> Can players understand enough of the opponent's partially revealed spell to make an interesting decision under uncertainty?

### POC stack **[v2: updated to what is deployed]**

| Area | Choice |
|---|---|
| Language | TypeScript |
| UI | zero-dependency TS shell now; React + Vite after first playtests if UI complexity warrants it |
| Build | `tsc` + copy script now; Vite when React lands |
| State | reducer / plain state; Zustand when React lands |
| 3D (later) | React Three Fiber + Three.js (+ Drei) |
| Multiplayer (later) | Cloudflare Durable Objects (WebSockets) — see §4 |
| Maps (later) | MapLibre GL JS |
| Geo cells (later) | H3 |
| Geo ops (later) | Turf.js |
| Persistence | Cloudflare D1 (SQLite), migrations in `apps/api/migrations/` |
| Authentication | none in POC; anonymous session id next |
| Hosting UI | **Cloudflare Pages** `wyrd-web` (per-branch previews) |
| Hosting API | **Cloudflare Workers** `wyrd-api` (+ D1 `wyrd-db`) |
| CI/CD | GitHub Actions `deploy.yml`: tests → migrations → worker → Pages |
| Tests | Node tests, vitest (workers pool), fast-check (planned), Playwright (planned) |

GitHub Pages and a separate Node/Colyseus host are no longer part of the plan: the gigsy/feedme2 Cloudflare pipeline is already wired and gives previews, a worker and a database for free.

The zero-dependency UI is not rewritten before the first human gameplay validation.

---

## 3. PWA platform constraints **[v2: new]**

The product commitment is "installable web app on iPhone and Android". Design around what the two platforms actually allow.

| Capability | iOS Safari (home-screen app) | Android Chrome (installed PWA) | Consequence for Wyrd |
|---|---|---|---|
| Install | manual: Share → Add to Home Screen; no install prompt API | `beforeinstallprompt`, install banner | in-app "install" coach mark on iOS; native prompt on Android |
| Service worker / offline | yes | yes | precache shell + glyph content; duel vs bot works offline |
| Storage | IndexedDB/OPFS; installed apps are not subject to the 7-day eviction that browser tabs are | IndexedDB/OPFS, persistent storage request | keep grimoire/replays client-side, sync to server when online |
| Web Push | yes (16.4+), installed apps only | yes | "your opponent moved" notifications for async duels |
| Geolocation | foreground only, permission prompt | foreground only (background geo effectively unavailable) | geo play is **check-in based**: open the app at the place; no passive tracking |
| WebGL2 / WebGPU | WebGL2 yes; WebGPU from Safari 26 | WebGL2 yes; WebGPU yes | Three.js on WebGL2 baseline, WebGPU renderer opt-in |
| Backgrounding | page suspended immediately when backgrounded | suspended within seconds | duel rooms must tolerate disconnect/reconnect; server owns timers |
| Vibration / haptics | no | yes | haptics are decoration, never a signal |
| Fullscreen API | not on iPhone | yes | design for standalone display mode + `viewport-fit=cover` safe areas |
| App stores | not required | not required | optional later: TWA (Android) and a thin Capacitor wrapper (iOS) around the **same** web build if store presence is wanted; never a separate native codebase |

Rules that follow:

- Portrait-first, one-hand reachable composer; tap targets ≥ 44 px.
- No gameplay feature may depend on an API missing on either platform. Where a capability differs (install, push, haptics) the fallback is UX, not rules.
- Test matrix: iPhone (Safari, installed), Android (Chrome, installed), desktop Chrome. Playwright WebKit + Chromium projects with device emulation in CI; real-device pass before each playtest round.

---

## 4. Multiplayer **[v2: Durable Objects first, Colyseus as fallback]**

A duel maps naturally to one authoritative room:

```text
Matchmaker (Worker)
   │
   ▼
WyrdDuelRoom (Durable Object)
   ├── Player A (WebSocket)
   ├── Player B (WebSocket)
   ├── DuelState
   ├── WyrdResolver (same package as the client)
   ├── timers (alarms)
   └── event log (DO storage → D1 on match end)
```

Why Durable Objects rather than Colyseus now: the worker, database and CI already live on Cloudflare; a DO gives one instance per match with strongly consistent state, WebSocket hibernation (cheap while players think), alarms for reaction deadlines, and no second host to operate. The resolver package is bundled into the DO exactly as it is into `wyrd-api` today. Colyseus remains the fallback if DO limits bite (very large rooms, spectator fan-out).

The client sends **intent**, not outcomes:

```json
{ "type": "CastIntent", "spell": ["FIRE", "SEEK", "ENEMY", "AMPLIFY"], "clientSequence": 184 }
```

The room: parse → validate → check Focus → resolve reactions → apply wards → calculate effect → update state → award seal → broadcast events (`SpellCommitted`, `ReactionRevealed`, `ReflectApplied`, `WardBroken`, `SealAwarded`).

Mobile-specific: reconnect with the last acknowledged sequence; server-side grace on reaction timers when a socket drops mid-window; async (turn-based) duel mode uses the same room with alarms measured in hours and Web Push for "your move".

---

## 5. Never synchronize visual state

Unchanged. The server emits semantic events (`SpellResolved effect=FIRE_SEEK target=enemy magnitude=2 result=reflected`); each client renders them. The web client, the replay viewer and the admin timeline are all consumers of the same events.

---

## 6. Geo architecture

Unchanged model: city → H3 region → cells → manifestation / puzzle / reward. Ask "what cell is the player in and what manifests there this week", never "is the player at lat/long".

**[v2: storage]** H3 turns spatial questions into key lookups, so D1 (SQLite) with cell-id columns is sufficient for the first cities. PostGIS is deferred until polygon/nearest-neighbour queries are genuinely needed; if that day comes, reach it via Hyperdrive to a managed Postgres rather than moving the whole backend.

---

## 7. Geo POC should fake location first

Unchanged. `ILocationProvider` → `SimulatedLocationProvider` (dev controls: city, cell, move, teleport) → `BrowserLocationProvider` (Geolocation API, foreground, accuracy-gated). The Unity provider is dropped.

---

## 8. Production client: the PWA **[v2: replaces "Unity 6 + URP"]**

The browser client grows into the production client. Layering:

```text
PWA (apps/web)
│
├── Presentation
│   ├── Duel board (composer, telegraph, reactions, combat log)
│   ├── Encounter scene (React Three Fiber + Three.js, later)
│   ├── Spell VFX (shader + particle vocabulary, later)
│   ├── Map (MapLibre GL JS, later)
│   └── Grimoire / inventory / match history
│
├── Client game state
│   ├── replicated match state (events → reducer)
│   ├── optimistic composer preview (local resolver, never authoritative)
│   └── replay player
│
├── Network
│   ├── fetch → wyrd-api (REST)
│   └── WebSocket → duel room (Durable Object)
│
├── Geo
│   ├── ILocationProvider
│   └── H3 (h3-js)
│
└── Content
    └── versioned content bundles (JSON now; GLB/KTX2 packs later) via Cache API + R2
```

Why not Unity: a second codebase would duplicate presentation, split QA across app-store review cycles, and contradict the phone-first "share a link, play in 10 seconds" acquisition loop. Three.js on WebGL2 is ample for two animated mages, one environment and a small VFX set on current phones. Revisit only if a proven core loop demands rendering the web cannot deliver.

---

## 9. 3D encounter scene: Three.js **[v2: scope unchanged, no Unity path]**

```text
React → React Three Fiber → Three.js → WebGL2 (WebGPU opt-in)
```

Keep the first 3D scope small: two animated characters, idle + cast animations, ward / reflect / hit effects, one environment, a small spell VFX set. No explorable world. Mobile budget per scene: ≤ 100 draw calls, ≤ 30 MB textures (KTX2), 60 fps target on a three-year-old phone; degrade to 2D board if WebGL is unavailable.

---

## 10. Do not build a continuous open world

Unchanged: real-world map → manifestation → encounter scene → puzzle / duel / discovery. A handful of reusable encounter environments give a large-world feeling without modeling cities.

---

## 11. Character and 3D content pipeline **[v2: web pipeline only]**

```text
Blender (models, rigs)  →  glTF / GLB
Mixamo (prototype anim) → retarget in Blender → glTF animations
Substance or equivalent → KTX2 (Basis Universal) textures
gltf-transform           → Draco / meshopt compression, texture resize
→ content pack (versioned folder in R2, manifest JSON)
```

Camera: `@react-three/drei` camera controls / a small cinematic rig. VFX: custom shaders (GLSL / TSL), instanced particles, post-processing via `postprocessing`. The visual language still mirrors the grammar (FIRE → color/particle family, SEEK → trajectory, BIND → chains, WARD → geometric shield, AMPLIFY → doubled rune rings, REFLECT → reversed trajectory, NULL → rune collapse, ANCHOR → fixed sigil).

---

## 12. Asset and content delivery **[v2: replaces Addressables]**

Base install (precached by the service worker): shell, glyph registry, 2D board assets. Downloadable packs (fetched on demand, cached with Cache API, versioned by content hash): encounter environments, characters, city packs, seasonal VFX, cosmetics. Packs live in Cloudflare R2 behind the Pages/Workers origin; a `content-manifest.json` maps `contentVersion` → pack URLs so a match can always fetch the packs it was played with.

---

## 13. Backend architecture **[v2: Cloudflare modular monolith]**

One Worker (`wyrd-api`) with module boundaries, not microservices:

```text
apps/api
├── auth          anonymous sessions → optional sign-in later
├── players       profile, grimoire, discoveries
├── matchmaking   queue in DO/KV, hands off to a duel room
├── duel          Durable Object room + match persistence
├── geo           H3 cell state, manifestations, check-ins
├── progression   seasons, rewards, cosmetics
├── content       versioned content manifests
└── telemetry     structured match events
```

Infrastructure: D1 (durable data), Durable Objects (live matches, matchmaking), KV / Cache (content manifests), R2 (packs, replays), Queues (telemetry fan-out) when needed. Supabase/Postgres is no longer the assumed persistence layer; D1 is, with Hyperdrive→Postgres as the escape hatch (§6).

---

## 14. Persistent data model

Entities unchanged: Player, PlayerGlyph, PlayerDiscovery, Match, MatchEvent, GeoManifestation, GeoCell, Puzzle, Reward, Season, ContentVersion. All in D1 with integer epoch-ms timestamps and UUID text keys (repo rule). `duel_log` (exists) is the seed of `MatchEvent`.

---

## 15. Authoritative PvP

Unchanged. Server owns seed, timers, Focus, spell legality, hidden information, reactions, outcomes, rewards. Client owns animations, camera, sound, particles, UI transitions. Never trust the client for inventory, location rewards, match results, spell validity, Focus balance or loot.

---

## 16. Multiplayer technology options **[v2: re-ranked]**

| Technology | Best use here | Assessment |
|---|---|---|
| Cloudflare Durable Objects | duel rooms + matchmaking on the existing platform | **Best fit now** |
| Colyseus | rooms on a separate Node host | fallback if DO constraints bite |
| Nakama | broader social/game backend | later, if social features dominate |
| PlayFab | managed LiveOps | only at much larger scale |
| Custom WebSockets on a VM | maximum control | too much work |

---

## 17. Preferred long-term shape **[v2]**

```text
┌────────────────────────────┐
│ PWA (iOS / Android / web)  │  ← one client codebase
│ + admin/replay routes      │
└─────────────┬──────────────┘
              │ REST + WebSocket
┌─────────────▼──────────────┐
│ wyrd-api Worker            │
│ + Durable Object rooms     │
│ + Wyrd game kernel (TS)    │
└─────────────┬──────────────┘
              │
        D1 · R2 · KV
```

TypeScript is the authoritative brain, on client and server alike. Optional thin store wrappers (TWA / Capacitor) may later package the same PWA if distribution requires it.

---

## 18. Replays

Unchanged: store domain events (`MatchStarted(seed)`, `PlayerJoined`, `SpellCommitted`, `ReactionCommitted`, `SpellResolved`, `WardCreated`, `WardBroken`, `SealAwarded`, `MatchEnded`), replay by re-running them through the same resolver. Replays are shareable URLs in the PWA.

---

## 19. Testing architecture

- Golden interaction tests (exist: `test/*.test.mjs`).
- Worker tests in the workers vitest pool (exist).
- Property tests with `fast-check`: parsing deterministic, Focus never negative, seals never decrease, NULL cannot later apply the base effect, same seed same outcome, REFLECT keeps essence, REVERSE needs a valid inverse.
- Simulation batches (10k–100k bot duels) for dominant counters, useless glyphs, stalemates, Focus imbalance.
- **[v2]** UX tests: Playwright with `webkit` (iPhone emulation) and `chromium` (Pixel emulation) projects against the Pages preview URL on every PR; PWA install/offline smoke (service worker registered, shell loads offline); real devices before each playtest. Unity Test Framework is dropped.

---

## 20. Observability

POC: structured console logs → Workers Logs (enabled), `/api/version` tiers in the footer, Sentry browser SDK when playtests start. Production: Workers Logs + Sentry + structured match logs. Each match records `matchId`, `playerIds`, `rulesVersion`, `contentVersion`, `seed`, `serverVersion`.

---

## 21. Version the rules

Unchanged: `resolve(rulesVersion, initialState, intents, seed)`. Tier versions already exist (grammar/content/resolver/web/worker/schema); `rulesVersion` becomes the resolver package version recorded on every match.

---

## 22. Geo privacy and anti-cheat

Unchanged, with the PWA reality made explicit: location is read only in the foreground at check-in, quantized to an H3 cell on the device, validated server-side (accuracy, impossible travel, cooldowns). Persist cell id + event + timestamp, never raw tracks.

---

## 23. Content should be data-driven

Unchanged: glyphs, puzzles, encounters, loot, manifestations, seasons are content. JSON in Git now (`packages/wyrd-content`), versioned content bundles in R2 later.

---

## 24. Recommended architecture path **[v2]**

1. Keep the current web POC and TypeScript resolver; ship it as an installable PWA (manifest, service worker, iOS meta tags — mostly done).
2. After initial playtests, convert only the presentation layer to React + Vite if UI complexity warrants it. Grammar and resolver unchanged.
3. Add a Durable Object duel room and make duels server-authoritative; keep bot/hot-seat duels fully client-side and offline.
4. Add a small React Three Fiber encounter scene with a strict mobile budget. No open world.
5. Add MapLibre + H3 + simulated location; enable device geolocation only after the geo loop is proven.
6. Grow D1 into the persistent world model; reach for Postgres/PostGIS only when D1 + H3 cannot answer a query.
7. Deliver 3D and city content as versioned packs from R2 through the Cache API.
8. If store presence is ever needed, wrap the same PWA (TWA / Capacitor). Never fork a native client.
9. Preserve the TypeScript kernel, versioned rules and event/replay architecture as the permanent source of truth.

---

## 25. Conclusion

v1 avoided choosing between "web game" and "Unity game". v2 chooses: **web**. The project evolves as

```text
browser POC → authoritative TypeScript kernel → server-authoritative PvP on Cloudflare → geo systems → richer PWA presentation
```

with one client codebase running on iPhone, Android and desktop. Presentation and infrastructure evolve around a stable rules system that is already deployed in both the client and the worker.
