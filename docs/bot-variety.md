# Bot variety report

Generated 2026-09-26 by `node scripts/bot_variety.mjs 40 12` (regenerate after any change to `packages/wyrd-simulation/src/bot.ts`). Bot vs bot: the personality under test as the opponent, the Adept as the player, 40 seeds, up to 12 rounds or 3 seals. "Repeat within 6" is the share of spells already cast in the previous six rounds; the reaction table is the probability of each answer on a fresh Teeth board. Reads: spells stay varied (dozens of distinct spells, the top one well under a fifth), and no reaction is a certainty (the best answer stays below 85%, except where only one option is sensible).

## 40 seeds × up to 12 rounds per personality and ruleset

| Ruleset | Personality | Rounds | Distinct spells | Top spell (share) | Entropy bits | Repeat within 6 | Plans used |
|---|---|---:|---:|---|---:|---:|---|
| classic | balanced | 235 | 88 | SEEK ENEMY AMPLIFY SPLIT (6%) | 5.98 | 0.0% | strike 35%, gate 23%, shield 15%, trick 14%, probe 13% |
| classic | aggressor | 197 | 59 | SEEK ENEMY AMPLIFY SPLIT (8%) | 5.23 | 0.5% | strike 62%, gate 15%, trick 11%, probe 8%, shield 4% |
| classic | warden | 302 | 108 | ENEMY BIND AMPLIFY SPLIT (5%) | 6.35 | 0.3% | shield 30%, strike 26%, gate 22%, probe 17%, trick 5% |
| classic | trickster | 216 | 90 | SEEK ENEMY AMPLIFY SPLIT (7%) | 6.03 | 0.0% | trick 42%, probe 19%, strike 18%, shield 11%, gate 10% |
| classic | gatekeeper | 251 | 85 | GATE CLOSE SPLIT (5%) | 5.97 | 0.4% | gate 48%, strike 20%, trick 12%, shield 12%, probe 8% |
| teeth | balanced | 144 | 64 | SEEK ENEMY AMPLIFY SPLIT (6%) | 5.59 | 0.0% | strike 35%, gate 22%, trick 17%, shield 15%, probe 12% |
| teeth | aggressor | 117 | 49 | SEEK ENEMY AMPLIFY SPLIT (12%) | 5.11 | 0.0% | strike 63%, trick 14%, gate 14%, probe 5%, shield 4% |
| teeth | warden | 213 | 89 | SEEK ENEMY SPLIT (5%) | 6.12 | 0.0% | shield 36%, strike 21%, gate 21%, probe 14%, trick 8% |
| teeth | trickster | 135 | 64 | ENEMY BIND WEAKEN REVERSE (5%) | 5.67 | 0.0% | trick 41%, probe 19%, gate 16%, strike 16%, shield 7% |
| teeth | gatekeeper | 189 | 77 | GATE CLOSE AMPLIFY SPLIT (6%) | 5.78 | 1.1% | gate 49%, strike 19%, shield 15%, trick 10%, probe 7% |
| resolve | balanced | 156 | 63 | ENEMY BIND SPLIT (6%) | 5.58 | 0.0% | strike 34%, gate 24%, shield 17%, probe 13%, trick 12% |
| resolve | aggressor | 122 | 46 | SEEK ENEMY AMPLIFY SPLIT (10%) | 5.10 | 0.0% | strike 60%, gate 16%, probe 12%, trick 7%, shield 5% |
| resolve | warden | 217 | 87 | SEEK ENEMY AMPLIFY SPLIT (6%) | 6.06 | 0.0% | shield 29%, gate 25%, strike 22%, probe 18%, trick 6% |
| resolve | trickster | 167 | 78 | ENEMY BIND AMPLIFY SPLIT (7%) | 5.86 | 0.0% | trick 47%, probe 16%, strike 16%, gate 12%, shield 10% |
| resolve | gatekeeper | 184 | 78 | GATE CLOSE AMPLIFY ANCHOR (6%) | 5.90 | 0.5% | gate 51%, strike 20%, probe 11%, shield 10%, trick 8% |

## Reactions against fixed incoming spells (Teeth, fresh board)

| Personality | FIRE SEEK ENEMY | FIRE SEEK ENEMY AMPLIFY | ENEMY BIND | GATE CLOSE | SEEK ENEMY SPLIT | GATE OPEN REVERSE | SELF WARD SHADOW |
|---|---|---|---|---|---|---|---|
| balanced | reflect 82% / null 8% / none 7% | reflect 81% / null 8% / none 7% | reflect 82% / null 8% / none 7% | null 67% / none 22% / reflect 5% / silence 5% | reflect 60% / null 20% / none 14% / silence 6% | silence 58% / null 27% / none 10% | none 72% / null 9% / reflect 9% / silence 9% |
| aggressor | reflect 78% / null 10% / none 8% | reflect 78% / null 10% / none 8% | reflect 78% / null 10% / none 8% | null 69% / none 22% | reflect 60% / null 20% / none 14% / silence 6% | silence 49% / null 34% / none 12% | none 86% / reflect 5% |
| warden | reflect 83% / null 6% / none 5% / silence 5% | reflect 83% / null 6% / none 5% / silence 5% | reflect 83% / null 6% / none 5% / silence 5% | null 72% / none 12% / reflect 8% / silence 8% | reflect 64% / null 20% / none 9% / silence 7% | silence 77% / null 12% / none 6% / reflect 5% | none 41% / silence 28% / reflect 20% / null 11% |
| trickster | reflect 53% / null 19% / none 17% / silence 11% | reflect 53% / null 19% / none 17% / silence 12% | reflect 53% / null 19% / none 17% / silence 11% | null 44% / none 28% / silence 15% / reflect 14% | reflect 39% / null 25% / none 22% / silence 14% | silence 44% / null 27% / none 18% / reflect 11% | none 43% / silence 21% / null 18% / reflect 18% |
| gatekeeper | reflect 84% / null 7% / none 6% | reflect 83% / null 7% / none 6% | reflect 84% / null 7% / none 6% | null 75% / none 17% | reflect 61% / null 20% / none 14% / silence 5% | silence 52% / null 35% / none 9% | none 74% / null 9% / reflect 9% / silence 9% |
