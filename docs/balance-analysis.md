# Wyrd — balance analysis: does every opponent move have an answer?

Status: analysis, 2026-09-26, against the resolver as shipped (19-glyph tray with WEAKEN, SPLIT, REVERSE; rulesets Classic / Teeth / Pulse / Resolve). Numbers come from `scripts/balance_report.mjs`, which runs the real resolver over the legal pool; regenerate with:

```bash
pnpm build && node scripts/balance_report.mjs teeth
```

(`classic` and `resolve` as arguments; `--all` lists every spell instead of one per shape.)

## 1. Method

- **Pool**: the 286 legal spells the tray allows (226 distinct shapes: action, target, essence or none, modifiers).
- **Situations**: a fresh board; you hold an untyped ward; you hold a FIRE ward; the gate closed; the gate broken.
- **Threat**: an opponent spell that, unanswered, costs you something: a seal (1.0), your ward (1.0), a dent (0.3), Resolve (0.25 a point), being bound (0.5).
- **Counter**: a reaction (SILENCE, REFLECT, NULL) after which you are no worse off. A "+" counter also scores for you.
- **Flags**: `UNANSWERABLE` (no reaction helps), `NULL-ONLY` (the 3-Focus hard counter is the only one), `TEMPO-NEGATIVE` (the cheapest counter costs more than the spell), `CHEAP-ANSWER` (a counter at half the spell's price or less).
- **Dominance**: each player spell's expected seals against the balanced bot's reaction table, fresh and against a warded opponent.

Wards raised *this* round never stop *this* round's incoming spell (the incoming spell resolves first), so the analysis treats a ward as a previous-round investment, which is what it is.

## 2. Headline results

| Ruleset | Threat rows | NULL-only rows | Tempo-negative | Unanswerable |
|---|---:|---:|---:|---:|
| Classic | 250 | 94 | 0 (reactions are free) | 0 |
| Teeth | 250 | 108 | 4 | 0 |
| Resolve | 250 | 117 | 4 | 0 |

Every threat has at least one answer: there is no unanswerable spell. But **roughly four in ten threats can only be answered by NULL**, and the game's own principle is "no universal strongest counter". The four tempo-negative rows are all plain gate spells.

## 3. The most unbalanced actions, ranked

### 3.1 Plain gate spells: NULL-only and cheaper than their answer

`GATE CLOSE` (2 Focus, open gate) and `GATE OPEN` (2 Focus, closed gate) score a seal; wards and REFLECT cannot touch the gate by design, so the only answer is NULL at 3 Focus. Under Teeth and up the defender pays more than the attacker to break even, every time. Against the balanced bot, whose table only NULLs at match point, `GATE CLOSE` variants are the best spells on the board whenever the opponent holds a ward (expected +0.84 to +0.87 seals).

**Why it matters**: the gate was added to give SILENCE and wards something they cannot answer and to make CLOSE a tempo play; it has become a seal on demand for 2 Focus.

**Options**
1. **Contested gate** (rules, S): when both mages target the gate in the same round, neither moves it ("the gate shudders") and nobody scores. Removes the seat bias of §3.5 too.
2. **Gate wards** (grammar + rules, S): let WARD take the GATE as its target (`GATE WARD`, `GATE WARD FIRE`): a warded gate ignores the next gate spell (or gate spells of that essence) and takes a dent like a mage's ward. The parser already has the port type; the registry needs `BoundaryRef` on WARD's target.
3. **Price parity** (content, S): CLOSE and OPEN cost 3, so NULL is at parity and the 7-Focus budget forces a choice between a gate spell and a strong reaction.
4. **REFLECT re-aims the gate** (rules, S): REFLECT against a gate spell lets it resolve but awards the seal to the reflector ("the gate answers the other mage"). Thematically loose; mechanically it gives the gate a 2-Focus answer.

Recommendation: 1 and 2 together. They keep NULL as the only *reaction*, which the spec wants, while giving the gate a positional answer (a ward you invest in earlier) and removing the race bias.

### 3.2 ANCHOR on a hostile spell: NULL-only, and the strongest spell in the game

`SEEK ENEMY ANCHOR` (4 Focus) and its essence variants have the highest expected seals in every ruleset (+0.91 on a fresh board, eight spells tied). ANCHOR blocks REFLECT; SILENCE strips ANCHOR but the base SEEK still lands and still scores, and the defender only has one reaction, so SILENCE does nothing useful against it. Untyped, it walks through a ward of any essence unless the ward is untyped too. `ENEMY BIND ANCHOR` is the same at 4 Focus.

**Options**
1. **A fixed route is a known route** (rules, S): an ANCHORed hostile spell is blocked by *any* ward on its target, essence or not. Wards become the plan against ANCHOR, SILENCE stays the answer to tricks, NULL stays the emergency.
2. **ANCHOR costs 3** (content, S): `SEEK ENEMY ANCHOR` at 5 leaves 2 Focus, so the anchored caster cannot afford REFLECT or NULL themselves that round.
3. **SILENCE dulls** (rules, M): a silenced spell lands its state effects but cannot seal. Makes 1 Focus stop every seal; too strong, listed for completeness.
4. **Two half-reactions** (rules, M): allow SILENCE + REFLECT in one window for 3 Focus. Same price as NULL, teaches more, but the spec's single counter window and the phone UI both argue against it.

Recommendation: 1, then 2 if telemetry still shows ANCHOR in more than a third of scoring spells.

### 3.3 SPLIT and ANCHOR together: 6 Focus for an unanswerable pair of hits

`SEEK ENEMY SPLIT ANCHOR` and `ENEMY BIND SPLIT ANCHOR` (6 Focus): REFLECT is blocked, both branches land, two dents shatter a fresh ward. Only NULL answers, but at 3 Focus against 6 it is a `CHEAP-ANSWER`, and the caster has 1 Focus left for their own defence. This is the spec's intent (cheap precise counters beating expensive spells) working; it is flagged because against a bot that rarely NULLs it is a free double hit. Fix the bot (see 3.6) before touching the rule.

### 3.4 BIND with SPLIT or ANCHOR: REFLECT is not a full answer

`ENEMY BIND SPLIT` (4 Focus): REFLECT turns one branch and binds the caster, but the other branch still binds you, so you end bound as well; against `ENEMY BIND ANCHOR` REFLECT fails outright. Under Resolve being bound is a 2-Focus tax next round. Any ward blocks BIND (it carries no essence), so the positional answer exists; the reaction answer is NULL only.

**Option**: BIND's tax could be paid by the *binder* when the bind is reflected onto them (it already is: the reflected branch binds the caster). No rule change needed if 3.2's option 1 lands; the ward then answers the anchored BIND.

### 3.5 Resolution order: the opponent always resolves first

When both mages cast `GATE CLOSE` on an open gate, the incoming spell resolves first and scores; the player's spell fails as "already closed". The same holds for `GATE OPEN`, `GATE BREAK` versus `GATE CLOSE`, and for who shatters whose ward first. In solo play the computer is always the incoming caster, so it wins every same-round race by seat.

**Options**
1. **Contested gate** as in 3.1: same-round gate spells cancel.
2. **Initiative by Focus** (client + rules, S): the cheaper spell resolves first; ties alternate by round parity. Rewards the 2-glyph answer the spec favours.
3. **Quick cast grants initiative** under Pulse and Resolve: committing fast resolves first. Makes the timer matter beyond +1 magnitude.

Recommendation: 2, with 3 layered on for the timed rulesets. The engine already resolves the two spells as separate encounters, so order is a client decision.

### 3.6 The bot's NULL policy makes gate spells look better than they are

`scoreReactions` gives NULL a score of 0.5 against a scoring spell outside match point, so the balanced bot almost never NULLs a gate spell; that is why `GATE CLOSE` shows +0.84 expected seals against a warded opponent. The Gatekeeper personality already NULLs a scoring gate spell at 3. Raising the base NULL score to 2.5 for gate spells that would score (all personalities) would make the dominance table honest without changing a rule.

### 3.7 SILENCE's cheap answers (working as intended)

`SILENCE` at 1 Focus fully undoes `GATE OPEN REVERSE` (4), `ENEMY MEND REVERSE` (4) and every REVERSE and SPLIT trick at 4 to 6 Focus. That is the spec's "cheap, precise counters should sometimes beat expensive elaborate spells". It does mean REVERSE is only worth casting when the opponent cannot afford SILENCE or does not read the telegraph; the telegraph hides REVERSE (it shows OPEN), so the mind game is real. No change proposed; watch SILENCE usage in telemetry.

## 4. What is fine

- Plain hostile spells (`SEEK ENEMY`, `FIRE SEEK ENEMY`, `ENEMY BIND`, `ENEMY BREAK`): REFLECT answers and scores, NULL answers, a matching ward answers for free. The core loop is balanced.
- WEAKEN is a bluff and priced like one; it never creates a NULL-only situation on its own.
- BREAK on a mage is unblockable but reflectable and scores nothing; its threat is one ward, the answer costs 2. Fair.
- Nothing is unanswerable in any ruleset.

## 5. Suggested order of work

1. Bot NULL policy for scoring gate spells (3.6) — a number in `bot.ts`, no rule change; rerun the report.
2. ANCHORed spells blocked by any ward (3.2 option 1) — one resolver condition plus tests and help text.
3. Contested gate (3.1 option 1) and initiative by Focus (3.5 option 2) — client resolution order plus a resolver rule for same-round gate spells.
4. Gate wards (3.1 option 2) — grammar port, resolver, help, a deck scenario.
5. Revisit prices (ANCHOR 3, CLOSE/OPEN 3) only if telemetry still shows the patterns after 1–4.

Each step should move the NULL-only share (108 of 250 rows under Teeth) down; the report is the regression test.
