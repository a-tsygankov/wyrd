# Wyrd — 3D assets and phase-by-phase UI options for the duel

Status: proposal, 2026-09-26. Companion to `docs/duel-ux-ideas.md` (presentation ideas) and `docs/architecture.md` §9 (the 3D encounter scene: Three.js on WebGL2, React Three Fiber later, two animated characters, one environment, a small VFX set, ≤ 100 draw calls, degrade to the 2D stage when WebGL is unavailable). Mockups: the "Wyrd Arena" artifact linked from `handoff.md`. Asset sources in §4 were fetched and their licences read on 2026-09-26; re-check before shipping anything.

## 1. What the scene has to show

Everything the 2D stage already replays from resolver steps (`apps/web/src/stage.ts`), so the 3D scene is a second renderer of the same beats, never a second set of rules:

| Beat (stage.ts) | What happens | 3D need |
|---|---|---|
| cast | a mage raises a hand; the spell name shows | cast animation, hand glow in the essence colour |
| fly | a bolt crosses the arena, sized by magnitude, coloured by essence | bolt mesh or sprite, trail, point light |
| reflect | the bolt turns back at the defender | mirror flash, reversed trail |
| silence | the bolt dims | shader dim, falling rune particles |
| null | the bolt collapses before landing | implosion sprite |
| ward-up / ward-block / ward-break | a hexagon shield rises, flares, or shatters on a mage | shield mesh (hex prism), fresnel shader, fracture pieces |
| gate-ward-up / block / break | the same on the gate, in the owner's colour | same shield mesh, larger, tinted |
| bind | chains wrap the target | chain mesh loop, wrap animation |
| gate-close / open / break / mend | the gate slab drops, lifts, fractures, reassembles | arch model with slab, pre-fractured slab |
| hit | flash, kick, scorch mark, hit-stop | impact sprite, decal, camera trauma (already a dial) |
| seal | an orb arcs from the gate to the scorer | orb mesh, trail, chain notch light |
| fizzle | the caster dims | shrug animation |
| split / reverse | two bolts; the caster's rune ring flips | bolt duplicate, ring mesh rotation |
| stagger, delay | reserved for PUSH/PULL and DELAY | stagger animation, held glyph |

Five opponent personalities need five readable silhouettes (hat, cloak, staff, mask, gauntlet), not five different rigs.

## 2. Movement vocabulary

One rig, one animation set, shared by both mages; personality is colour and props. Clips needed (names from Mixamo / Quaternius libraries where they exist):

| Moment | Clip | Length | Notes |
|---|---|---|---|
| idle | breathing idle | loop | plus a hand-glow when a spell is composed but not cast |
| compose | "thinking" fidget every ~6 s | 1.5 s | only while the opponent's telegraph is being read |
| cast | one-hand push (attack) | 0.6 s | the fly beat starts at the push frame |
| cast amplified | two-hand push | 0.8 s | for magnitude ≥ 2 |
| ward | raise-shield / block | 0.5 s | hold the last frame while the ward stands |
| hit | light hit reaction | 0.4 s | the hit-stop freezes the first frame |
| bound | crouch / struggle idle | loop | while BOUND |
| faltering | tired idle | loop | Resolve ≤ 3 |
| seal | short victory gesture | 1.0 s | decisive: the long variant |
| fizzle | shrug | 0.8 s | |
| win / lose | victory / defeat | 2 s | match end |

Twelve clips; at 30 fps and ~30 bones that is under 1 MB in glTF with quantisation.

## 3. UI options by phase

The round has six phases in solo play (hot-seat adds two hand-offs): **Read** (the telegraph arrives) → **React** (choose a reaction; under timers the window drains) → **Shape** (compose the spell) → **Commit** (cast) → **Resolve** (the replay) → **Verdict** (round result, lesson, next round or match end).

Three layout families; the mockup page shows every phase in family A and the distinguishing phases in B and C.

### A. Arena first (recommended)
Portrait phone. The 3D arena holds the top ~42% of the screen at all times; a bottom sheet swaps its contents per phase. Camera moves are part of the phase change.

| Phase | Arena (camera) | Sheet |
|---|---|---|
| Read | slow push-in on the opponent, who is mid-fidget; the telegraph cards float above their head | telegraph cards (idea A), Scry corner, personality nameplate |
| React | hold on the opponent; the reaction card slides under their spell card | four reaction cards with prices, timer edge glow |
| Shape | swing to over-the-shoulder behind the player; the strip renders as runes in the player's palm | the lit spell sentence (idea G), tray with fits and pips, Focus meter |
| Commit | both mages step to their marks; wax seals; priority rim on the first mover | one wide Cast button; commit ritual (idea B) |
| Resolve | side-on wide shot; the trauma dial shakes the camera, not the UI | caption line only; tap to skip |
| Verdict | pull back to include the gate and both chains | verdict card, reasons, lesson, Next round |

Costs nothing in rules; the sheet is the existing cards re-ordered. Risk: 42% of a 6-inch screen is ~110 mm × 65 mm, so mages must read at that size (thick silhouettes, no thin staffs).

### B. Table (card duel)
The arena is a 3D strip (~25%) between two portrait tiles; the gate meter lives in the strip. Phases change a central dock. Closest to Hearthstone; best when the phone is small or WebGL is off (the strip degrades to the 2D stage with no layout change). Weaker spectacle; strongest information density.

### C. Cinematic
Resolve and Verdict are full-screen 3D with the log as subtitles; Read/React/Shape use a translucent drawer over a paused, defocused arena. Best on tablets and in landscape; on a phone the drawer hides the mages during the decision, which loses the "opponent presence" idea F.

### Cross-cutting
- Reduced motion and "Animations off" keep the 2D stage; the 3D scene is a progressive enhancement behind a Stage setting, and the smoke tests keep running on the 2D path.
- Every 3D beat is timed by `beatDuration` so the two renderers stay in step and the tap-to-skip contract holds.
- Text stays HTML (captions, cards, tray); the canvas draws only mages, gate, effects and floor marks.

## 4. Assets: found and generated

See the "Recommended starter kit" at the end of this section for the eight-item set. Details, licences and URLs follow the research pass (§4.1–4.7).

### 4.1 Mage models (rigged, stylised, low-poly)

| Item | Licence | Formats | Animations | Fit |
|---|---|---|---|---|
| [KayKit Character Pack: Adventurers](https://kaylousberg.itch.io/kaykit-adventurers) | CC0 ("free for personal and commercial use, no attribution required") | FBX, glTF | rigged and animated; takes the KayKit animation library | Free tier has Knight, Barbarian, Rogue, **Mage**, Ranger: five silhouettes, one per personality. **Starting point.** |
| [KayKit Character Pack: Skeletons](https://kaylousberg.itch.io/kaykit-skeletons) | CC0 | FBX, glTF | basic, same rig family | Skeleton Mage (staff, hat, robe) as a SHADOW-flavoured opponent. |
| [Quaternius RPG Character Pack](https://quaternius.com/packs/rpgcharacters.html) | CC0 | FBX, OBJ, Blend, glTF | animated | Six rigged fantasy characters. |
| [Quaternius Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) + [Modular Outfits: Fantasy](https://quaternius.com/packs/modularcharacteroutfitsfantasy.html) | CC0 | FBX, OBJ, glTF | via the Universal Animation Library | Modular: 6 bases, 12 outfits, 62 parts. ~13k tris per base, so decimate for a phone. |
| [Low Poly Wizard (Rigged)](https://sketchfab.com/3d-models/low-poly-wizard-rigged-f8c91af65aec4779b0e3d857b1878cc2) by Yanez Designs | CC-BY | glTF | idle, walk, attack | 1,100 tris; a single wizard whose attack reads as a cast. |
| [Low Poly Mage Rigged Free](https://sketchfab.com/3d-models/low-poly-mage-rigged-free-10771a1d02a145df95824b483515eeb6) by MadTrollStudio | CC-BY (not for resale as an asset) | .blend | rig only | 2,500 tris, palette texture; retarget clips onto it. |
| [Wizard, rigged, low poly](https://sketchfab.com/3d-models/wizard-rigged-low-poly-941fa6337b7347babc46a1f314c533e4) by Myjato | CC-BY | glTF | rigged, no clips | 612 tris; a fallback LOD. |
| [LOWPO Wizard Characters](https://standout7.itch.io/lowpo-wizard) | **unconfirmed** (no licence on the page) | FBX free, GLB paid | none; Mixamo-compatible | Five elemental wizards map to the five personalities, but only after the licence is checked with the author. |
| Kenney [Mini](https://kenney.nl/assets/mini-characters) / [Blocky](https://kenney.nl/assets/blocky-characters) Characters | CC0 | FBX/GLB | animated | Placeholders; no mage. |

### 4.2 Animations

- [KayKit Character Animations](https://kaylousberg.itch.io/kaykit-character-animations) — CC0; 161 humanoid clips including idling, getting hit, death, **magic/spellcasting**, blocking, dodging, cheering; FBX and glTF; the same rig as the Adventurers, so no retargeting. Covers every clip in §2.
- [Quaternius Universal Animation Library 1](https://quaternius.com/packs/universalanimationlibrary.html) and [2](https://quaternius.com/packs/universalanimationlibrary2.html) — CC0; 120+ and 130+ clips (combat, death, emotes), FBX/GLB/Blend; no explicit spellcast; retarget in Blender.
- [Mixamo](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) — free for commercial use, no credit required, raw files may not be redistributed (Adobe's FAQ, read from Adobe's community copy; the first-party page was unreachable). Has one- and two-hand magic attacks. Export FBX, retarget in Blender, export GLB.

### 4.3 Spell effects

- [Kenney Particle Pack](https://kenney.nl/assets/particle-pack) (80 sprites) and [Smoke Particles](https://kenney.nl/assets/smoke-particles) (70) — CC0. Bolts, sparks, dust.
- [Unity Labs free VFX flipbooks](https://unity.com/blog/engine-platform/free-vfx-image-sequences-flipbooks) — CC0; smoke, explosions, fireballs, flames as sheets. FIRE impacts and the gate shatter.
- [Kalponic Free Stylized Sprite VFX](https://kalponic-studio.itch.io/free-stylized-sprite-vfx) — CC-BY 4.0; 15 flipbooks.
- Hex shield: no CC0 texture found; write it as a shader (hex-tiled fresnel on a sphere for a mage, a disc for the gate). [flow-shield-effect](https://github.com/cortiz2894/flow-shield-effect) is a reference only (licence not stated).
- Chains and runes: procedural. BIND as instanced torus links along a spline; rune rings as Noto Sans Runic glyphs drawn to a canvas texture. Avoid magic-circle PNG sites (licences unclear).
- Libraries: [three.quarks](https://github.com/Alchemist0823/three.quarks) (MIT; batched billboard, stretched, trail and mesh particles, JSON import, WYSIWYG editor) or [three-nebula](https://github.com/creativelifeform/three-nebula) (MIT). One quarks system with per-essence colour ramps and three or four flipbooks covers every glyph in §1.

### 4.4 Arena and props

- [KayKit Dungeon Pack Remastered](https://kaylousberg.itch.io/kaykit-dungeon-remastered) — CC0; 200 pieces (doors, floors, stairs, banners), style-matched to the mages.
- [Low Poly Doors](https://loafbrr.itch.io/low-poly-doors) by loafbrr — CC0; 17 doors, 1,340 tris total. Gate leaves.
- [Low Poly fantasy Portal Frame/Gate](https://sketchfab.com/3d-models/low-poly-fantasy-portal-framegate-out-of-stone-fecb75f306e54e22be02f3edca062a43) by EarthCord — CC-BY; 744 tris. The gate arch itself.
- Quaternius [Ultimate Modular Ruins](https://quaternius.com/packs/ultimatemodularruins.html) and [Modular Dungeons](https://quaternius.com/packs/modulardungeon.html) — CC0 (convert from FBX/Blend).
- Kenney [Graveyard](https://kenney.nl/assets/graveyard-kit), [Modular Dungeon](https://kenney.nl/assets/modular-dungeon-kit), [Fantasy Town](https://kenney.nl/assets/fantasy-town-kit) kits — CC0.
- [Poly Haven Modular Fort 01](https://polyhaven.com/a/modular_fort_01) — CC0; includes an arched gate; heavy whole, usable as a piece.
- Textures and light: [ambientCG](https://docs.ambientcg.com/license/) (CC0; paving, granite, marble; HDRIs) and [Poly Haven](https://polyhaven.com) (CC0). Ship one 1K stone set and one 1K night HDRI, or bake the environment to a small map.

### 4.5 Generation tools (free tier and what its output may be used for)

| Tool | Free tier | Free output licence | Verdict |
|---|---|---|---|
| [Meshy](https://www.meshy.ai/pricing) | 100 credits a month; GLB/FBX/OBJ export | CC-BY 4.0; Meshy asks for a credit on a commercial page | Usable in a released game with credit. |
| [Tripo3D](https://www.tripo3d.ai/pricing) | credits and a download cap (third-party) | **unconfirmed** (first-party pages unreachable; third-party sources disagree) | Verify before use. |
| [Rodin / Hyper3D](https://hyper3d.ai/pricing) | generation free, export gated | terms do not limit Rodin output; ChatAvatar free is personal-use only | Usable if the export gate allows. |
| [Sloyd](https://www.sloyd.ai/pricing) | guest GLB/OBJ export | personal-use licence, no redistribution | Not usable free. |
| [Blockade Labs Skybox](https://skybox.blockadelabs.com/plans) | previews only, no download | paid plans carry the commercial licence | Not usable free. |
| Luma Genie | appears discontinued | — | Skip. |
| Mixamo auto-rigger | free | as §4.2 | Fine for rigging a generated mesh. |

### 4.6 Glyph typography and icons

- [Noto Sans Runic](https://github.com/notofonts/runic) — OFL 1.1; the raw material for rune rings.
- [Noto Sans Symbols](https://github.com/notofonts/symbols) — OFL 1.1; the alchemical Fire/Water/Earth/Air glyphs exist in Unicode (U+1F702–U+1F705) but Noto's coverage is unconfirmed; test-render first.
- [Cinzel Decorative](https://github.com/google/fonts/tree/main/ofl/cinzeldecorative), [Uncial Antiqua](https://github.com/google/fonts/tree/main/ofl/uncialantiqua), [Metamorphous](https://github.com/google/fonts/tree/main/ofl/metamorphous) — OFL.
- [game-icons.net](https://game-icons.net/about.html) — CC-BY 3.0; about 4,100 SVGs with fire, water, chain, shield and portal motifs for the glyph symbols. Credit "Icons made by {author}. Available on https://game-icons.net".
- [Kenney Game Icons](https://kenney.nl/assets/game-icons) — CC0; UI-prompt style.

### 4.7 Size guidance for a phone PWA

| Part | Shipped size |
|---|---|
| Two mages, one rig and atlas, 15–20 clips, meshopt | ~1.0–1.5 MB |
| Gate arch, leaves, floor, a few props | ~0.5–1 MB |
| Particle atlas plus 4–6 flipbooks (512² WebP) | ~0.8 MB |
| One 1K stone set as KTX2 and a baked environment | ~0.6 MB |
| Subsetted fonts (Cinzel, Runic) | 40–80 KB |
| three.js plus quarks, gzipped | 200–250 KB |

Pipeline: `gltf-transform optimize --compress meshopt --texture-compress ktx2`, `KTX2Loader` and `MeshoptDecoder` in Three.js; lazy-load the five personality skins; one GLB per rig with all clips, scale tracks stripped.

### Recommended starter kit (all CC0 or CC-BY, licences read)

1. **KayKit Adventurers** (CC0) — the Mage and four other classes for the five personalities.
2. **KayKit Character Animations** (CC0) — idle, spellcast, hit, death, cheer, block on the same rig.
3. **EarthCord Portal Frame** (CC-BY) as the arch plus **loafbrr Low Poly Doors** (CC0) as the leaves.
4. **KayKit Dungeon Pack** (CC0) — floor, pillars, banners, torches.
5. **Kenney Particle Pack and Smoke Particles** (CC0) — bolt, shatter and smoke sprites.
6. **Unity Labs VFX flipbooks** (CC0) — explosion and fireball sheets for FIRE and BREAK.
7. **ambientCG paving 1K and one Poly Haven night HDRI** (CC0) — floor and light.
8. **Noto Sans Runic, Cinzel Decorative, Metamorphous** (OFL) and **game-icons.net** (CC-BY 3.0) — rune rings, spell text, glyph symbols.

Source downloads run to 150–250 MB of packs; the shipped runtime payload is about **3.2–3.5 MB** after meshopt and KTX2, inside the architecture's budget. Attribution is owed only to EarthCord and game-icons.net.

Unreachable during the survey (so unverified): poly.pizza, Tripo3D's own pages, Mixamo's first-party FAQ, Blockade Labs' free-tier page, Kenney Animated Characters 3.


## 5. Generation, where it earns its place

Use generators for what the packs lack: five personality props (hat, mask, gauntlet), a gate arch in the game's style, and rune decals. Generate to a reference, then retopologise or accept the mesh at low poly; always read the free tier's licence for commercial use (some grant it, some reserve it for paid plans; §4.5). Never generate the mages themselves: a consistent rig and animation set matters more than novelty.

## 6. Suggested order of work

1. Two mages from one CC0 rig with the twelve clips above, the gate arch, the hex shield, and a bolt: load in a Three.js sandbox (`apps/web` stays framework-free; the scene mounts into the stage card), one HDRI, ≤ 5 MB.
2. Wire the existing beat timeline to the 3D scene behind a Stage setting; keep the 2D stage as the fallback and the test path.
3. Layout A's bottom sheet: telegraph cards, lit sentence, commit ritual.
4. Personality props and floor decals; camera moves per phase.
5. Only then the VFX polish pass (shaders, fracture, decals).
