# The slot evaluator

The slot evaluator is the AI review that decides whether an original slot is kept. It is the slot counterpart of the Originals evaluator (`CLAUDE.md`, "The evaluator"). The contract is `docs/SLOTS.md` §5. This file explains how the evaluator works, why it weighs what it does, what it can't know yet, and how to change it safely.

- **Run it:** `/review-slot <id>`.
- **Plumbing:** `npm run slots:review -- …`, in `scripts/slots/review.ts` and `scripts/slots/review-lib/`.
- **Pipelines that use it:** `/generate-slots` and `/search-slots`.

**Version 2 (2026-11-16).** Facts not written by `slots:eval` fail the gate; the blind player must see every feature, free spins and respin chains alike (`review.featureQuery`); a respin-only slot is no longer a pure base game; the code hash covers the slot kit. These close holes in the §5 contract rather than tune a weight, and with no team ratings of slots there was nothing to A/B against. Every v1 review shows as stale.

## 1. How it works

**Three roles, each a fresh Opus subagent that sees only its own inputs:**

| Role | Sees | Scores | Prompt |
|---|---|---|---|
| Rules card | The manifest, `slot.spec.json`, `slot.config.json`, feature specs, and the game's source (theme, symbols, presentation) | Nothing: it writes facts only, and lists any on-screen text of 9+ words | `review-lib/prompts/card.ts` |
| Blind player (1, or a panel of 3) | Screenshots of the game under an alias. It is never told the id or name, and text of 9+ words is hidden | Theme, readability, feature clarity, excitement, fun (1–5). It also answers factual checks: what pays most, how the feature triggers, what the wild does, the biggest win, what the feature did | `review-lib/prompts/player.ts` |
| Designer | The card, the measured facts against the §3 bands, the panel's scores and answers, screenshots from the panel's sessions, and the slot catalogue | Creativity, maths fit, uniqueness, polish (1–5). It also grades each player's understanding, lists trademark uses, and names a reskin | `review-lib/prompts/judge.ts` |

**The blind session.** The player plays like a real slot player:
- at least 60 spins, at normal speed and in Turbo, and an Autoplay run;
- every feature the slot has, each forced once through the kit's dev hooks. In real play a feature comes once in 80–300 spins, so a 60-spin session would rarely see one. Each `feature` step forces the next feature in the game's list:
  - by default, free spins (`slot.config.json` `feature`) as `feature=1`, then a respin chain as `feature=respin` when the config has a `modifierFeature` or the base spec has a `*respin*` mechanic;
  - `slot.config.json` `review: { featureQuery: … }` overrides the list with one query or several, each `feature=1`, `feature=free`, `feature=respin` or `seed=<n>` (a seed the builder found). Example: `{ "review": { "featureQuery": ["feature=free", "seed=351"] } }`.

  `play` passes the list to the hook, which turns each entry into one fixed `window.__slotDev` call. The player never sees the queries, only "feature 1 of 2";
- the paytable, opened once.

Its only tool is `npm run slots:review -- play <alias> "<steps>"`. That runs `scripts/play.mjs --blind` on the aliased game, through a preload (`review-lib/play-hook.mjs`) that adapts the Originals sandbox to slots:
- the How-to-play button and its paytable dialog stay visible (Originals hide them);
- `text:` steps can also press toggles such as Turbo;
- a `feature` step and a `scroll` step run one fixed expression each (the `feature` step's comes from the game's feature list, never from the player). The player has no free JavaScript.

Prose of 9+ words stays hidden everywhere, the paytable included. A slot must explain itself in short lines, as good market slots do ("3 chests = 8 free spins").

The helper steps are `spin`, `spin×N`, `turbo`, `autoplay`, `watch×N`, `feature`, `paytable`, `scroll` and `close`. Each run prints contact sheets (6 spins per image), so a player can look at 60 spins without opening 60 images. Every call is logged in `_blind/<alias>/plays.json`. `judge-prompt` and `score` check each session against the brief from that log, not from the player's own account. A player who fell short is replaced, not used.

**The measured facts** come from `games/<id>/src/slot-facts.json` (`npm run slots:eval`) and `oracle.json` (`npm run slots:oracle`). `review-lib/facts.ts` reads them tolerantly: camelCase or snake_case, fractions or percentages, a probability or a "1 in N". It checks every §3 band:
- RTP 95.5–96.5%;
- hit rate 20–45% (classic 3×3: 10–25%; cluster and scatter pays: 25–45%);
- win > stake 8–25%;
- SD against the declared volatility;
- feature frequency, share and average win;
- P(win ≥ 100×), as a guide only;
- max win and its reachability;
- dry-streak p95 by declared volatility: low ≤ 12, medium ≤ 20, high ≤ 26, extreme ≤ 32.

The declared volatility comes from `slot.config.json` (or a single-entry manifest `volatility`).

## 2. The overall and the gate (code, `review-lib/scores.ts`)

1. **Panel merge.** Each player score is the panel's median (the lower one for an even panel). The comprehension grade is the median of the designer's per-player grades (correct > partial > misread), with ties going to the stricter grade.
2. **Misread cap.** If the panel's grade is `misread`, readability and feature clarity are capped at 2. A partial grade caps nothing but is listed in the cons.
3. **Maths-fit cap.** If any §3 band is missed by more than its width, maths fit is capped at 2. The widths:
   - each two-sided band's own width: RTP 1 point, hit rate 25 points (general), SD 3 / 5 / 10 by band;
   - the open extreme-volatility band: 10;
   - the one-sided bands (dry streak, max-win reachability): the bound itself, so a dry-streak p95 over twice its limit caps.
4. **Weighted mean.** The weights are below. A pure base game (no feature) drops feature clarity from both the mean and the gate. A slot whose only feature is a respin chain in the base game is not a pure base game.
5. **Readability cap.** The overall is at most 1.5 + 0.75 × readability: 3.0 at readability 2, 3.75 at readability 3.
6. **Gate (keep).** All of these must hold:
   - overall ≥ 3.5;
   - readability ≥ 3 and feature clarity ≥ 3;
   - `oracle.json` present, and RTP in 95.5–96.5%. The RTP is the game's total RTP from `slot-facts.json`, or the oracle's base RTP for a pure base game;
   - the oracle reproduced: the parity check that `slots:eval` records in `slot-facts.json` (`oracle.status`) passed, and the facts were measured from the spec the oracle holds (the same `specHash`). Facts with no `oracle.status` or no `specHash` weren't written by `slots:eval` (hand-written, or a game-local script) and fail as "facts not from slots:eval";
   - hit rate in band, dry-streak p95 within its volatility's limit, and P(max win) above 1 in 10⁹. A measure that wasn't measured fails;
   - not a reskin;
   - no trademarked mechanic name;
   - a full panel when the overall is 3.25–3.75 (inclusive);
   - every player's session complete by the play log: 60+ spins (an Autoplay watch shot counts as one), Turbo, Autoplay, the paytable, and a run of every feature the slot has ("saw 1 of 2 features" falls short). This one is a validity check, not a §5 quality bar: an under-tested review can't pass.

**Reskins.** A reskin is a catalogue slot with the same signature. The signature has three parts:
- the evaluation law on its board law and board size (e.g. `payline|global_mixture 5×3`);
- the modifier set: the pack families from the oracle, the feature-spec families, `feature:<kind>`, and the feature multiplier's law;
- the declared volatility band.

Code flags exact matches, and the designer can name a match that code misses (the same mechanics under different family names).

**Trademarks** (SLOTS.md §4). Code scans the game's `.ts`/`.tsx` files, comments left out, for "Megaways", "Hold & Win" and "Cash Collect" in their common spellings. Pack family ids such as `megaways_collector_terminal` don't match. The designer also lists any trademark use it sees on screen.

| Weight | Score | Who | Why |
|---|---|---|---|
| 3 | Fun | Player | The product. A slot is entertainment, and the question that matters is whether a real player would keep spinning. The prompt anchors it on the signals that keep players: anticipation, near-feature tension, variety of outcomes, and feature payoff. |
| 2 | Excitement | Player | Anticipation and big moments are what separate a slot from a random number generator. It's kept apart from fun so that a tense but confusing slot and a clear but flat one can be told apart. |
| 2 | Theme | Player | Theme is most of a slot's identity in a lobby, and the promise the maths must keep. |
| 2 | Readability | Player | The Originals lesson: the team rated games 1–2 when a player couldn't read them, however good the maths. It is also gated (≥ 3) and caps the overall. |
| 2 | Creativity | Designer | The brief asks for slots "as creative as real online casino slots". It rewards theme and mechanism as one idea. |
| 2 | Maths fit | Designer | The theme's promise is kept by the maths: volatility, hit rate, feature and max win. It is backed by the measured bands and their cap. |
| 1.5 | Feature clarity | Player | Features carry 30–50% of the RTP, so a feature the player can't follow is a large share of the game lost. It is gated (≥ 3) rather than weighted more. |
| 1.5 | Uniqueness | Designer | A catalogue needs variety, but a reskin is already a gate fail, so the score only ranks degrees of novelty. A designer's uniqueness call can swing between runs (maze 3.75 → 3.00 in the Originals), which is a reason not to weight it more. |
| 1 | Polish | Designer | The kit draws the panel, buttons and reel window the same for every game, so polish mostly measures symbol art. It matters, but the kit absorbs much of it. |

The weights add up to 17. A slot that scores 4 everywhere is 4.00. A 3 on readability alone caps the overall at 3.75.

## 3. Files

| File | Written by | What |
|---|---|---|
| `games/<id>/src/slot-review.json` (committed) | `score` | `{ version, overall, scores: { key: 1–5 }, gate: boolean, gateReasons: string[], verdict, pros, cons, confusions, players, codeHash, date }`. The cons include each cap that applied and any misread. The site shows it on the game page (`apps/platform/src/lib/slotInfo.ts`). |
| `.evaluator/slots/<id>/evidence.json` | `prepare` | The manifest, spec, config, normalised facts, band table, oracle summary, signature, trademark hits and code hash. |
| `.evaluator/slots/<id>/card.md` → `card.json` | `prepare` → the rules-card subagent | |
| `.evaluator/slots/_blind/<alias>/player.md` → `player.json`, `plays.json`, `ui/run-N/` | `player-prompt` → a blind player, through `play` | The alias → id map is in `_blind/_map/`, and the player is never pointed at it. |
| `.evaluator/slots/<id>/judge.md` → `review.json`, `panel.json`, `shots/` | `judge-prompt` → the designer subagent | |
| `.evaluator/slots/<id>/score.json` | `score` | The full scoring detail: mean, grades, bands, reskin twins, session shortfalls and panel spread. |
| `.evaluator/slots/<id>/play-errors.log` | `play` | Tool crashes, kept out of the player's folder because they may name the game. |

**Staleness.** `codeHash` is a hash of everything in `games/<id>/src` except `slot-review.json` and `slot-facts.json`, plus the slot kit and engine (`packages/slots/src`), which draw and play every slot. Left out of the kit: tests, fixtures and `engine/analytics/**`. The analytics are `slots:eval`'s maths, they don't change what the player sees or the outcomes, and their results reach the review through `slot-facts.json` (re-run `slots:eval` just before `score`). Any other change, the manifest or the kit included, makes the review stale, and `todo` lists the slot. A change to `SLOT_REVIEW_VERSION` (in `scores.ts`) also makes every review stale. Bump it when a prompt, a weight, a cap or the gate changes.

## 4. What it can't know yet

- **No team calibration.** The weights and anchors come from `docs/SLOTS.md` §5 and the Originals lessons, not from team ratings of slots. The Originals evaluator reached ρ 0.69 / MAE 0.58 only after team reviews. Until the team rates slots, treat the slot gate as a filter for the plainly unreadable, mis-tuned, reskinned or dull. It can't rank slots that pass.
- **Motion and sound.** The player sees still screenshots at fixed waits. It can't feel the following, which is much of a slot's excitement:
  - the reel stop rhythm;
  - an anticipation slow-down (it may catch one mid-way);
  - the count-up;
  - audio (there is none yet).

  On the Originals, Cross was over-rated because fast sequences didn't show in screenshots. Expect the same kind of miss here.
- **Long-session feel.** 60 spins is a short session. Volatility, dry streaks and how often the feature comes are judged from the measured facts (maths fit), not from what the panel saw. The forced feature also shows the feature without the wait that makes it feel earned.
- **AI boredom.** A model may find every slot equally dull, or be polite. The fun anchor asks what a real player would do and lists concrete signals. How well that works is unknown until the team rates slots.
- **Text the sandbox hides.** Rules of 9+ words are invisible to the panel, by design. A slot whose paytable explains the feature in one long sentence will score low on feature clarity even if a real player would read it. The fix is short lines in the kit and the game, not a softer sandbox.
- **The play tool depends on the kit's labels** (`LABELS` in `review-lib/play.ts`: Spin, Turbo, Autoplay / Start autoplay, How to play) and on `play.mjs`'s sandbox text, which `play-hook.mjs` rewrites. If either changes, `play` reports "the sandbox could not be set up" instead of failing silently. The clean fix is a `--query` flag and a slot sandbox in `play.mjs` itself.

## 5. Calibrating

Once the team rates slots (the same ratings the platform collects for Originals):
1. Compare the team mean (Pierre weighted 3×) with the AI overall on every rated slot. Report Spearman ρ, MAE and the gate flips: slots the AI kept that the team rates below 3, and the reverse.
2. From about 8 rated slots, fit the human mean on the nine scores (least squares, as `/refine-evaluator` does). Treat the fit as a hint for the weights, not a replacement.
3. Read the team's comments for patterns the scores miss, and turn each into anchor wording or a code rule, never a game-specific fact.
4. Team ratings, where they exist, decide over the AI (SLOTS.md §5), as for Originals.

## 6. Changing it safely (A/B)

Peter's rule: A/B any evaluator or pipeline change before it enters the pipeline.

1. **Choose a fixed set.** Use every rated slot, plus anchors built to fail one way each:
   - a reskin of a kept slot;
   - a slot whose rules are written only as long sentences;
   - a tight-hit-rate slot that misses the dry-streak limit;
   - a plain fruit slot with no feature payoff.

   Before team ratings exist, the anchors and the expected order are the only ground truth.
2. **Run both arms fresh** on the same code (same `codeHash`). Arm A is the current prompts. Arm B is the change, in a separate worktree, or with `SLOT_REVIEW_WORK` pointing at a scratch folder so the arms' working files don't mix. Run a full panel of 3 in each arm, because single plays are noisy (about ±1 on a score). Use `score --dry-run` so no `slot-review.json` is written.
3. **Compare.** Compare ρ and MAE against team ratings (when they exist), whether the anchors still fail for the right reason, and which slots flip the gate. Reject a change that fixes one case and breaks another.
4. **Adopt.** Bump `SLOT_REVIEW_VERSION`, note the change and its A/B numbers at the top of `review-lib/scores.ts` or the prompt file, and say in the commit which slots will show as stale.

## 7. Testing the plumbing

- `npx vitest run scripts/slots/review-lib` tests:
  - the weights, both caps, the gate conditions and the panel band;
  - the medians and grades;
  - the §3 bands and their widths, including the dry-streak limits by volatility;
  - the facts reader;
  - the step expansion and session checks;
  - the trademark patterns.
- **Dry run on a fixture,** without touching `games/` or `.evaluator/`: point `SLOT_REVIEW_GAMES_DIR` at a folder of fake games and `SLOT_REVIEW_WORK` at a scratch folder. Then run `todo`, `prepare`, `player-prompt`, `judge-prompt` and `score --dry-run`, writing the subagents' JSON by hand. `play` needs a real game under `games/`, because `play.mjs` serves it with Vite.
