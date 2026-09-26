# Wyrd — making the duel look and feel exciting: UX and graphics ideas

Status: proposal, 2026-09-26. Companion to `docs/duel-engagement-options.md` (rules) — this document is about presentation and interaction only; nothing here changes what a spell does. Visual mockups of every idea: see the "Wyrd Stagecraft" artifact linked from `handoff.md`.

## 0. Where we start

The stage today (`apps/web/src/stage.ts`): two stick mages, a gate, hexagon wards, one bolt with an essence trail, a caption line, eight synthesised cues. The telegraph is a text line (`FIRE → SEEK → ?`). Seals are digits. Focus is a fraction (`3 / 7`). The tray is a grid of labelled buttons, now with a green ring on glyphs that complete a spell and dimming on glyphs that cannot follow.

What the reference games teach, in one line each (sources in §4):

- **Slay the Spire** — an iconic *intent* above the enemy (attack + number, block, buff) is the whole telegraph; hiding it is a real cost players argue about.
- **Marvel Snap** — who resolves first is a visible, glowing fact; six turns; raising the stakes is the player's own choice.
- **Hearthstone** — physicality: taunt has a different shape, weapons clank, you watch the opponent's cursor hover. The board feels inhabited during the wait.
- **Legends of Runeterra** — "your opponent is doing X, respond?" framed as a stack you can see.
- **Inscryption** — score is a literal balance scale that tips; danger swings both ways.
- **Clash Royale** — the resource bar glows when full, cards show affordability, the last seconds blink the screen edge rather than a digit.
- **Hearthstone Battlegrounds / Wizard101** (negative cases) — combat as cards slamming is hard to read; long spell animations lose their charm by the third viewing. Keep beats short, make the rare ones long.
- **Vlambeer, Jonasson & Purho, Eiserloh, Sakurai** — hit-stop, flash, kick, screen shake driven by one decaying "trauma" scalar, permanence (marks left on the world), bass on impact.
- **Magicka, Noita, Arx Fatalis, Baba Is You** — composing from primitives is the fun; show incompatibles greying out live, show the sentence "lighting up" when it parses, name the discovered combos.

## 1. Ideas

Costs for the current zero-dependency shell: **S** a day, **M** a few days, **L** a week+. Every idea keeps `prefers-reduced-motion` and the Animations switch honoured.

### A. Telegraph as intent cards (S–M)
Replace the text line with a strip of rune cards: essence cards carry their colour and a flame/drop/smoke/leaf mark, action cards a silhouette (SEEK an arrow, BIND chains, WARD a hexagon, OPEN/CLOSE a door, BREAK a crack, MEND a stitched crack), hidden slots are face-down cards with the family's edge colour when the medium preset reveals a family. Progressive reveal (already shipped) becomes a card flip. Scry is a hand lifting a card's corner. Lesson from Slay the Spire: the intent must be readable in under a second from arm's length.

### B. Commit ritual and priority glow (M)
Casting is a two-step ritual: the strip slides face-down into a seal slot with a wax-seal stamp (commit), then both seals crack and the spells reveal in resolution order. The mage who resolves first carries a gold rim for the round (Marvel Snap's priority glow), so "why did their SEEK land before my WARD" is visible before it happens. The reaction row becomes a response stack: the incoming spell card on top, your reaction card slid underneath it.

### C. The gate as the scoreboard (M)
Seals stop being digits. The gate has a chain on each side; each seal a mage takes pulls the gate one notch toward them and lights a rune on their chain. At three notches the gate swings open to their side — the win is spatial. A shattered gate hangs off one hinge; MEND rehangs it. Inscryption's balance and KARDS' frontline: ownership of the contested thing must be unmistakable.

### D. Hit juice, one dial (S)
One `trauma` scalar (0–1) on the stage group, decaying linearly; shake amplitude is trauma², translational plus a little rotation. A plain hit adds 0.3, an amplified or split hit 0.5, a shattered ward 0.6, a seal 0.4. On impact: 80 ms hit-stop (every animation paused), a one-frame flash on the struck mage, a kick away from the bolt, and a permanent scorch or frost mark on the floor under the target for the rest of the match (Vlambeer's permanence: the arena remembers the duel). Bass layer under the hit cue. Reduced motion: flash and mark only.

### E. Focus as a meter, affordability on the glyphs (S)
The `3 / 7` fraction becomes a glowing bar that drains from the left as you compose and from the right for the chosen reaction; full-bar shimmer at 7. Each tray glyph shows its cost as small pips; glyphs the remaining Focus cannot pay dim (already true through the compatibility map — make the reason visible). Under timers the last three seconds pulse the card edge amber and add a rising tone; the digit shrinks (Clash Royale, Danganronpa).

### F. Mages with presence (M)
Two silhouettes with idle breathing and an aura in the essence of their last cast (ignite becomes visible: two FIRE casts, the aura burns brighter). While the opponent "thinks" (bot delay, or hot-seat hand-off), a ghost hand hovers over its tray so the wait is inhabited (Hearthstone's cursor). Bound: chains. Faltering: hunched pose. Exposed: a torn sleeve — the telegraph leak has a body.

### G. The spell as a lit sentence (S)
The strip lights up glyph by glyph as the parse completes (Baba Is You's rule blocks): glyphs snap together with a click and a thin rune line connects them; an unparsable strip leaves the offending glyph dark, and the diagnostic (now naming the glyph) sits directly under it. AMPLIFY, WEAKEN, SPLIT, REVERSE, ANCHOR draw as marks *on* the action card (a doubled stroke, a thinned stroke, a fork, a mirror, a nail), so a spell reads as one shape. Modifier order (DELAY last) becomes a visual rule, not a message.

### H. Named combos and a grimoire (M)
The first time a spell shape resolves for a player — a REVERSEd gate, a SPLIT through a ward, BREAK then SEEK — the stage gives it a one-off flourish and a name ("Turncoat", "Twin Lance", "Breach"), and the grimoire (one page, tap-to-open, from `glyphHelp`) records it with the resolver's own explanation. Discovery, not collection (Magicka combos, Arx Fatalis runes as muscle memory). Shareable as `?seed=` plus the round.

### I. Short beats, long crits (S)
Cap every beat at ~500 ms and the round at ~4 s; tap-to-skip stays. Spend the long version (slow bolt, hit-stop, orbit of the seal to the chain) only on match point and on a seal-winning hit. Wizard101's forums are the warning: the same long animation, every round, kills the appreciation.

### J. Press the round (M, rules-adjacent)
An opt-in stake: before committing, either mage may "press" — this round's seal counts double for whoever wins it; the other may retreat (concede one seal, no double). Marvel Snap's snap/retreat, sized to a 3-seal race. This one touches rules; propose it as a ruleset flag, not a default.

## 2. Suggested order

1. **D + I + E** (a week): juice, pacing and the Focus meter. Cheapest, and every round benefits.
2. **A + G** (a week): telegraph cards and the lit sentence. The two surfaces players stare at while deciding.
3. **C + F** (two weeks): the gate scoreboard and mages with presence. The stage becomes the game's face.
4. **B, H** afterwards; **J** only with a playtest question attached.

Telemetry to watch: decision time per round (should fall with A and G), rematch rate (D, C), seals-by-round shape (I should not change it — it is presentation).

## 3. A round, storyboarded

Round 3, Teeth rules. Telegraph strip shows a FIRE card, a SEEK arrow card, one face-down card with a hidden target. Your Focus bar sits at 7, glowing. You tap SHADOW, WARD, SELF: the strip lights up glyph by glyph, the WARD hexagon card grows a smoke-grey rim, the bar drains to 4. You slide REFLECT under the incoming card (bar drains from the right to 2). Both wax seals crack. The opponent's bolt leaves as a fire streak, meets your reflect: hit-stop, a mirror flash, the bolt reverses, strikes the opponent's mage — screen kicks, a scorch mark stays on their floor — and a seal orb arcs to your chain, pulling the gate one notch. Caption: "REFLECT redirected the spell back toward its caster." Your own WARD rises as a hexagon. Round over in four seconds; the log has the full story if you want it.

## 4. Sources

Fetched 2026-09-26 by a research pass; Reddit and BoardGameGeek were unreachable, so community insights come from forums, devlogs and Hacker News.

- Slay the Spire intents — https://slaythespire.wiki.gg/wiki/Intent
- Marvel Snap priority and reveal order — https://www.cbr.com/marvel-snap-who-reveals-first-explained/ ; deconstruction — https://www.deconstructoroffun.com/blog/2023/5/23/marvel-snap-the-definitive-deconstruction ; critique — https://game-wisdom.com/analysis/marvel-snap
- Hearthstone UI physicality — https://inanage.com/2013/08/29/hearthstones-ui/
- Legends of Runeterra action/response — https://terrancraft.com/2021/01/11/why-i-like-legends-of-runeterra/
- Inscryption's scale — https://parryeverything.com/2022/01/07/let-the-player-break-the-game-already-inscryption-isaac-and-others/
- Clash Royale UX (elixir, timer) — https://gornicki.me/blog/Bd87/ux-in-clash-royale-part-3
- Hearthstone Battlegrounds combat readability — https://cjleo.com/blog/hearthstone-battlegrounds-a-card-based-auto-battler-experiment-in-game-design/
- Wizard101 long animations thread — https://www.wizard101.com/forum/the-dorms/long-boring-spell-animations-the-fix-8ad6a4185124450a015136f53ec15d00
- KARDS frontline — https://techraptor.net/gaming/reviews/kards-wwii-card-game-review
- Vlambeer, "The Art of Screenshake" — https://www.youtube.com/watch?v=AJdEqssNZ-U
- Jonasson & Purho, "Juice it or lose it" — https://www.gdcvault.com/play/1016487/juice-it-or-lose
- Folmer Kelly, "Don't Juice It or Lose It" — https://www.gamedeveloper.com/design/video-indies-resist-the-urge-to-juice-it-or-lose-it-
- Eiserloh, "Juicing Your Cameras With Math" — https://www.youtube.com/watch?v=tu-Qe66AvtY
- Sakurai on hitstop — https://sourcegaming.info/2015/11/11/thoughts-on-hitstop-sakurais-famitsu-column-vol-490-1/
- Swink, *Game Feel* (review) — https://lizengland.com/blog/review-game-feel-by-steve-swink/
- Psychology of screen shake — https://verbotengames.wordpress.com/2014/06/21/the-psychology-of-screen-shake/
- Shake toggles requested (Cult of the Lamb) — https://steamcommunity.com/app/1313140/discussions/0/3319737272513211796
- Simultaneous action selection — https://en.wikipedia.org/wiki/Simultaneous_action_selection
- Lobanov, "Designing hidden information" — https://greglobanov.substack.com/p/designing-hidden-information
- Talk Paper Scissors — https://eieio.substack.com/p/talk-paper-scissors
- Timers in game design — https://www.gamedeveloper.com/design/time-for-a-timer---effective-use-of-timers-in-game-design
- Magicka: Wizard Wars combos — https://hardcoregamer.com/previews/mix-elements-and-cast-spells-in-magicka-wizard-wars/59639/
- Noita wand editor — https://playwanderer.online/game-reviews/noita
- Arx Fatalis rune magic — https://taverncellar.com/unlocking-the-secrets-of-arx-fatalis-spells-rune-magic-and-combat/
- Baba Is You rule writing — https://www.gamedeveloper.com/design/designing-i-baba-is-you-i-s-delightfully-innovative-rule-writing-system
- Ōkami Celestial Brush — https://sourcegaming.info/2017/08/28/holism-the-celestial-brush-of-okami/
- Fictorum (depth nobody used) — https://voxelvoice.com/fictorum-review/
- HN on juice — https://news.ycombinator.com/item?id=29963267
- Volley Brawl devlog (two-phase loop) — https://sixgamesinatrenchcoat.itch.io/volley-brawl/devlog/932798/less-is-always-more-reducing-the-gameloop
- Crank the Dead devlog (hit flash + freeze frame) — https://koro-pixel-studio.itch.io/crank-the-dead/devlog/1480037/devlog-1-hit-flash-freeze-frame
