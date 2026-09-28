# Wyrd — arcade duel mechanics for the 3D arena

Status: proposal, 2026-09-28; **A Volley shipped the same day as the default game** (Settings → Game), with a Focus refill per clean return, a one-return ward and a smash button; lob/drive and the feint are not in yet. C Quickdraw is next. Word-duel specs pin `?game=word`. Companion to `docs/duel-engagement-options.md` (rules of the word duel) and `docs/duel-3d-assets-and-ui.md` (the arena). This document proposes **arcade modes**: duels a new player understands in one round without reading a glyph, played with one thumb in the Three.js arena, keeping Wyrd's essences, wards, reactions and seals as the vocabulary. Nothing here replaces the word duel; the arena, the bot personalities and the telemetry are shared. Mockups: the "Wyrd Arcade" page https://claude.ai/artifact/4718cuxELHMTcV6srKgZx7 (private to the owner).

## 0. The brief and what the references say

The word duel asks a player to *read* (a telegraph), *reason* (which reaction, which glyphs) and *compose*. That is the product bet, and it is slow to learn. The brief here is the other axis: **arcade, easy to learn, more intuitive than word-based** — a magic ping-pong with limited resources, hit points, element moves and blocking. Six games and one trope carry most of what such a mode needs; each lesson below is used by at least one idea in §1.

| Reference | What it does | Lesson for Wyrd |
|---|---|---|
| **Wand Wars** (Moonradish) | Top-down "magical dodgeball": a sphere bounces around the arena, growing faster and bigger; catch it and aim it back; hexes stun, slow the ball or turn a rival into a chicken | A single shared projectile is the most legible duel object there is. Speed-up per exchange is the tension curve. Side spells modify the *ball*, not the players' stats. |
| **Windjammers / Windjammers 2** | Two buttons: throw (also block and dash) and lob. Curves per character. A charge shot exists only if you stand under a lob; the lob shows a landing reticle | Two inputs are enough for a full duel. A charge must be *visible and earned*, so the opponent can read it coming. Every strong move telegraphs itself. |
| **Lethal League Blaze** | One ball, hits double its speed, and hitlag grows with speed. Inside the hitlag a rock-paper-scissors opens: parry, or grab-and-throw, or hit | The moment *before* the return is where the mind game lives. Give the receiver a choice window that scales with the stakes. |
| **Magicka** | Eight elements; opposites cancel (fire/cold, life/arcane, lightning/water); water + fire = steam, water + cold = ice | An element wheel with cancelling opposites is learnable in one screen; the "combine to something new" layer can wait. |
| **Spellbreak** | Six gauntlets; fireball into a whirlwind makes a blazing tornado, ice + fire = steam, then electrify it; some pairs cancel | Interactions between *what is already on the field* and the new cast are more intuitive than interactions between words. |
| **Harry Potter: Wizards Unite** | Trace a shape to cast; when "Protect yourself" flashes, trace within a short window to Protego and halve the hit. Attack / defend / attack / defend until someone falls | Alternating attack and defend with a timed block is the most learnable duel loop on a phone. Accuracy of a gesture = strength of the spell. |
| **Beam struggles** (Dragon Ball games) | Two beams meet; a tug of war decided by stick spinning or, in Sparking! Zero, by feeding energy from a meter in small or big doses | Beloved fantasy, but mashing kills pace. Make the push a *rhythm* or a *resource*, never a mash. |
| **Nidhogg** | Fencing tug-of-war: kill to gain momentum, run toward your end; three sword heights, blade meets blade at the same height | A duel with a *position* on a line gives comebacks and a climax the score alone cannot. Matching heights is a two-second rule that produces reads. |
| **Divekick** | Two buttons, one attack, one-hit kills; the depth is spacing, timing and mind games | Depth does not need inputs. It needs a decision the opponent can read half a second early. |

Wyrd already has the raw material: four essences (FIRE, WATER, SHADOW, LIFE) with a colour each, wards with integrity, the four reactions (none, NULL, REFLECT, SILENCE), a bolt that arcs from hand to hand, hit and block VFX, seals on the gate, and a bot with five personalities. Every idea below is a re-mapping of that material onto a thumb.

### The element wheel (shared by every idea)

Four essences, one rule a child can say: **water quenches fire, fire burns life, life banishes shadow, shadow drinks water.** Same essence on same essence *kindles* (+1 magnitude). Facing essences that are not neighbours on the wheel (FIRE/SHADOW, WATER/LIFE) are *neutral*. Colour carries it: the bolt, the ward and the thumb button are the same colour, so the read is "blue beats orange", not a word.

```
        FIRE
   drinks ↗   ↘ burns
 SHADOW         LIFE
   banishes ↖  ↙ quenches
        WATER
   (arrow = beats)
```

## 1. Ideas

Cost scale as in the other docs: **S** a day, **M** a few days, **L** a week plus. "Thumb" is the whole input set.

### A. Volley — magic ping-pong (recommended, M)

**Pitch.** One bolt, two mages, the gate as the net. The bolt gets faster every return. Return it with the right colour and it comes back harder for them; miss and it burns a heart.

**A round.** The bolt leaves the opponent's hand in a colour. It arcs over the gate toward you. As it crosses the gate, a *return window* opens (the existing hit-stop, stretched to 400 ms and shrinking as speed rises).

- **Tap** in the window: a clean return at the bolt's current colour (+1 speed step).
- **Swipe** in one of four directions during the window: return with that essence. Beating colour (water on fire): the bolt is *quenched* to speed 1 and turns your colour, you own the volley. Same colour: *kindle*, +1 magnitude (bigger, brighter halo) and +1 speed. Neutral: plain return. Losing colour: the return is weak, half speed, easy to punish.
- **Hold** before it arrives: a ward in your last colour rises for one return. It blocks a beating or neutral bolt outright (costs 2 Focus, dents by magnitude), but a kindled bolt of the *same* colour passes it, so warding is a read, not a shield.
- **Miss** (no input, late, or a losing return that the opponent smashes): lose hearts equal to the bolt's magnitude. The bolt resets to speed 1 in the winner's hand.

**Resources.** 5 hearts each. Focus 7, spent on wards (2) and *smashes* (3: a swipe-and-hold that doubles speed, the Lethal League smash); Focus refills by 1 per clean return, so a player who only defends runs dry and a player who volleys builds a smash. The gate is the net: a bolt that clips the lintel is a *fault*, the server loses the serve, so aiming high (swipe up = lob, slow and high, gives you time) versus low (swipe down = drive, fast and flat, risks the fault) is the second axis, straight from Windjammers.

**Mind game.** The window before a return is the Lethal League moment: the receiver chooses tap (safe), swipe (colour read), hold (ward read) or smash (all in). The sender sees the receiver's hand rise (ward telegraph) or the colour on the receiver's ring change (swipe telegraph, 150 ms early) and can *feint* with a second tap that delays the release, so the ward expires. Reads, not words.

**Bot.** The personalities map directly: the Aggressor smashes early and often, the Warden holds wards and returns beating colours, the Trickster feints and lobs, the Gatekeeper plays the lintel, the Adept plays the wheel straight. Their timing error is the difficulty knob.

**Keeps from Wyrd.** Essence colours and the wheel, wards with integrity, the bolt arc and halo, the hit-stop, hearts instead of Resolve (same number), the gate as the centre object, the personalities. **Drops:** glyphs, targets, modifiers, the reaction card.

**Arena.** The bolt arc, the halo, the sparks, the shockwave and the wards already exist. New: the return window ring (a ring closing on the receiver's hand), the speed meter (the trail lengthens), heart pips on the nameplates, a fault flash on the lintel. Camera: the resolve pose, slowly tightening as speed rises.

**What it teaches for the word duel.** The wheel *is* the essence-versus-ward rule. A player who has quenched a fire bolt with water understands why a WATER ward blocks FIRE SEEK. The ward telegraph teaches reading the opponent before the spell lands.

**Cost.** M: a pure state machine (`volley.ts`: serve, flight, window, return, fault, miss, hearts, Focus) with unit tests, a bot policy, the ring and pips in the arena, a settings entry "Mode: Duel / Volley", telemetry `mode: "volley"`.

### B. Beam clash — rhythm tug of war (M)

**Pitch.** Both mages fire a beam; the beams meet in a knot above the gate. Tap on the beat to push the knot; switch colour to gain the wheel's edge; push the knot into the enemy's ward to burn it, then into the mage to score.

**A round.** A metronome pulses (the sound module's tick, 100 bpm; the ring on the floor breathes with it). Each on-beat tap adds one push; an off-beat tap adds nothing and costs 1 Focus (the rhythm, not the mash, is the skill, which answers the beam-struggle critique). Once per clash each mage may **swipe** to switch essence: holding the beating colour pushes double; the switch is visible (the beam recolours over 300 ms) so the other side can answer with its own switch, which costs 2 Focus. A ward at the mage's end absorbs the knot for its integrity (2), then shatters. Pushing the knot into the mage scores a seal and resets the knot to the middle. First to 3 seals, 90 seconds, sudden death at time.

**Resources.** Focus 7, refilling 1 per seal scored against you (comeback). Ward once per clash.

**Mind game.** Switch early and win the wheel but lose the surprise; switch late and risk the knot arriving first. The Nidhogg momentum: a seal pushes the loser's start position back.

**Keeps.** Essences and the wheel, wards, seals, the gate as the middle. Uses the gate's chains and notches (scoreboard) unchanged.

**Arena.** New: the beams (two tapered cylinders with the veil shader's swirl), the knot (a burst held in place), beat ring on the floor. Camera: cast pose.

**Risk.** Rhythm input on phones has touch latency (60 to 100 ms); the on-beat window must be 150 ms wide or wider and the beat must be visual as well as audible. Least readable of the five from a spectator's seat.

### C. Quickdraw — one gesture, one clash (S)

**Pitch.** Every round both mages draw once, at the same time. Swipe a colour, hold to charge. The wheel and the charge decide who takes the hit.

**A round.** A three-second ring closes. During it you **swipe** an essence (your orb takes the colour) and optionally **hold** to charge (the orb grows: 1, 2, 3 magnitude over the three seconds). **Tap** instead of swiping to raise a ward in your current colour. When the ring closes both orbs fly. Beating colour wins the clash outright; same colour: the bigger charge wins, equal charges cancel; neutral: both land, both take damage. A ward blocks a beating or neutral orb, is dented by the magnitude, and lets a same-colour orb through. Damage = the winner's magnitude in hearts; 5 hearts.

**The telegraph is the orb.** Charging is visible: the opponent watches your orb grow, and a grown orb is a promise you cannot take back. A quick draw (under one second) adds +1 magnitude (the existing quick-cast rule) but has to guess the colour blind. That is the whole tension: draw fast and guess, or watch and answer.

**Resources.** Charging above 1 costs Focus (1 per step); wards cost 2; Focus refills 2 per round. Focus, not hearts, is what the bot reads.

**Keeps.** Everything in the resolver that matters here already exists: essence versus ward, magnitude, quick cast, integrity. Quickdraw is the word duel with the composer replaced by a swipe and the telegraph replaced by the orb.

**Arena.** New: the drawing ring (the timer ring already exists in the SVG stage; put it on the floor), the growing orb in each hand, simultaneous flight (two bolt arcs). Camera: the cast pose.

**Cost.** S. A pure `quickdraw.ts` resolves a clash from two draws; the arena plays it as two `fly` beats and one `hit`, `ward-block` or `null` beat.

### D. Gate tug — push the gate home (M)

**Pitch.** The gate sits on a rail between the mages. Every hit pushes it toward the loser; wards hold it; the wheel decides whose push counts. Push it into the enemy's circle to win.

**A round.** Quickdraw's input (swipe colour, hold to charge, tap to ward), but instead of hearts, the clash moves the gate one step per magnitude of difference. The gate has a **temper**: it takes the colour of the last spell that moved it, and the next push must beat or match that colour to move it again (Spellbreak's "interact with what is on the field"). A ward on the gate (the existing GATE WARD) freezes it for one clash. Seven steps from centre to either circle; a Nidhogg-style comeback because the loser's pushes count double when the gate is within two steps of their circle.

**Keeps.** The gate as the objective, gate wards, essences, the wheel, quick cast. Seals become distance.

**Arena.** The gate group slides on the x axis; the chains become the rail with seven notches (the scoreboard geometry reused); the temper is the veil's colour. Camera: verdict pose, wide.

**Risk.** Two objectives (gate position and hearts) would muddle it, so no hearts here. Fine as a second arcade mode, weak as the first: the gate's temper is one rule too many for round one.

### E. Ward rhythm — protego on a beat (S)

**Pitch.** The opponent throws a volley of coloured bolts on a rhythm; you tap the matching-colour ward in time, swipe to send one back. Attack, defend, attack, defend.

**A round.** The opponent's turn: three to five bolts arc toward you, each a colour, each landing on a beat. For each, **tap** the colour button that beats it (quench) as it lands: a clean block, no damage; a same-colour tap absorbs it into your next throw (kindle, +1). Miss or wrong colour: one heart. Your turn: **swipe** to throw your kindled bolts; the bot blocks by its personality (the Warden nearly always, the Aggressor rarely). Hearts 5, ten exchanges.

**Keeps.** Colours and the wheel, wards, hearts, the alternating turn the word duel already has. This is the Wizards Unite loop with Wyrd's wheel in place of a trace.

**Arena.** Bolts in series (the bolt arc, staggered), four colour pads on the floor around the player's mark, a ward flash per block. Camera: react pose.

**Risk.** Closest to a rhythm game; the least "duel" of the five, but the shortest path to "a new player finishes a round".

## 2. Comparison

| | Learn in | Thumb | Reads and depth | Uses today's resolver | Arena work | Cost |
|---|---|---|---|---|---|---|
| **A Volley** | one volley | tap, swipe ×4, hold | window RPS, colour read, ward feint, lob/drive, smash | wheel, wards, integrity, magnitude | ring, pips, speed trail, fault flash | M |
| **B Beam clash** | one clash | tap on beat, swipe, hold | switch timing, ward timing, momentum | wheel, wards, seals | beams, knot, beat ring | M |
| **C Quickdraw** | one draw | swipe ×4, hold, tap | fast-blind vs slow-read, charge bluff | almost all of it | ring, twin orbs | S |
| **D Gate tug** | two clashes | as C | temper reads, comeback | gate, gate ward, wheel | sliding gate, rail notches | M |
| **E Ward rhythm** | one exchange | tap ×4, swipe | colour recognition, kindle stacking | wheel, wards | pads, bolt series | S |

Every mode keeps: the four essence colours and the wheel, wards that dent and shatter, hearts (5) or seals (3), the bot personalities as timing and tendency knobs, the 3D arena's bolt, halo, shockwave and ward shell, telemetry per round with `mode` tagged.

## 3. Recommendation

1. **Build C Quickdraw first (S).** It is the word duel with the words removed: the same resolver rules, a swipe for the composer and the orb for the telegraph. It proves the wheel and the charge-as-telegraph on real thumbs in a day, and every later mode reuses its input.
2. **Then A Volley (M)** as the flagship arcade mode: the most distinctive, the most watchable, the one that makes the 3D arena earn its keep (the bolt is on screen for the whole match). Quickdraw's swipe and ward become Volley's return and hold.
3. **Keep B, D, E as playtest variants** behind the same Mode setting, in that order of interest: B if players want a climax, D if the gate should matter, E if the youngest testers bounce off A.

Ship each as a Mode in Settings (Duel / Quickdraw / Volley), with the deck off, seals or hearts on the nameplates, and the word duel untouched. Telemetry questions: time to first clean return or clash (under 10 s?), hearts left at the end (blowouts mean the bot's timing is wrong), swipe-versus-tap share (are players using the wheel?), rematch rate versus the word duel.

## 4. Implementation notes

- **Pure first.** `apps/web/src/quickdraw.ts` and `volley.ts` as state machines over plain objects (like `stakes.ts`, `arenaFx.ts`), driven by timestamps the tests supply. The arena and the SVG stage draw states and play beats; input handling stays in `main.ts`.
- **Input.** One pointer handler on the arena: `pointerdown` starts a hold, `pointerup` within 250 ms is a tap, a move over 24 px is a swipe (direction → essence: up FIRE, right WATER, down SHADOW, left LIFE, always shown as coloured chevrons on the floor). Keyboard mirrors for the e2e suite and for desktop.
- **Timing on phones.** Return and draw windows of 400 ms and never under 200 ms; touch latency is 60 to 100 ms on mid-range Android. Windows shrink with speed, never below the floor.
- **Bot.** A timing error drawn from the personality (Adept ±80 ms, Aggressor ±60 ms and smash-happy, Warden ±60 ms and ward-happy, Trickster ±120 ms and feints, Gatekeeper lobs). Seeded, so a `?seed=` still replays.
- **Reuse.** The wheel is a five-line table beside `essenceColor` in `stage.ts`; wards, integrity and magnitude come from the resolver's types; the arena's `fly`, `hit`, `ward-up`, `ward-block` and `seal` beats are the vocabulary the modes play in.

## 5. Sources

Fetched 2026-09-28 by a web research pass.

- Wand Wars — https://store.steampowered.com/app/422110/Wand_Wars/ ; review — https://www.gamespew.com/2016/04/wand-wars-review/
- Windjammers controls and lob — https://wiki.gbl.gg/w/Windjammers/Controls ; https://windjammers.fandom.com/wiki/Lob ; charge shots in Windjammers 2 — https://www.shacknews.com/article/128449/how-to-do-a-charged-shot-windjammers-2
- Lethal League Blaze system (hitlag, parry, speed) — https://mizuumi.wiki/w/Lethal_League_Blaze/System ; https://lethal-league.fandom.com/wiki/Gameplay/Mechanics
- Magicka elements and opposites — https://strategywiki.org/wiki/Magicka/Elements ; https://magicka.fandom.com/wiki/Elements
- Spellbreak combos — https://www.pcgamesn.com/spellbreak/combos ; https://www.thegamer.com/spellbreak-best-combos-ranked/
- Harry Potter: Wizards Unite combat (trace, Protego) — https://www.pocket-lint.com/games/news/148439-harry-potter-wizards-unite-combat-how-to-battle-cast-spells/ ; https://wizardsunite.gamepress.gg/guide/spell-casting-guide-spell-trace-nodes
- Beam struggles: trope and critique — https://tvtropes.org/pmwiki/pmwiki.php/Main/BeamOWar ; https://gamerant.com/dragon-ball-sparking-zero-confusion-beam-impacts-clashes/ ; https://www.kanzenshuu.com/forum/viewtopic.php?t=25669
- Nidhogg tug-of-war fencing — https://en.wikipedia.org/wiki/Nidhogg_(video_game) ; https://medium.com/@ComradeKoch/how-nidhogg-is-like-real-fencing-sort-of-2a99ddfbe19d
- Divekick two-button depth — https://en.wikipedia.org/wiki/Divekick ; https://www.gamespot.com/reviews/divekick-review/1900-6413310/
- Wizard Duel (mobile elemental RPS) — https://play.google.com/store/apps/details?id=com.JuhaniPaaso.WizardDuel
