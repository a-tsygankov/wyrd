# Wyrd — Rune Lab: gameplay

Status: prototype (`/rune-lab.html`, PRs #51-#53), reading pass and shared openings 2026-09-30. Rules in `apps/web/src/runeDuel.ts` (pure, `test/rune_duel.test.mjs`); the page in `runeLab.ts`, the 3D arena in `runeArena.ts`; the in-page Help drawer is the player-facing version of this document and must change with it.

## The idea

Magic in Wyrd is a written language. Your opponent writes a rune in the air, stroke by stroke; you **read it while it is still being written** and draw the rune that undoes it before it lands. Reading is the skill the game rewards: an early read charges your answer and leaves time for a combo; a misread can be corrected while their rune is in the air, at the cost of the charge. Drawing cleanly adds power. Nothing here depends on a bigger rune set or stronger opponents: those belong to a later RPG/strategy layer.

## What the prototype did before this pass

- **Fencing**: the opponent's rune appeared whole and at once; its name was spelled out 0.85 s later. There was no impact and no deadline, and the 60 s timer did nothing, so the only challenge was drawing the named counter cleanly. Nothing to read.
- **Parry**: the opponent's rune was fully hidden; commit within 4 s, then reveal. A pure guess.
- **Counters**: each rune beaten by two others, never explained on the page.
- **Log**: newest entry first (prepended), so the duel read backwards.
- **Recognition**: Ward and Power were told apart by total turning alone (> 4.2 rad = Ward). A triangle drawn corner to corner turns 180° plus its top angle, so any triangle with a top wider than ~60° read as a Ward.

## Changes in this pass

1. **The opponent writes its rune** over 3 s (`DRAW_MS`), then it flies for 0.6 s (`FLIGHT_MS`) and lands. The stroke grows with a glowing tip in the arena and, large enough to read on a phone, on the HUD above it. The read sharpens: SENSING (under 30% written), a hint (to 65%: "RISING · REDIRECT?"), the name.
2. **Ready, adjust, combo.** Lifting your finger readies a rune (it does not fire). Drawing again replaces it (a correction; the charge restarts) or, when the pair is a combo, finishes the combo. Your answer counts until impact, the flight included.
3. **Charge**: the share of the exchange still to come when you readied: up to +60% damage for an early read.
4. **Combos** (specific pairs, so a correction is never a combo by accident, each finisher still has to undo the threat): **Empower** — then △ (×1.5), **Reflect** ○ then ⌒ (their blow added to yours), **Siphon** ⌣ then — (heal what you deal). Every threat has at least one combo whose finisher answers it. A combo keeps its starter's charge.
5. **Resolution at impact**: a counter deals 8-16 by stroke quality × charge × combo; a wrong rune takes 7-14 (less for a cleaner stroke); no rune takes 16.
6. **Parry glimpse**: the first 35% of their stroke is drawn, then the rest stays hidden until the reveal. It narrows the field without giving the rune away.
7. **The clock means something**: at 0 the healthier mage wins (level: a draw).
8. **Help** rewritten: the idea, an exchange step by step, the counter chart with a reason for each counter, combos, how to draw (the existing cards), the two modes, the controls. The footer and the note state the idea too.
9. **Log** in reading order: oldest at the top, the latest appended at the bottom and scrolled into view.
10. **Recognition fix**: closed shapes are told apart by corners (sharp, concentrated turning on the evenly resampled stroke) before total turning, so a blunt triangle is Power.
11. **A stroke-clearing race**: the 220 ms tidy-up after a stroke no longer wipes a stroke begun inside it (a quick combo finisher lost its first points).
12. `?speed=` sets the game speed for one visit (slow play; the e2e suite runs multi-stroke specs at 0.1-0.25× because software WebGL makes each mouse move slow).

## Shared openings (second pass, 2026-09-30)

The first pass drew each rune the way the Help cards do, so the opening stroke of each was different and the rune showed itself in the first strokes. Now the opponent writes **every rune from the same opening**, a flat stroke from the left (`OPENING` in `runeDuel.ts`), and each rune departs from it at its own point (`DIVERGE`, measured from the geometry, not hand-tuned):

| Rune | Leaves the opening | How it shows |
|---|---|---|
| ⌒ Redirect | ~22% | bows up |
| ⌣ Absorb | ~25% | bows down |
| ○ Ward | ~25% | runs a little further, then curls back into a loop |
| △ Power | ~40% | stays flat along its whole base, then a sharp corner |
| — Pierce | never | known only once it has stayed flat past Power's corner (~50%) |

The read stages follow the shape: FLAT OPENING until the rune leaves it, a hint for 15% of the stroke ("BOWING UP · REDIRECT?"), then the name. The counter chart already pairs the families: **Pierce and Power are undone by the same runes (Ward, Redirect), so are Redirect and Absorb (Power, Pierce)**, so "still flat" or "it bowed" is already an answer; waiting for the name buys the right combo, not the counter. The strokes (`STROKES`, 64 evenly spaced points in the Help cards' 100 x 70 box) feed the HUD, the arena and a Help diagram of all five branching from the white opening, so the three never disagree. The player still draws their own runes the usual way; only the opponent's calligraphy shares the opening.

Known tell: every rune is written in the same 3 s, so a short rune's pen moves slower (Pierce's flat stroke grows more slowly than Power's base). A reader who notices pen speed can split Pierce from Power early; since they share their counters, it only matters for combos. A constant pen speed (draw time by length) would remove it and make Pierce the quickest rune to land.

## Ideas considered, not built yet
- **Feints** (an opponent that changes its stroke mid-rune) and **tempo** (faster writers) belong with opponent skills, deliberately left to the RPG/strategy layer.
- **Your stroke as a telegraph**: in a two-player version, your rune would be written visibly too, and both sides read each other.
- **Combo chains of three** and a combo meter, once two-rune combos are proven on phones.
- **Parry with a bluff**: commit a starter the opponent can glimpse, then finish it into something else.
- **Telemetry**: read time (progress at your first readied rune), corrections per exchange, combo rate; the questions to answer on phones.
