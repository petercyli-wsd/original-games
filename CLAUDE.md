# Originals: working notes for Claude

Maths-first casino mini-games ("Originals"), a lobby site, and an AI evaluator that reviews them. Monorepo: `games/<id>` (one workspace per game), `packages/game-sdk` (kit, RNG, wallet, UI), `apps/platform` (lobby site), `apps/api` (ratings + evaluator), `scripts/`, `docs/`, `.claude/skills/`. Render deploys the site and the API from `main` and builds a preview for every PR. Node 22 (`.nvmrc`).

- **Live site:** https://octane-original-games.onrender.com/ (Render static site, deploys from `main`).
- **Live API:** https://original-games.onrender.com (= `ORIGINALS_API_URL` in `.env.local`). `originals-api.onrender.com` is **not** ours.
- **Verify a deploy** instead of assuming it: fetch the site's `index.html`, then its `assets/*.js` chunks, and grep for a string only the new commit adds (the kit CSS is in `assets/styles-*.js`). The API's `GET /evaluations` marks reviews `stale` against the code it was built from, which shows the API's deploy too. Only call a change done once it is live.

Read before changing things:

| Doing | Read first |
|---|---|
| Building or changing a game | `docs/BUILDING-GAMES.md` (maths and UI contract, checks) |
| Its look | `docs/STYLE.md` (§6 is the odds standard) |
| A casino classic (Stake/Roobet/BC.Game replica) | `docs/CLASSICS.md` (specs per classic, which original it matches) |
| Choosing or judging concepts | `docs/DESIGN-RULES.md`, `docs/CATALOGUE.md` (roster, rejected ideas, archive reasons, batch results) |
| Search results | `docs/SEARCH.md`, ledger `.evaluator/_search/ledger.md` in the main checkout |

## The wider project: slots + Originals

Online casinos run on two kinds of in-house content: **slots** and **Originals**. This repo is the Originals half. Related material on Peter's machine (`/Users/petercyli-wsd/Dev/`):

| Folder | What it is | Relation to this repo |
|---|---|---|
| `slot-math-engine-pack` | The manager's **Slot Math engine pack v1.0.0** (Python 3.12, not a git repo; built 2026-10-01 from Slot Math commit `8c46f01dbafb`). A base-round reel engine (payline, ways/megaways, scatter, cluster, static grid, hold-and-spin) and a generic bonus engine (`bonus_spec_v1`), restricted to verified scope: `enginepack.base.build` refuses anything outside it, by name. Spins are deterministic integer JSON per seed; `base.analytics` gives RTP with a tier (`exact`, `exact_mixture`, `mc` + se, n); `composability` says which mechanic families combine (96 of 97 families, 16,456 verified pair cells, 133 example games). | Not used by this repo yet. It is the slot side of the project. Start with its `README.md`, `AGENTS.md` (ground rules: build only through `enginepack`, never edit the vendored engines, report RTP with its tier) and `python tools/verify_pack.py`. Our own slots (`reels`; archived `wild-double`, `holdfast`) are hand-built in TypeScript, not on this engine. |
| `foundry-eval-kit` | The manager's play-to-learn clarity eval, from the "Octane Originals Foundry" (not a git repo). A blind Claude player sees screenshots and button labels in an MCP arena; code scores its stated odds and a picture quiz against the game's maths (LLM grading capped at 5/100). The Foundry's generator (genome breeding, MAP-Elites) is not included. | Doesn't plug in as is: games mount in an open shadow root (`packages/game-sdk/src/mount.ts`) and the kit uses plain `document.querySelector`. It fits single-reveal and cash-out ladders only, not per-step choices or live crash. Peter's preference: don't bring it up unless it's directly relevant. |
| `octane-rgs`, `frontend`, `octane-iac`, `octane-tools` | The company's live-casino stack (remote gaming server with wallets and provably fair RNG, a Next.js live-dealer frontend, OpenTofu infrastructure). | Where Originals would plug in as a game provider for real money. Today Originals run client-side in a demo wallet; see "Known limit" in the maths contract. |

## How Peter works (follow these)

- **Reports.** Concise and precise. Say the exact mechanic ("the cash-out paid the pre-draw value when you left within one render"), not abstract verbs. Lead with the answer, give numbers, and flag what is uncertain.
- **Test before adopting.** A/B any evaluator or pipeline change before it enters the pipeline. Use the local harness, both arms run fresh, report ρ, MAE and the games that flipped. Reject changes that fix one case and break another.
- **Commit and push only when asked.** A brief or prompt that says to commit counts.
  - Commit one game per commit with `node scripts/commit-game.mjs <id> "msg"`, ending with the attribution line.
  - Never push `main` directly or force-push. Work on a branch and open a PR.
  - **Merging (Peter, 2026-11-12):** Claude may merge its own PR with `gh pr merge <n> --merge` once its CI check passes (`gh pr checks <n> --watch && gh pr merge …`, never merge on a red or pending check). Then confirm it is live.
  - **One exception (Peter, 2026-11-12):** at the end of each cycle the `/search-games` loop fast-forwards `main` to `search` so the games it kept go live.
  - `gh` may need `gh auth login`. If it's missing, give the `/pull/new/<branch>` link plus a PR body file.
- **Production API writes only when Peter says so:** creating or promoting evaluator versions, `submit`/`submit --pending` outside the loop's exception, any POST/PUT. **One exception (Peter, 2026-11-12):** the `/search-games` loop publishes the AI review (`submit <id>`) of the games it kept that cycle, and only those. Reading the API is fine. Never print `ORIGINALS_ADMIN_KEY` (in `.env.local`).
- **Keep history.** Never delete team reviews. Retired games go to the Archive (status `retired`), not the bin; delete only builds that never shipped. Mark lobby changes with the manifest `revision`: `new` / `improved` + a note.
- **Ask before big runs.** More than 6 builds, or anything that fans out many Opus agents. The org's monthly spend limit has been hit more than once; when it hits, subagents fail with a rate-limit error and can be resumed with SendMessage after it resets.
- **Subagent models:**
  - building and repairs: `sonnet`;
  - concepts, screening, research, maths audits, and the evaluator's three roles (rules card, blind player, designer): `opus`. The evaluator is calibrated on Opus.
- **Parallel sessions.** Each long session owns one checkout. Never switch branches or commit in a checkout another session is using; use a worktree instead. Sessions can message each other (ListAgents / SendMessage) to coordinate.
- **Shell.** Use Edit/Write or a script file for code edits, not sed or heredocs. zsh doesn't word-split `$IDS`: write ids out or use `${=IDS}`.

## Commands

```bash
npm run typecheck && npm test && npm run build      # what the Render build and CI run
npx tsc --noEmit -p games/<id>
npx vitest run games/<id>                           # math.test.ts + fairness.test.ts
npx tsx scripts/eval.ts --game <id> --rounds 100000 # RTP per config, p99 steps
node scripts/play.mjs <id> --out <dir> --steps "..." [--size 420x900] [--blind]  # headless screenshots; open every PNG
node scripts/fork-game.mjs <id> [--keep]            # copy to <id>-v2; without --keep, archives the original
npm install --package-lock-only --ignore-scripts    # after adding or removing a game (the deploy's npm ci needs it)
```

**New worktree:** `git worktree add --detach ../<name> origin/main` (or `-b <branch>`), copy `.env.local` (never print it), `npm ci --ignore-scripts`. Without `.evaluator/_local` it is in API mode: `submit` posts live. After the move from Windows to Mac, old worktrees needed `git worktree repair <path>` and `git worktree prune`.

**Evaluator CLI** (`npm run evaluator -- ...`, plumbing for the skills):
- `todo` (never-reviewed and stale games);
- `prepare <id>` (evidence + rules-card prompt, or a cached card);
- `player-prompt <id> [--players 3] [--more]` (fresh aliases; `--players 2 --more` widens a single play to a panel of 3);
- `play <alias> "<steps>"`;
- `judge-prompt <id>` (run it only after every player has written `player.json`);
- `preview <id>` (scores locally and applies the keep gate);
- `gate <ids>`;
- `review <id>` (latest AI and team reviews);
- `submit <ids> --model claude-code`;
- `submit --pending` (flushes every queued id: never run it blindly).

**Local mode** (the file `.evaluator/_local` exists): prompts are built from this checkout under the cached `.evaluator/_active-version.json`, and `submit` only queues to `.evaluator/_pending.json`. `.evaluator/` is git-ignored and per checkout. `submit` posts only when the API is reachable **and** `_local` is absent; to publish specific ids from a local-mode checkout, move `_local` aside for one `submit <ids>` and put it back.

**Reviewing after a change:** set the manifest `revision` *before* the first `prepare` (any later edit to `games/<id>`, manifest included, makes the review stale). After a repair, re-run `prepare` (new card) and `player-prompt` (fresh aliases); never reuse the old panel. Before submitting, check that `.evaluator/<id>/evidence.json`'s `codeHash` matches the current code.

**API reads:** `GET /evaluations` (per game: overall, codeHash, recommendation, facets, stale, createdAt; no version field), `GET /ratings` (team averages and facets), `GET /reviews` (recent team reviews).

**Skills:**

| Skill | What it's for |
|---|---|
| `/review-game` | Review one game with the evaluator |
| `/review-games` | Review every new or changed game |
| `/generate-games` | Build a batch of new games |
| `/iterate-game` | Improve failing games, up to 2 rounds |
| `/refine-evaluator` | Improve the evaluator from team reviews |
| `/search-games` | One unattended search cycle; run it as `/loop /search-games cycles-per-day=2 builds=3`. On branch `search` in the main checkout. Rules in `.claude/skills/search-games/SKILL.md`; `team-feed.mjs` often times out at its 30 s API fetch, and retrying works. |

## The maths contract (non-negotiable)

- **The cash-out is a martingale.** It is fair value = RTP × E[final payout | what's shown], starting at RTP (0.99 unless the classic's rules say otherwise; a classic replica uses the RTP its published payout table implies, e.g. 98% for Stake's Chicken, Darts, Cases, Tarot). Then, by optional stopping, no strategy beats RTP. Never compound the edge per step.
- **Three pricing patterns:**
  - a fixed prize × exact P(win | state);
  - a per-step factor 1/(1 − q);
  - staged reveals.
- **Exact pricing only.** No Monte Carlo pricing.
- **Player choices are value-neutral.** Relock at value / P(new choice). (Blind players find the relock confusing: last-wicket, bank-it.)
- **Max-win cap.** Auto-cash before a step that would exceed `MAX_WIN`.
- **RNG.** Only `useHost().rng` or the passed `rng`. It's crypto 32-bit underneath (audited: uniform, unbiased, no correlation). Never `Math.random`.
- **Fairness rules from the November 2026 audit** (all 114 games; 82 had UI-flow holes, while the pricing maths was exact everywhere):
  - draw an outcome only after `await ticket.place()` succeeds;
  - `useTicket`'s `fairValue` reads a **ref** set in the same handler that places the bet or draws an outcome, never rendered state, which lags one render;
  - guard actions against double presses with a ref;
  - disable Cash out while a drawn result animates;
  - nothing that prices the game (RTP, paytable, board size) is player-editable;
  - round the house's way.
- **Fairness test.** Every game with a cash-out or multi-step decision has a `fairness.test.ts`. It checks the martingale at 30+ states and plays hostile strategies, each within 4 SE of RTP:
  - act only when the next step is ≥ 80% safe;
  - take any profit;
  - play to the end;
  - the game's strongest strategy.
- **"I can beat it" / "the odds feel wrong" reports.** Check the z-score before anything else, then simulate the exact strategy with the game's own functions, or play it in the browser and count. Usual causes: frequent small wins plus rare total losses (Convex's "drop only at ≥ 80%" returns 99.01% ± 0.04% over 1M rounds); heavy tails (Core read 63% RTP on a small sample, |z| ≤ 1.5 at 200k rounds; Overhang's 88–93% readings are inside 1.7 SE); per-step vs per-round chance (Last Wicket's Block is out 1 ball in 12, measured 36/353 in the browser, but a 7-ball chase on Block alone ends out about 46% of the time, and late in a chase Block is disabled so you must Swing at 1 in 3).
- **Known limit.** Hidden outcomes (blackjack hole card, Doors, Shells, Loops) live in client state and are readable in DevTools. Real money needs server-side outcomes (the RGS).
- **Craps.** Keeps real casino odds (0% edge on free odds, up to 10×): Peter's decision.

## UI rules (beyond `docs/STYLE.md`)

- **Every lobby game uses the kit layout** (`GameLayout`, `BetField`, `Chips`, `ActionButton`, `PanelFoot`, `StageTop`, `Readouts`/`ChanceBar`, `RoundOver`, `Caption`), so labels, number formats and buttons match. Since PR #6 (2026-11-13) no lobby game renders its own panel. Audit: the three greps in STYLE.md §10 must be clean for every non-retired game.
- **Next-step button above Cash out.** Mid-round, the button that continues the round sits where Bet was and Cash out goes under it, so pressing the same spot keeps going. The kit does it in CSS for an adjacent `ActionButton kind="cash"` + `kind="secondary"` pair; a game that wraps its next buttons in a `<div>` must render them before Cash out itself.
- **Odds standard (STYLE.md §6).** Every game shows one chance number by default plus a picture of the odds. An operator can set `VITE_ODDS_READOUT=off` to hide the number (never the picture) in **ladder** and **paytable** games only; input-chance, choice, timing, table and skill games always show it. Groups live in `apps/platform/src/oddsPolicy.ts`: **add every new game there** (unknown games default to showing the number). Why: Stake and Roobet show a probability only where the bet needs it (Dice, Limbo, HiLo's buttons) and leave it implied by the multiplier elsewhere (Mines, Chicken); we keep their reasons for choosing the number but not the hiding, because the evaluator weights odds legibility ×3.

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
- **Panel:** 3 blind players (median per score, majority on checks) only when the overall is in 3.25–3.75 (exactly 3.75 counts as in the band). Single plays are noisy, roughly ±1 on a facet; the designer's uniqueness call can move a game by a whole point between runs (maze 3.75 → 3.00).
- **Ground truth:** the team mean, Pierre weighted 3×. Anonymous reviews count 1×, so ask reviewers to fill in their name. Live agreement was ρ 0.69 / MAE 0.58 on 24 rated games (Nov 2026).
- **What it can and can't do:** it **filters** well (team-2 games score ≤ 2.5 or get capped) but **can't rank** among passes. About 20 games sit at exactly 3.75, which the team rates 2.5–4.5. The gate may read a little high at the bottom of what it passes (banker passed at 3.56, team 2 stars). So the AI filters and the team ranks. Don't optimise AI scores past the gate.
- **Known misses:**
  - Halo 3.61 vs team 2.25;
  - Cross 3.75 vs 2.5 (fast sequences the screenshots don't show);
  - Bracket 3.00 vs 4.0 and Penney 3.20 vs 4.0. Dead structure over-fires on tournaments; a wording fix was A/B'd and rejected because it also cleared Spanning.
- **What sinks builds** (see DESIGN-RULES.md): a win chance that moves with no visible cause on the board (piggyback, truel, fault, rope); a secondary bar that moves with the chance but not by the same amount, read as a second odds gauge (card-duel's sum bar); a faithful replica of a mechanism we already have, capped as a reskin (burrows ≈ tower, wild-double ≈ reels).
- **Team-derived build checks** (not evaluator rules):
  - `p99 steps` ≤ 30 per config: the team's 4-rated games are ≤ 24, while Drift reached 960;
  - each event can be followed, and the last result stays marked;
  - nothing on the board is removable;
  - one decision type, with no mid-round switching unless switching *is* the game.
- **The blind sandbox hides any element whose own text is 9+ space-separated tokens, and never shows it again** once hidden (a MutationObserver only hides). A status line that starts long stays invisible for the whole session; `=` and `·` count as words, and JSX splitting `{a}, {b}` into several text nodes adds tokens. Keep on-board text and status lines under 9 tokens, or render them as one template string. Board marks need a short key too (Pivot's red × on a waiting block means "if it joins next, you lose", and nothing on the board says so).
- **Reviews go stale when code changes,** including a manifest `status` or `revision` edit. If only metadata changed, point `evidence.json` at the current files and hash and resubmit. Local `review.json` can be from a rejected iteration round: check its hash before submitting.

## Lobby

- **Statuses:** `live` / `beta` / `prototype` / `retired` / `template`. Retired games sit in a folded Archive section and stay playable.
- **Badges:** New and Improved, from `revision`.
- **Collections:** `originals` and `classics` (casino classics and Stake/Roobet replicas, `docs/CLASSICS.md`).
- **Forking:** team-reviewed games are forked rather than edited, so their reviews stay attached to the version reviewed. Games without a team rating may be edited in place.

## Current state (2026-11-13; update this section as it changes)

| Branch / checkout | Owner | State |
|---|---|---|
| `main` | everyone, via PRs | November revamp (v7, gate, Archive); fairness audit (PR #2); restyle of 67 games to STYLE.md (PR #3); next-step button above Cash out (PR #4); Stake/Roobet parity batch + operator odds flag (PR #5); UI consistency for 9 games (PR #6); the search loop's 14 kept games. Live on the site. |
| main checkout `original-games`, branch `search` | the `/search-games` session | 10 cycles, 14 games kept: derby-v2, back-to-back, stepladder, inning, respins, seven-out, last-wicket, upsets, break-point, banker, bank-it, stepladder-v2, last-wicket-v2, card-duel. The team has rated 10 of them (about 3.4 on average; banker 2, respins/seven-out/break-point 3, others 4). The loop stops at 12 unrated kept games. |
| worktree `../original-games-restyle` | the restyle/parity session | Restyle: 66 of 67 lobby reviews submitted 2026-11-12. Held: **maze** (re-reviewed at 3.00 on a designer uniqueness call; its clarity is 4/4/4). Parity batch: chicken, snakes, darts, cases, tarot, plinko and range-dice now match Stake/Roobet and pass the gate; their up-to-date reviews are queued locally, **not submitted** (the live ones show stale). Five new replicas (burrows, booster, tile-pick, wild-double, holdfast) failed the gate twice and are archived. The 9 games changed in PR #6 need re-reviews. |
| worktree `../original-games-review` | the planning/audit session | Branch `revive-archive`, API mode: bringing gate-passing games back from the Archive (restyle to STYLE.md, fresh 3-player review, PR). Peter can remove it with `git worktree remove ../original-games-review` once that work is merged. |

Open items:
- Peter to decide: submit the 7 parity games' queued reviews; what to do with maze's 3.00 review.
- Re-review the 9 games changed in PR #6 (back-to-back, derby-v2, stepladder, stepladder-v2, crocodile-dentist, drift, overhang, slice, snowball).
- The team should rate the newer search games; the loop pauses at 12 unrated.
- **Back from the Archive (2026-11-13; rule: a game that passes the gate goes back in the lobby, no team vote needed).** Five retired games passed a 3-player panel. A returning game must first meet STYLE.md (archived games were never restyled), and the restyle changes code, so it gets a fresh 3-player review. Back: noughts 4.26, polarizer 3.63, quadrant 3.52. Shunt (3.37 → 3.43 → 2.65) and shells (3.44 → 3.00 → 3.31) failed after the restyle and two repair rounds, so they stay retired on their pre-restyle code; the reasons are in `docs/CATALOGUE.md` ("Back from the Archive"). Every never-reviewed game, retired ones included, got a v7 review on 2026-11-10 (38 games; 9 retired games are capped for dead structure: doors, last-light, loops, mediant, hamming, ramsey, condorcet, lasso, euler).
- Pivot: add a key for the red × on waiting blocks.
- Not built in the parity batch: Roobet Striker (rules unpublished), Roobet's 8-floor Towers (compounds the edge per floor), Slide and Drill (Limbo's mechanism).
- The slot engine pack is not wired into this repo; how slots and Originals share a platform (lobby, RGS) is undecided.
