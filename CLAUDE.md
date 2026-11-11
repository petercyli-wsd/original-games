# Originals: working notes for Claude

Maths-first casino mini-games ("Originals"), a lobby site, and an AI evaluator that reviews them. Monorepo: `games/<id>` (one workspace per game), `packages/game-sdk` (kit, RNG, wallet, UI), `apps/platform` (lobby site), `apps/api` (ratings + evaluator), `scripts/`, `docs/`, `.claude/skills/`. Render deploys the site and the API from `main` and builds a preview for every PR. Node 22 (`.nvmrc`).

Read before changing things:

| Doing | Read first |
|---|---|
| Building or changing a game | `docs/BUILDING-GAMES.md` (maths and UI contract, checks) |
| Its look | `docs/STYLE.md` (on `restyle` until merged) |
| Choosing or judging concepts | `docs/DESIGN-RULES.md`, `docs/CATALOGUE.md` (roster, rejected ideas, archive reasons) |
| Search results | `docs/SEARCH.md` (on `search`) |

## How Peter works (follow these)

- **Reports.** Concise and precise. Say the exact mechanic ("the cash-out paid the pre-draw value when you left within one render"), not abstract verbs. Lead with the answer, give numbers, and flag what is uncertain.
- **Test before adopting.** A/B any evaluator or pipeline change before it enters the pipeline. Use the local harness, both arms run fresh, report ρ, MAE and the games that flipped. Reject changes that fix one case and break another.
- **Commit and push only when asked.** A brief or prompt that says to commit counts.
  - Commit one game per commit with `node scripts/commit-game.mjs <id> "msg"`, ending with the attribution line.
  - Never push `main` or force-push. Work on a branch; Peter merges PRs.
  - `gh` may need `gh auth login`. If it's missing, give the `/pull/new/<branch>` link plus a PR body file.
- **Production API writes only when Peter says so:** creating or promoting evaluator versions, `submit --pending`, any POST/PUT. Reading the API is fine. Never print `ORIGINALS_ADMIN_KEY` (in `.env.local`).
- **Keep history.** Never delete team reviews. Retired games go to the Archive (status `retired`), not the bin; delete only builds that never shipped. Mark lobby changes with the manifest `revision`: `new` / `improved` + a note.
- **Ask before big runs.** More than 6 builds, or anything that fans out many Opus agents. The org's monthly spend limit has been hit once.
- **Subagent models:**
  - building and repairs: `sonnet`;
  - concepts, screening, maths audits, and the evaluator's three roles (rules card, blind player, designer): `opus`. The evaluator is calibrated on Opus.
- **Parallel sessions.** Each long session owns one checkout. Never switch branches or commit in a checkout another session is using; use a worktree instead.
- **Shell.** Use Edit/Write or a script file for code edits, not sed or heredocs.
- **Foundry eval kit.** Don't bring it up unless it's directly relevant.

## Commands

```bash
npm run typecheck && npm test && npm run build      # what the Render build runs
npx tsc --noEmit -p games/<id>
npx vitest run games/<id>                           # math.test.ts + fairness.test.ts
npx tsx scripts/eval.ts --game <id> --rounds 100000 # RTP per config, p99 steps
node scripts/play.mjs <id> --out <dir> --steps "..." # headless screenshots; open every PNG
node scripts/fork-game.mjs <id> [--keep]            # copy to <id>-v2; without --keep, archives the original
npm install --package-lock-only --ignore-scripts    # after adding or removing a game (the deploy's npm ci needs it)
```

**Evaluator CLI** (`npm run evaluator -- ...`, plumbing for the skills):
- `prepare`;
- `player-prompt <id> [--players 3] [--more]`;
- `play <alias> "<steps>"`;
- `judge-prompt`;
- `preview <id>` (scores locally and applies the keep gate);
- `gate <ids>`;
- `review <id>` (latest AI and team reviews);
- `submit <ids> --model claude-code`;
- `submit --pending`.

**Local mode** (the file `.evaluator/_local` exists): prompts are built from this checkout under the cached `.evaluator/_active-version.json`, and `submit` only queues to `.evaluator/_pending.json`. `.evaluator/` is git-ignored and per checkout.

**Skills:**

| Skill | What it's for |
|---|---|
| `/review-game` | Review one game with the evaluator |
| `/review-games` | Review every new or changed game |
| `/generate-games` | Build a batch of new games |
| `/iterate-game` | Improve failing games, up to 2 rounds |
| `/refine-evaluator` | Improve the evaluator from team reviews |
| `/search-games` | One unattended search cycle; run it as `/loop /search-games cycles-per-day=2 builds=3`. On branch `search`. |

## The maths contract (non-negotiable)

- **The cash-out is a martingale.** It is fair value = RTP × E[final payout | what's shown], starting at RTP (0.99 unless the classic's rules say otherwise). Then, by optional stopping, no strategy beats RTP.
- **Three pricing patterns:**
  - a fixed prize × exact P(win | state);
  - a per-step factor 1/(1 − q);
  - staged reveals.
- **Exact pricing only.** No Monte Carlo pricing.
- **Player choices are value-neutral.** Relock at value / P(new choice).
- **Max-win cap.** Auto-cash before a step that would exceed `MAX_WIN`.
- **RNG.** Only `useHost().rng` or the passed `rng`. It's crypto 32-bit underneath (audited: uniform, unbiased, no correlation). Never `Math.random`.
- **Fairness rules from the November 2026 audit** (all 114 games; 82 had UI-flow holes, while the pricing maths was exact everywhere):
  - draw an outcome only after `await ticket.place()` succeeds;
  - `useTicket`'s `fairValue` reads a **ref** set in the same handler that places the bet or draws an outcome, never rendered state, which lags one render;
  - guard actions against double presses with a ref;
  - disable Cash out while a drawn result animates;
  - nothing that prices the game (RTP, paytable, board size) is player-editable;
  - round the house's way.
- **Fairness test.** Every game has a `fairness.test.ts`. It checks the martingale at 30+ states and plays hostile strategies, each within 4 SE of RTP:
  - act only when the next step is ≥ 80% safe;
  - take any profit;
  - play to the end;
  - the game's strongest strategy.
- **"I can beat it" reports.** Answer with a simulation of the exact strategy using the game's own functions. The usual cause is frequent small wins plus rare total losses (Convex's "drop only at ≥ 80%" returns 99.01% ± 0.04% over 1M rounds).
- **Known limit.** Hidden outcomes (blackjack hole card, Doors, Shells, Loops) live in client state and are readable in DevTools. Real money needs server-side outcomes.
- **Craps.** Keeps real casino odds (0% edge on free odds, up to 10×): Peter's decision.

## The evaluator (v7, live on the API)

- **Three isolated Opus roles:**
  - a rules card from the source;
  - a blind player that plays from screenshots under an alias, never told the game's name, with text of 9+ words hidden;
  - a designer that sees the card, measured facts and the player's review.
- **Code computes the overall:**
  - weights: win, simplicity and odds ×3; volatility and uniqueness ×1.5; fun ×0.75; checkpoints, pace and geometry ×0.25;
  - the clarity cap is 1.5 + 0.75 × the weakest clarity facet, so **one facet at 3 caps the overall at 3.75**;
  - dead structure "some" caps a prototype at 3.0; a reskin caps it at 2.25.
- **Keep gate:** overall ≥ 3.5, each clarity facet ≥ 3, no reskin, no dead structure. For a game the team has rated, the team's weighted average ≥ 3.5 decides instead.
- **Panel:** 3 blind players (median per score, majority on checks) only when the overall is in 3.25–3.75. Single plays are noisy, roughly ±1 on a facet.
- **Ground truth:** the team mean, Pierre weighted 3×. Anonymous reviews count 1×, so ask reviewers to fill in their name. Live agreement was ρ 0.69 / MAE 0.58 on 24 rated games (Nov 2026).
- **What it can and can't do:** it **filters** well (team-2 games score ≤ 2.5 or get capped) but **can't rank** among passes. About 20 games sit at exactly 3.75, which the team rates 2.5–4.5. So the AI filters and the team ranks. Don't optimise AI scores past the gate.
- **Known misses:**
  - Halo 3.61 vs team 2.25;
  - Cross 3.75 vs 2.5 (fast sequences the screenshots don't show);
  - Bracket 3.00 vs 4.0 and Penney 3.20 vs 4.0. Dead structure over-fires on tournaments; a wording fix was A/B'd and rejected because it also cleared Spanning.
- **Team-derived build checks** (not evaluator rules):
  - `p99 steps` ≤ 30 per config: the team's 4-rated games are ≤ 24, while Drift reached 960;
  - each event can be followed, and the last result stays marked;
  - nothing on the board is removable;
  - one decision type, with no mid-round switching unless switching *is* the game.
- **The blind sandbox hides any element whose own text is 9+ space-separated tokens, and never shows it again** once hidden (a MutationObserver only hides). A status line that starts long stays invisible for the whole session; `=` and `·` count as words, and JSX splitting `{a}, {b}` into several text nodes adds tokens. Keep on-board text and status lines under 9 tokens, or render them as one template string.
- **Reviews go stale when code changes,** including a manifest `status` edit. If only metadata changed, point `evidence.json` at the current files and hash and resubmit. Local `review.json` can be from a rejected iteration round: check its hash before submitting.

## Lobby

- **Statuses:** `live` / `beta` / `prototype` / `retired` / `template`. Retired games sit in a folded Archive section.
- **Badges:** New and Improved, from `revision`.
- **Forking:** team-reviewed games are forked rather than edited, so their reviews stay attached to the version reviewed.

## Current state (2026-11-11; update this section as it changes)

| Branch / checkout | State |
|---|---|
| `main` | The November revamp (v7, gate, Archive), plus the fairness audit (PR #2, all 114 games) and the restyle (PR #3: 67 games flattened to `docs/STYLE.md`), both merged 2026-11-11, plus the search loop's games. |
| `restyle` (worktree `../original-games-restyle`, merged) | Restyle result: every game that passed the gate before still passes (drift and cross fail only on their team ratings, as before). Mean clarity over the 29 regressed games is 3.977 vs 3.954 before; over all 67 it is 4.060 vs 3.970 live. STYLE.md §6 gained the unit-key rule (≤ 2 lines, < 9 tokens) and the numbered next-step cells exception (Tumble). All 67 local reviews match the merged code and sit in that worktree's `.evaluator/_pending.json`, **not submitted**: `submit --pending` from there only when Peter says so. |
| `search` (main checkout) | The `/search-games` loop. 2 cycles kept Derby v2, Back to Back and Stepladder (all unrated by the team). Ledger in `.evaluator/_search/ledger.md`. |

Open items:
- The team should rate the `docs/SEARCH.md` games; the loop stops at 12 unrated.
- About 80 live AI reviews are stale after the fairness and restyle merges; the restyle worktree's queued reviews replace them once submitted.
- Retired games mostly have no v7 review.
