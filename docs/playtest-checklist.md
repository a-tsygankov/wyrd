# Wyrd — phone playtest checklist (POC-4b + POC-5)

Everything below needs a human with the actual devices. What CI already proves in emulation (WebKit as iPhone 15, Chromium as Pixel 7): the manifest and icons satisfy Chrome's install criteria, iOS home-screen metadata is present, the install coach mark matches the platform, the service worker installs and the shell reloads offline (Chromium), a full seeded match plays to a win, and telemetry is sent. What emulation cannot prove is the OS side: the real install flows, the home-screen icon, the standalone chrome, safe areas on a notched device, and whether real people can read the telegraph.

Site: **https://wyrd-web.pages.dev** · versions in the footer (`web vX · worker vY · schema Z`) · replay a match with `?seed=<anything>` · opt out of telemetry with `?telemetry=off` · review results at **https://wyrd-web.pages.dev/api/telemetry/summary**.

Record results in the tables at the bottom and copy the outcome line into `handoff.md`.

---

## Part A — installation and shell (POC-4b items 1, 2, 6)

### A1. iPhone (Safari)
| # | Step | Expected | Pass? |
|---|---|---|---|
| 1 | Open the site in Safari (not in-app browsers) | Board loads; footer shows `web vX · worker vY · schema Z`; a banner says "Add Wyrd to your Home Screen: tap Share, then Add to Home Screen" | |
| 2 | Tap "Not now" on the banner, reload | Banner stays hidden | |
| 3 | Share → Add to Home Screen | Sheet shows the violet sigil icon and the name "Wyrd Duel" (not a page screenshot) | |
| 4 | Open from the Home Screen | Opens full-screen without Safari chrome; status bar area is dark/translucent; nothing hides behind the notch or home indicator (topbar and CAST button fully visible) | |
| 5 | In the installed app: no banner | The coach mark must not show inside the installed app | |
| 6 | Enable Airplane Mode, close the app fully, reopen | Board loads from cache; footer shows only `web vX` (worker unreachable) ; a duel against the deck can be played | |
| 7 | Disable Airplane Mode, reopen | Footer shows worker + schema versions again | |
| 8 | Play a full match to 3 seals | No layout breakage, tray buttons ≥ 44 px, combat log readable, lesson lines visible | |
| 9 | Rotate to landscape | Still usable (portrait is the design target; landscape must not break) | |

### A2. Android (Chrome)
| # | Step | Expected | Pass? |
|---|---|---|---|
| 1 | Open the site in Chrome | Board loads; within a few seconds either Chrome's own install mini-infobar or our banner with an **Install** button appears | |
| 2 | Tap Install (ours or Chrome's) | Install dialog shows the sigil icon and "Wyrd Duel"; app appears in the launcher with an adaptive (masked) icon that is not cropped | |
| 3 | Open from the launcher | Standalone window, dark theme colour in the status bar, no browser UI | |
| 4 | In the installed app: no banner | | |
| 5 | Airplane Mode, force-stop, reopen | Loads offline; duel playable; footer web-only | |
| 6 | Back online, reopen | Footer shows all three versions | |
| 7 | Full match to 3 seals | Same layout checks as iPhone | |
| 8 | Chrome menu → "Add to Home screen" path (if no prompt appeared in step 1) | Note that the prompt did not appear: that is a bug to file | |

### A3. Update propagation (both)
| # | Step | Expected | Pass? |
|---|---|---|---|
| 1 | Note the footer `web vX` in the installed app | | |
| 2 | After the next deploy to main, close and reopen the app twice | Footer shows the new web version by the second open (new service worker activates on the next load) | |

### A4. Desktop Chrome DevTools (Lighthouse's PWA category no longer exists)
| # | Step | Expected | Pass? |
|---|---|---|---|
| 1 | DevTools → Application → Manifest | No installability errors or warnings; icons render | |
| 2 | DevTools → Application → Service workers | One active worker `sw.js`, cache `wyrd-web-v<web version>` under Cache Storage | |
| 3 | Lighthouse → Mobile → Performance + Accessibility + Best practices | Performance ≥ 90, Accessibility ≥ 90; note anything below | |

---

## Part B — gameplay experiment (POC-5)

Run with at least 3 people who have never seen the game, on their own phone, one at a time, no explanation beyond "read the opponent's spell and beat them to 3 seals". Rounds 1–8 are the curated deck (high-information telegraph in rounds 1–4 and 7, medium in 5, 6, 8); from round 9 the heuristic bot plays. Watch silently; note decision times and hesitations.

After each **duel round**, ask (write the answers verbatim):
1. Why did you win or lose that round?
2. Was your reaction based on something you read in the telegraph, or a guess?
3. Did you have more than one reasonable choice?

After the **match**:
4. Which glyph felt useless?
5. Which glyph felt mandatory?
6. Would you play another duel? (Do not prompt for the Reset button; see whether they reach for it. A Reset after a finished match is logged as a rematch.)
7. Was anything in the lesson lines surprising or wrong?

What the telemetry adds (summary endpoint): per scenario, how often each reaction was chosen, how often the player scored, and the median time to commit. Compare the high-information scenarios (1–4, 7) with the medium ones (5, 6, 8): the plan's hypothesis is that medium information should still produce inference, not guessing. If people reach for NULL by default, or the same reaction every round, the deck or the costs need tuning before anything else is built.

### B1. Per-tester log
| Tester | Device | Installed? | Match result | Rematch? | Q4 useless | Q5 mandatory | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

### B2. Per-scenario observations
| Scenario | Inference or guess? | Dominant reaction | Confusing step in the log | Idea |
|---|---|---|---|---|
| 1 direct-threat | | | | |
| 2 reflect-opportunity | | | | |
| 3 anchor-route | | | | |
| 4 amplify-bluff | | | | |
| 5 silence-modifier | | | | |
| 6 null-hard-counter | | | | |
| 7 ward-interaction | | | | |
| 8 ward-versus-bind | | | | |
| 9+ heuristic bot | | | | |

---

## Outcome line for handoff.md
`YYYY-MM-DD — phone playtest: iPhone <model/iOS> A1 x/9, Android <model> A2 x/8, A3 x/2, A4 x/3; N testers; rematch rate; top finding; next tuning change.`

## Known limitations to expect (not bugs)
- iOS shows no install prompt by design; the banner's instructions are the only path.
- Offline reload emulation is Chromium-only in CI; iOS offline behaviour is only verified here.
- Reactions cost no Focus in the POC rules; NULL is "expensive" only in the lesson text so far.
- SILENCE never prevents a seal in the POC rules (it strips modifiers). Recorded as an open rules question.
