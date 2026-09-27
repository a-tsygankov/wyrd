> 2026-09-27: the report below was never what players saw. Solo matches started with the nine-scenario teaching deck and ended inside it, so the bot only appeared from round 10. The deck now plays for a device's first match only (`settings.deck`), after which the bot meets the player from round 1.

# Bot variety report

Generated 2026-09-27 by `node scripts/bot_variety.mjs 40 12` (regenerate after any change to `packages/wyrd-simulation/src/bot.ts`). Bot vs bot: the personality under test as the opponent, the Adept as the player, 40 seeds, up to 12 rounds or 3 seals. "Repeat within 6" is the share of spells already cast in the previous six rounds; the reaction table is the probability of each answer on a fresh Teeth board. Since this run the bot also has a whim (a random reasonable spell in 8-25% of rounds by personality), a temper (hotter when behind) and quips; whims raise the distinct-spell counts below.

## 40 seeds × up to 12 rounds per personality and ruleset

| Ruleset | Personality | Rounds | Distinct spells | Top spell (share) | Entropy bits | Repeat within 6 | Plans used |
|---|---|---:|---:|---|---:|---:|---|
| classic | balanced | 275 | 111 | ENEMY BIND SPLIT ANCHOR (4%) | 6.34 | 0.7% | strike 40%, gate 25%, trick 13%, shield 12%, probe 10% |
| classic | aggressor | 193 | 68 | ENEMY BIND AMPLIFY SPLIT (8%) | 5.48 | 1.0% | strike 64%, gate 16%, trick 7%, shield 7%, probe 6% |
| classic | warden | 328 | 114 | GATE CLOSE AMPLIFY SPLIT (4%) | 6.36 | 0.9% | shield 35%, gate 24%, strike 24%, probe 13%, trick 5% |
| classic | trickster | 224 | 115 | SEEK ENEMY WEAKEN REVERSE (4%) | 6.43 | 0.0% | trick 49%, gate 16%, strike 15%, probe 12%, shield 9% |
| classic | gatekeeper | 293 | 99 | GATE CLOSE AMPLIFY SPLIT (6%) | 6.15 | 0.7% | gate 50%, strike 24%, shield 11%, trick 10%, probe 5% |
| teeth | balanced | 200 | 87 | ENEMY BIND SPLIT (5%) | 6.05 | 0.0% | strike 34%, trick 20%, gate 18%, shield 16%, probe 13% |
| teeth | aggressor | 160 | 60 | SEEK ENEMY AMPLIFY SPLIT (9%) | 5.34 | 0.0% | strike 61%, trick 14%, gate 14%, shield 7%, probe 4% |
| teeth | warden | 295 | 114 | ENEMY BIND SPLIT (3%) | 6.48 | 0.3% | shield 28%, gate 24%, strike 23%, probe 16%, trick 9% |
| teeth | trickster | 187 | 108 | SEEK ENEMY WEAKEN REVERSE (3%) | 6.53 | 0.5% | trick 40%, probe 20%, strike 16%, gate 15%, shield 10% |
| teeth | gatekeeper | 197 | 82 | GATE CLOSE AMPLIFY SPLIT (8%) | 5.89 | 0.0% | gate 49%, strike 18%, trick 15%, shield 12%, probe 6% |
| resolve | balanced | 187 | 90 | SEEK ENEMY AMPLIFY SPLIT (4%) | 6.20 | 0.5% | strike 35%, gate 29%, trick 13%, shield 13%, probe 10% |
| resolve | aggressor | 156 | 66 | SEEK ENEMY AMPLIFY SPLIT (11%) | 5.46 | 0.0% | strike 62%, gate 17%, trick 9%, shield 7%, probe 6% |
| resolve | warden | 265 | 119 | GATE WARD AMPLIFY SPLIT (5%) | 6.60 | 0.0% | shield 34%, strike 25%, gate 21%, probe 14%, trick 6% |
| resolve | trickster | 179 | 110 | ENEMY BIND WEAKEN REVERSE (4%) | 6.53 | 0.0% | trick 49%, gate 16%, probe 14%, strike 13%, shield 8% |
| resolve | gatekeeper | 205 | 91 | GATE CLOSE AMPLIFY SPLIT (7%) | 6.04 | 0.5% | gate 52%, strike 18%, shield 13%, trick 11%, probe 6% |

## Reactions against fixed incoming spells (Teeth, fresh board)

| Personality | FIRE SEEK ENEMY | FIRE SEEK ENEMY AMPLIFY | ENEMY BIND | GATE CLOSE | SEEK ENEMY SPLIT | GATE OPEN REVERSE | SELF WARD SHADOW |
|---|---|---|---|---|---|---|---|
| balanced | reflect 82% / null 8% / none 7% | reflect 81% / null 8% / none 7% | reflect 82% / null 8% / none 7% | null 67% / none 22% / reflect 5% / silence 5% | reflect 60% / null 20% / none 14% / silence 6% | silence 58% / null 27% / none 10% | none 72% / null 9% / reflect 9% / silence 9% |
| aggressor | reflect 78% / null 10% / none 8% | reflect 78% / null 10% / none 8% | reflect 78% / null 10% / none 8% | null 69% / none 22% | reflect 60% / null 20% / none 14% / silence 6% | silence 49% / null 34% / none 12% | none 86% / reflect 5% |
| warden | reflect 83% / null 6% / none 5% / silence 5% | reflect 83% / null 6% / none 5% / silence 5% | reflect 83% / null 6% / none 5% / silence 5% | null 72% / none 12% / reflect 8% / silence 8% | reflect 64% / null 20% / none 9% / silence 7% | silence 77% / null 12% / none 6% / reflect 5% | none 41% / silence 28% / reflect 20% / null 11% |
| trickster | reflect 53% / null 19% / none 17% / silence 11% | reflect 53% / null 19% / none 17% / silence 12% | reflect 53% / null 19% / none 17% / silence 11% | null 44% / none 28% / silence 15% / reflect 14% | reflect 39% / null 25% / none 22% / silence 14% | silence 44% / null 27% / none 18% / reflect 11% | none 43% / silence 21% / null 18% / reflect 18% |
| gatekeeper | reflect 84% / null 7% / none 6% | reflect 83% / null 7% / none 6% | reflect 84% / null 7% / none 6% | null 75% / none 17% | reflect 61% / null 20% / none 14% / silence 5% | silence 52% / null 35% / none 9% | none 74% / null 9% / reflect 9% / silence 9% |
