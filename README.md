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

> **In development.** The in-app "Run AI review" and Refine buttons call the Anthropic API with a billed key (`ANTHROPIC_API_KEY`). The team's preferred path is moving to Claude Code on the subscription, with results still stored through the API in Neon. The rubric, prompts, storage and pages below are shared by both paths.

**AI reviews.** Claude (Opus 5.5) reviews each game against the Originals brief in two stages:

1. **Rules card**: it reads the game's source and writes a factual card (concept, win condition, how odds appear, volatility controls, checkpoints, maths). Cached per code version.
2. **Judge**: it scores nine criteria from 1 to 5 (odds on screen, clear win condition, simplicity, uniqueness, volatility control, checkpoints, pace, fun, geometry-first) from the card, the measured eval facts and a catalogue of every other game (for reskin detection). The overall score is a weighted mean.

Facts a machine can measure (RTP, volatility spread ≥ 5×, round length, checkpoints) are computed by `scripts/evidence.ts`, not judged.

**Training loop** (`/evaluator` page):

1. The team writes reviews.
2. **Refine** sends Claude the disagreements between AI and team scores, the review comments and a least-squares weight fit, and gets back a candidate prompt (weights, score descriptions, guidance, reference games).
3. The candidate is **backtested** automatically on the most-reviewed games plus calibration anchors (proven games like Mines and Russian roulette must score high, reskins like Frozen Lake low). The page shows rank agreement (Spearman) and average gap against the active prompt.
4. You **promote** it if it agrees with the team better. Every review records the prompt version it used.

**API** (`apps/api`): plain Node + Postgres (Neon's free tier). `npm run build -w @originals/api` first runs `scripts/evidence.ts`, which writes each game's manifest, gameplay source and eval stats to `apps/api/evidence/`, so the deployed API reviews exactly the code it was built from. Environment:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string; in-memory if unset |
| `ANTHROPIC_API_KEY` | Enables AI reviews |
| `ADMIN_KEY` | Passphrase the site sends for anything that calls Claude (reviews, refine, backtest, promote) |
| `CORS_ORIGINS` | The site's URL, or `*` |

The site reads the API's address from `VITE_RATINGS_API_URL` at build time; if it's unset, reviews and the evaluator are hidden. Locally: `npm run dev:api` (in-memory, port 8787) alongside `npm run dev`.

## Deploying (Render)

`render.yaml` defines a single static site. In Render, choose **New → Blueprint** and select this repo. Each deploy runs typecheck and tests before building, and PR previews are on. SPA rewrites make `/play/<id>` deep links work.

The demo wallet and RNG run in the browser. For real money, put a server wallet and a provably-fair RNG behind the same `Wallet` and `Rng` interfaces.
