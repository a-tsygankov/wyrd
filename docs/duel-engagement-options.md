# Wyrd — making the duel more interesting: options and battle examples

Status: decided 2026-09-26 - all four proposals in §6 accepted. Options A, B, C, D (timer + quick cast) and E (ignite) are implemented as the selectable rulesets Classic / Teeth / Pulse / Resolve (Settings in the app, `packages/wyrd-content/src/rulesets.ts`); the Stats panel shows the per-ruleset numbers §5 asks for. F (the stage, SVG/CSS with WebAudio cues) shipped 2026-09-26. Still open: E counter-counter and crests, G progressive reveal and Scry, H weather and sudden death, I personalities, J draft. Originally written as options; Everything is written against the rules the POC resolver actually has today, so every example below could be replayed once the option is built.

## 1. What the duel is right now

- One exchange per round: the opponent's spell is telegraphed, you pick one free reaction (none, NULL, REFLECT, SILENCE) and compose your own spell, both resolve, seals are awarded, next round. First to 3 seals.
- Scoring: SEEK or BIND landing on ENEMY, or CLOSE on the GATE, is one seal. Nothing else scores. Magnitude (AMPLIFY) changes a number in the log and nothing else.
- Defence: a WARD persists across rounds and blocks hostile spells of its essence (or everything, if untyped). REFLECT turns an unanchored hostile spell into your seal. NULL stops anything. SILENCE strips AMPLIFY/ANCHOR but never stops a seal.
- Focus: 7 per round, only a build cap. Reactions cost nothing.
- Presentation: text. A combat log with a verdict and lessons; no stage, no bodies, no sound.

Design principles this must respect (concept doc + agent handoff): inference over memorization; no universal strongest counter; Focus cost rises with complexity, not rarity; cheap precise counters should sometimes beat expensive spells; no stat inflation; the combat log must explain *why*. The handoff explicitly deferred hit points ("seals make it easier to test whether the interactions themselves are interesting") — so any HP option must earn its place as an *additional* pressure, not a replacement for reading the spell.

## 2. Why it can feel flat

| Symptom | Cause in the rules |
|---|---|
| Every round feels the same | One exchange, symmetrical, no carry-over except wards and seals |
| AMPLIFY is a bluff and nothing else | Magnitude has no effect on outcome |
| SILENCE is never the right answer | It cannot prevent a seal; it only edits modifiers |
| Reactions are free, so NULL is default-safe | No cost to hard-countering |
| No tempo | No clock, no reward for speed, no punishment for hesitation |
| No spectacle | The result is a list; the seal is a number changing |
| Winning is abrupt | 3 seals arrive without a climax; no comeback mechanic |

Each option below attacks one or more rows. Costs are rough for the current zero-dependency shell: **S** = a day (resolver rule + tests + a few lines of UI), **M** = a few days (new UI surface), **L** = a week+ (new rendering layer).

## 3. Option families

### A. Make magnitude matter without hit points — Ward integrity (S)

Wards get **integrity 2**. A hostile spell of the matching essence that hits a ward is still blocked, but subtracts its magnitude from integrity; at 0 the ward shatters (`WARD_BROKEN`) and the *next* matching spell gets through. AMPLIFY (magnitude 2) therefore breaks a fresh ward in one hit; a plain spell needs two rounds. SILENCE now has a job: stripping AMPLIFY saves your ward for a round.

- Tests: "AMPLIFY vs fresh ward breaks it, plain SEEK only dents it, SILENCE on AMPLIFY leaves integrity 1". New log codes `WARD_DENTED`, `WARD_BROKEN`.
- Principle check: no stat inflation (integrity is fixed), makes SILENCE and AMPLIFY real choices, keeps seals as the only score.
- Telemetry to watch: SILENCE usage should rise from ~0; AMPLIFY should appear in spells that were not bluffs.

### B. Reactions cost Focus — the "exposed" state (S)

Reactions get Focus prices paid from the *same* 7-Focus budget you compose with: **SILENCE 1, REFLECT 2, NULL 3**. Committing a 5-Focus spell leaves 2: no NULL for you this round. A player who ends a round at 0 Focus is **exposed** next round: their telegraph reveals one more glyph. Focus refills to 7 every round, so there is no death spiral, just a per-round trade-off between hitting hard and staying able to answer.

- This is the cheapest way to introduce "pressure" without hit points, and it fixes "NULL is default-safe".
- Tests: budget enforcement, exposed flag toggling, telegraph reveal count.
- UI: the Focus pill becomes a shared bar: composing eats it from the left, the chosen reaction from the right; the CAST button shows the remaining margin.

### C. Hit points as a second clock — "Resolve" (M)

If the team wants a genuine life bar: each mage has **Resolve 10**. A SEEK that lands deals its magnitude (1, or 2 amplified) to the target's Resolve; BIND deals 0 but the bound player's *next* spell costs +2 Focus; CLOSE GATE deals nothing (it is the objective). Seals stay as they are. **Two ways to win**: 3 seals, or the opponent at 0 Resolve. At Resolve ≤ 3 a player is "faltering": their wards have integrity 1 and their telegraph reveals one more glyph — the comeback pressure that makes a 2-seal deficit still playable, and the drama at the end.

- Keep magnitude small (1–2) so a duel is still decided in 4–7 rounds; Resolve should end perhaps one match in four, seals the rest. Tune with telemetry (`match_end` gains a `reason` field: seals | resolve).
- Principle risk: the concept doc's worry is stat *inflation* across matches, not a per-match resource. Resolve resets every match, so it does not violate "no permanent power". It does dilute "seals test the interactions", so ship it behind a match option (`?rules=resolve`) and compare rematch rate and decision time against seals-only.
- Presentation: two thin bars under the scoreboard, emptying in chunks with a shake. This is the option that most wants graphics (§F).

### D. Tempo — the shrinking reaction window and quick casts (M)

Arcade pacing without changing what a spell does:

- **Reaction window**: once the telegraph appears, a ring drains over 8 s. No reaction chosen when it empties = "no reaction". The bot already decides instantly; humans in hot-seat get the same ring.
- **Quick cast**: commit your own spell under 5 s and it gains **+1 magnitude** (relevant with A or C) and your telegraph next round hides one more glyph — reward for reading fast, cost for the opponent's inference.
- **Overthink**: past 20 s the CAST button starts to cost +1 Focus per 5 s. Gentle, visible, never blocks.
- Accessibility: a settings toggle for "no timers" (also the default for the scenario deck's first 3 rounds).
- Telemetry already records time-to-commit; this makes the metric a mechanic.

### E. Combos and chains (S–M)

- **Ignite**: casting the same essence two rounds running gives the second spell +1 magnitude ("FIRE remembers"). Cheap to detect (last spell in state), shows up in the telegraph as a glow, so the opponent can plan a ward.
- **Counter-counter**: if your REFLECT succeeds, next round your reaction costs 0 (with B) — winning the read snowballs one step, then stops.
- **Chain**: a spell that scores while the opponent's spell was canceled/blocked in the same round is a "clean seal": worth a **crest** (cosmetic count on the scoreboard, feeds the match verdict: "2 clean seals"). No power, pure brag.

### F. Spectacle — a stage in CSS/SVG before any 3D (M → L)

The architecture doc keeps 3D for later, but a 2D stage is a few hundred lines and turns the log into a fight:

- Two mage silhouettes (SVG, 60 lines each) facing each other above the composer; idle sway animation.
- Essence trails: FIRE an orange arc, SHADOW a purple smear, untyped a white pulse; SEEK is a projectile, BIND a lattice snapping onto the target, WARD a hexagon shield that cracks with integrity (A) and shatters, CLOSE GATE a door slamming between them.
- Reactions as beats: REFLECT flips the projectile mid-flight, SILENCE dims the modifiers' glow, NULL collapses the spell into a rune that crumbles.
- Impact: screen shake on a seal, seal orbs filling on the scoreboard, a slow-motion beat on the winning seal, `prefers-reduced-motion` respected.
- Sound: 8 short synthesised cues via WebAudio (no assets to download; works offline), muted until the first tap (iOS rule).
- The combat log stays, collapsed under the stage, since the *why* must remain readable.

This does not change a single rule and is the biggest "feel" change available. Estimated L if done fully, M for stage + trails + shake without shatter/slow-mo.

### G. Telegraph as the arcade minigame (M)

- **Progressive reveal**: hidden glyphs flip face-up one by one over the reaction window (D). Reacting early means reacting with less information; waiting is safer but risks the timer. This is the "inference under uncertainty" thesis turned into a physical tension.
- **Scry**: pay 1 Focus (B) to flip one hidden glyph now. Cheap information, paid from the same budget as your attack.
- **Bluff tells**: with A/C in play, the telegraph shows a spell's *magnitude* as a glow intensity but not which glyph provides it, so "is that AMPLIFY or ANCHOR" stays a read.

### H. Round modifiers and sudden death (S)

- Every third round draws a **weather** card visible to both: "Storm: AMPLIFY costs 0", "Hush: SILENCE is free and also strips essence", "Ironbound: wards have integrity 1", "Open sky: no wards may be cast". One rule flipped, telegraphed a round ahead, keeps the deck from being solved.
- **Sudden death** at 2–2: both telegraphs switch to the medium preset, reactions cost double (B), one round decides. Announced with a stage beat (F).

### I. Opponents with a face (S–M)

- Three bot personalities from the existing scoring table with different weights: **Ember** (aggressive: +threats, never wards), **Warden** (turtle: wards first, NULL at match point), **Trickster** (bluffs: AMPLIFY/ANCHOR bias, REFLECT-happy). Each has a portrait (F) and a one-line taunt after the round drawn from the round explanation ("You read that one." / "ANCHOR. Always ANCHOR.").
- A **rival ladder**: beat Ember to unlock Warden, etc. Progression by knowledge (you learned to read wards), not by power.

### J. In-match draft (M)

Each round both players pick **one of three offered glyphs** to add to their tray for the rest of the match (the tray starts at 8, ends near 12). Variety without collection; the pick is visible to the opponent, so it is also a telegraph ("she took ANCHOR — REFLECT is off the table"). Pairs naturally with the concept doc's Equal Draft mode.

## 4. Battle examples

Log lines are in the style the client already prints. State lines show what each option adds.

### Example 1 — Options A + B (ward integrity, reactions cost Focus)

*Solo, round 1. You start with SELF WARD FIRE from last round (integrity 2).*

Telegraph: `FIRE → SEEK → ? → ?` — Focus shows both budgets: yours 7.

- You reason: FIRE against my FIRE ward — blocked either way. If the tail is AMPLIFY the ward takes 2 and breaks; SILENCE (1 Focus) would save it. You take SILENCE and compose `GATE CLOSE ANCHOR` (5 Focus). Remaining: 1. No NULL possible — accepted.
- Opponent's spell: `FIRE SEEK ENEMY AMPLIFY`.

```
Round 1 — You took the round, 1–0 in seals.
You gained a seal: GATE CLOSE ANCHOR - The GATE was closed.
The opponent's FIRE SEEK ENEMY AMPLIFY was blocked by your ward.
Your SILENCE: SILENCE stripped non-core modifiers; the base spell remains. Ward integrity 2 → 1 (would have shattered).
```

*Round 2.* Telegraph: `SHADOW → BIND → ?`. Your FIRE ward does not cover SHADOW… but BIND carries no essence, so the ward blocks it anyway — unless it was `SHADOW SEEK`. You spent 5 last round and have 7 again. You choose REFLECT (2) and `FIRE SEEK ENEMY` (3): margin 2.

```
Round 2 — You took the round, 2–0 in seals.
You gained a seal: REFLECT returned SHADOW BIND ENEMY to its caster.
You gained a seal: FIRE SEEK ENEMY - SEEK reached opponent with magnitude 1.
```

Verdict at 3–0 two rounds later: *"You win the duel 3–0. Winning seals - R1: GATE CLOSE ANCHOR · R2: REFLECT returned SHADOW BIND ENEMY · R2: FIRE SEEK ENEMY."* The interesting part is round 1: SILENCE finally had a reason to exist, and the Focus margin made NULL a real sacrifice.

### Example 2 — Option C (Resolve as the second clock), with A

*Hot-seat. Resolve 10 each, seals 0–0.*

| Round | Player 2 casts | Player 1 reacts / casts | Player 2 reacts | Result |
|---|---|---|---|---|
| 1 | FIRE SEEK ENEMY AMPLIFY | none / SELF WARD FIRE | none | P1 Resolve 10→8, P2 +1 seal. P1 raises a FIRE ward (integrity 2). |
| 2 | FIRE SEEK ENEMY AMPLIFY | none / SHADOW SEEK ENEMY | REFLECT | P2's spell hits the ward: blocked, integrity 2→0, **ward shatters**. P1's SEEK is reflected: P2 +1 seal, P1 Resolve 8→7. Seals 2–0 to P2. |
| 3 | ENEMY BIND ANCHOR | NULL / GATE CLOSE | none | BIND canceled. GATE closed: P1 +1 seal. 2–1. P1 at 7 Resolve, ward gone. |
| 4 | SHADOW SEEK ENEMY | REFLECT / FIRE SEEK ENEMY ANCHOR | REFLECT fails (ANCHOR) | P1's REFLECT returns SHADOW: P2 Resolve 10→9, P1 +1 seal. P1's anchored SEEK lands: P2 9→8, P1 +1 seal. **P1 wins 3–2 on seals** — the Resolve bars never decided it, but P1's 7 flashing "faltering" at round 3 (≤3 would have been) was the tension. |

Tuning note from this example: with magnitude 1–2, Resolve 10 rarely reaches 0 before 3 seals. Either lower Resolve to 6, or let *unanswered* seals also cost 1 Resolve, so the two clocks converge. Decide from telemetry, not taste.

### Example 3 — Options D + G (timer, quick cast, progressive reveal), presentation F

*Solo vs Trickster (I). Reaction ring: 8 s.*

- 0.0 s — telegraph `? → SEEK → ? → ?`. Ring starts draining. Stage: the opponent silhouette winds up, a purple haze (SHADOW tell from G's glow) gathers.
- 2.5 s — first hidden glyph flips: `SHADOW → SEEK → ? → ?`.
- 4.0 s — you pick REFLECT and tap FIRE, SEEK, ENEMY, CAST at 4.6 s: **quick cast**, +1 magnitude, your next telegraph hides one extra glyph.
- Resolution beat: the purple bolt flies, flips at the midpoint (REFLECT), hits the Trickster: screen shake, seal orb fills. Your fire arc lands, second orb. Slow-motion on the second orb because it makes it 3–1: match.

```
You win the duel 3–1. Winning seals - R2: REFLECT returned SHADOW SEEK ENEMY AMPLIFY · R3: FIRE SEEK ENEMY (quick cast, magnitude 2) · …
Trickster: "Fine. You read faster than I lie."
```

What the timer tests: whether people react before the reveal (guessing) or wait for it (inference), which is precisely the POC-5 question, now measured in seconds instead of asked afterwards.

### Example 4 — Option H (weather + sudden death) in hot-seat

*Round 3 weather drawn: Ironbound (wards have integrity 1). Seals 2–2 after round 4 → sudden death, medium telegraphs, reactions cost double (B).*

- Sudden-death telegraph for Player 1: `? → [action] → ? → ENEMY` (one exact glyph, one family, count 4). Player 1 knows: a 4-glyph hostile spell on ENEMY, action unknown. REFLECT would cost 4 of 7 Focus, leaving a 3-Focus spell at most.
- Player 1 takes REFLECT and `GATE CLOSE` (2). Player 2's spell was `FIRE SEEK ENEMY ANCHOR` — REFLECT fails.

```
Sudden death — Player 2 took the round, 1–1 in seals… the GATE decides: Player 1 gained a seal: GATE CLOSE - The GATE was closed.
Player 2 gained a seal: FIRE SEEK ENEMY ANCHOR - SEEK reached player with magnitude 1.
Tie-break: the seal that landed first in resolution order wins — Player 2's incoming spell resolved before Player 1's cast.
```

Sudden death needs a deterministic tie-break rule; "incoming resolves first" is the current resolver order, so the defender is favoured to *react*, the attacker to *land*. Worth a scenario in the deck.

## 5. Suggested packages

| Package | Options | Cost | What it changes | How we will know |
|---|---|---|---|---|
| **1. Teeth** (first) | A ward integrity, B reaction costs + exposed, E ignite, H weather | S+S+S+S ≈ 4 days | SILENCE/AMPLIFY/NULL become real choices; rounds differ | reaction distribution flattens (summary endpoint), NULL share drops below 40 %, rematch rate up |
| **2. Pulse** | D timers + quick cast, G progressive reveal, I personalities | M+M+S | tempo and a face to beat | median time-to-commit falls, inference-vs-guess question answered by *when* people react |
| **3. Stage** | F stage in SVG/CSS + WebAudio | M–L | spectacle; the log becomes the replay, not the show | rematch rate, session length, "would you play again" |
| **4. Resolve** (flagged) | C hit points as second clock | M | comeback pressure, a life bar to look at | `match_end.reason` split; keep only if it does not shorten decision time (which would mean people stopped reading) |

Order rationale: packages 1 and 2 change what a decision *is* and can be measured with the telemetry that already exists; package 3 is the largest feel change and is safe to build in parallel because it touches no rules; package 4 is the one that argues with the concept doc, so it ships as an A/B option and earns its place with numbers.

Every rule option lands in `packages/wyrd-resolver` behind a `rulesVersion` (architecture doc §21) with golden tests, a scenario in the deck that teaches it, and a line in `glyphHelp` where a glyph's meaning changes. The advisor and the explanations need no new text: they ask the resolver.

## 6. Decisions needed

1. Are we willing to let a life bar (C) exist even as an option, given the handoff's "no health yet"? Proposal: yes, flagged, judged by telemetry.
2. Reaction costs (B): fixed prices or scaling with the incoming spell's Focus? Proposal: fixed first; scaling is a second experiment.
3. Timer defaults (D): on for the bot after the scenario deck, off in the deck, per-player toggle in hot-seat. Proposal as stated.
4. Which comes first, Teeth or Stage? Proposal: Teeth, because it is a week of resolver work that the stage would only make prettier, and its effect is measurable with what we already log.
