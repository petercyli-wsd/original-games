# Original Games

A platform for hosting casino "Originals": simple, fast, single-player games with player-adjustable volatility. Each game lives in its own folder under `games/`, and the platform finds it automatically.

```
original-games/
├── apps/platform/        Lobby + game shell (Vite, React, React Router)
├── apps/api/             Ratings API (Node + Postgres), deployed as its own Render service
├── packages/game-sdk/    The contract between platform and games, plus shared helpers
├── games/
│   ├── template/            Reference game ("Arc Climb"), copied by `npm run new-game`
│   ├── crocodile-dentist/   Croc Dentist (vs House)
│   ├── croc-dentist-solo/   Croc Dentist (Solo), reuses the croc from crocodile-dentist
│   └── <id>/                One folder per game
├── scripts/              eval runner, new-game scaffolder, headless play driver, report
├── docs/IDEAS.md         Concept backlog + eval rubric
├── docs/CATALOGUE.md     Maths-first batch: theorem → game specs, uniqueness, results
├── docs/BUILDING-GAMES.md   The build and pricing contract for kit-based games
└── render.yaml           Render Blueprint (one static site)
```

## Quick start

```bash
npm install
npm run dev          # platform at http://localhost:5173
npm run check        # typecheck + tests + evals
npm run build        # apps/platform/dist
```

## How games plug in

A game is an npm workspace in `games/<id>/` with three entry files:

| File | Exports | Loaded |
|---|---|---|
| `src/manifest.ts` | `defineManifest({...})`: name, mechanic, RTP, max multiplier, volatility levels, accent colour | At startup, for the lobby. Keep it tiny. |
| `src/index.ts` | A `GameModule`: `mount(target, host) => unmount` | Lazily, as its own chunk, when the game is opened |
| `src/eval.ts` | `defineEval({ configs, playRound })`, a Monte Carlo player | By `npm run eval` and CI |

The platform finds games with `import.meta.glob`, so you don't register them anywhere. The folder name must match `manifest.id`. Invalid manifests are logged and skipped, so they never break the lobby.

**The host** (`HostContext`) is all a game gets from the platform:

- `wallet`: `placeBet(amount) → ticket`, then `ticket.settle(multiplier)`. Async, so the demo wallet can later be swapped for a server-side RGS wallet without touching any game.
- `rng`: `next()`, `int(n)`, `shuffle()`. Swap in a provably-fair source in one place.
- `settings`: a store for global settings such as turbo.
- `track(event)`: send `checkpoint` events. Bets and settlements are recorded automatically, which feeds the per-game session stats panel (observed RTP, hit rate, average round time).

**Isolation:** each game mounts inside its own shadow root. Game CSS can't leak into the platform or other games, and a game that crashes shows an error inside its frame instead of taking the site down. In game CSS, use `:host` instead of `:root`.

**Theme:** the platform's `--og-*` design tokens (`apps/platform/src/styles/theme.css`) pass through the shadow root, so games that use `var(--og-green)`, `var(--og-bg-card)` and the rest match the site automatically. Add fallbacks so the game still looks right when run standalone.

**React** games wrap a component with `defineReactGame(Component, { styles })` and use `useHost()`, `useBalance()` and `useSettings()`. Non-React games implement `mount()` directly (canvas, Pixi, vanilla).

## Adding a game

```bash
npm run new-game -- drift "Drift"
npm install
npm run dev -w @originals/drift    # standalone, with a demo wallet
npm run dev                        # inside the platform at /play/drift
```

Then replace `math.ts`, `eval.ts` and `Game.tsx`. Every game should:

1. Keep the payout maths in pure functions (`math.ts`) with a test showing every cash-out point is worth exactly the RTP.
2. Ship an `eval.ts` whose simulated player samples strategies (e.g. a random cash-out step). `npm run eval` fails CI if the measured RTP is more than 4 standard errors from the manifest RTP, or a payout exceeds `maxMultiplier`.
3. Set `status`: `prototype` games appear under **Experimental**, and `beta` and `live` under **Core**. `template` games show only in dev, or in production when `VITE_SHOW_TEMPLATES=true`.

### The shared UI kit

`@originals/game-sdk/ui` gives React games the house template (controls on the left, board on the right, board first on narrow frames) and a single round flow: idle → live → over, where over offers **Bet again** (Space) or **Clear board** (Esc), and changing a setting clears a finished board back to a preview. It provides `GameLayout`, `BetField`, `Chips`, `Slider`, `Readouts`, `ChanceBar`, `StageTop`, `Board`, `InfoModal`, plus hooks for the bet input, the ticket (which settles at the resolved value if the player leaves mid-step), hotkeys, turbo, timers and history. Pass `kitStyles + styles` to `defineReactGame`. `games/half-moon` is the reference; `docs/BUILDING-GAMES.md` is the contract.

### Checking a game end to end

```bash
npx tsx scripts/eval.ts --game <id>                     # Monte Carlo RTP per config
node scripts/play.mjs <id> --steps "shot:idle;text:Bet;wait:1500;shot:live;key:c;wait:800;shot:over"
npx tsx scripts/report.ts                               # markdown results table for every game
node scripts/commit-game.mjs <id> "message"             # commit one game folder (safe in parallel)
```

`play.mjs` starts the game's standalone server, drives it in headless Chrome over the DevTools protocol (click by text or selector, keys, waits, screenshots, viewport sizes) and exits non-zero on any console error.

## Reviews and the AI evaluator

**Team reviews.** Each game can be rated 1–5 stars with an optional written review (pros and cons) and name. Averages show on lobby tiles and the Rankings page; full reviews sit under each game. Reviews are anonymous by default: each browser keeps one review per game, which it can change.

**AI reviews** score each game against the Originals brief in two stages:

1. **Rules card**: read the game's source and write a factual card (concept, win condition, how odds appear, volatility controls, checkpoints, maths). Cached per code version.
2. **Judge**: score nine criteria from 1 to 5 (odds on screen, clear win condition, simplicity, uniqueness, volatility control, checkpoints, pace, fun, geometry-first) from the card, the measured facts and a catalogue of every other game (for reskin detection). The overall score is a weighted mean computed in code.

Facts a machine can measure (RTP, volatility spread ≥ 5×, round length, checkpoints) are computed from Monte Carlo evals, not judged.

### Running reviews from Claude Code (the default)

Reviews run in a Claude Code session on the team's subscription; results are stored through the API in Neon and show on the site like any other review.

1. Add to `.env.local` at the repo root (git-ignored):
   ```
   ORIGINALS_API_URL=https://<your-api>.onrender.com
   ORIGINALS_ADMIN_KEY=<the ADMIN_KEY set on the API service>
   ```
2. In Claude Code at the repo root:

| Skill | What it does |
|---|---|
| `/review-game drift slice` | Reviews specific games |
| `/review-games` | Reviews every game that's new or changed since its last review (`/review-games all` for everything), in parallel |
| `/refine-evaluator` | Proposes a better prompt from the team's reviews, backtests it, and recommends whether to promote |

Each judgement runs in its own subagent that sees only its prompt file, so the judge scores from the rules card and facts, never from the code. The skills drive `npm run evaluator` (`scripts/evaluator.ts`), which builds prompts with the same code the API uses and validates every result before storing it. Working files go to `.evaluator/` (git-ignored).

### How the prompt is calibrated

Not every reviewed game goes into the prompt. Showing all of them would bloat the context, anchor the judge on near-duplicates, and leak the answer during backtests. Instead:

- **The rubric does most of the calibration.** Each criterion defines what a 1, a 3 and a 5 look like. The judge writes its reasoning before each score, scores criteria independently, and the weighted overall is computed in code rather than guessed holistically.
- **At most 6 reference games per review, chosen per game:** the team's highest- and lowest-rated games (to pin the scale), the refiner's curated exemplars, then the most similar reviewed games (same mechanic, dynamics or closest known games). Each comes with a one-line description and up to two review comments.
- **Leave-one-out.** A game is never shown its own reviews.
- **Train/holdout split.** About 30% of reviewed games are held out by a fixed hash. The refiner learns only from train games; versions are compared on holdout agreement (Spearman ρ and average gap in stars), which shows whether a change generalises rather than memorises.
- **Anchors.** Proven games (Russian roulette, Mines, Crash, Dice) must score ≥ 3.6 and known-bad concepts (a Mines reskin, a theme-dependent concept, an unintuitive maths game) ≤ 2.6. They are never shown as examples, so they stay a fair test.
- **The refiner writes principles, not verdicts.** It may change weights, score descriptions, guidance (capped at 350 words, consolidated rather than appended) and up to 4 curated exemplars, and it gets a least-squares weight fit as a hint. Nothing goes live until someone promotes it.
- **Cache-friendly layout.** The rubric and catalogue form a stable system prompt; per-game references and facts go in the user message.

### Training loop

1. The team plays games and writes reviews (score plus pros and cons).
2. `/review-games` reviews new or changed games.
3. `/refine-evaluator` proposes a candidate prompt and backtests it on train and holdout games plus anchors.
4. Promote the candidate (from Claude Code or the site's Evaluator page) if holdout agreement improves and the anchors pass. Every review records the prompt version it used.

### In-app reviews (in development, off by default)

The site can also run reviews through the billed Anthropic API. This is behind a feature flag: set `IN_APP_AI_REVIEWS=true` and `ANTHROPIC_API_KEY` on the API service to show the run buttons on the site. With the flag off, the site still shows every stored review, the agreement table and prompt versions, and can promote versions.

### API

`apps/api` is plain Node + Postgres (Neon's free tier). `npm run build -w @originals/api` first runs `scripts/evidence.ts`, which packs each game's manifest, gameplay source and eval stats into `apps/api/evidence/`. Environment:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string; in-memory if unset |
| `ADMIN_KEY` | Passphrase for anything that writes evaluator data (Claude Code imports, promote, in-app runs) |
| `CORS_ORIGINS` | The site's URL, or `*` |
| `IN_APP_AI_REVIEWS` | `true` to enable in-app reviews (in development) |
| `ANTHROPIC_API_KEY` | Only used when `IN_APP_AI_REVIEWS` is on |

The site reads the API's address from `VITE_RATINGS_API_URL` at build time; if it's unset, reviews and the evaluator are hidden. Locally: `npm run dev:api` (in-memory, port 8787) alongside `npm run dev`.

## Deploying (Render)

`render.yaml` defines a single static site. In Render, choose **New → Blueprint** and select this repo. Each deploy runs typecheck and tests before building, and PR previews are on. SPA rewrites make `/play/<id>` deep links work.

The demo wallet and RNG run in the browser. For real money, put a server wallet and a provably-fair RNG behind the same `Wallet` and `Rng` interfaces.
