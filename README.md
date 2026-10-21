# Original Games

A platform for hosting casino "Originals": simple, fast, single-player games with player-adjustable volatility. Each game lives in its own folder under `games/`, and the platform finds it automatically.

```
original-games/
├── apps/platform/        Lobby + game shell (Vite, React, React Router)
├── packages/game-sdk/    The contract between platform and games, plus shared helpers
├── games/
│   ├── template/         Reference game ("Arc Climb"), copied by `npm run new-game`
│   └── <id>/             One folder per game
├── scripts/              eval runner, new-game scaffolder
├── docs/IDEAS.md         Concept backlog + eval rubric
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

## Deploying (Render)

`render.yaml` defines a single static site. In Render, choose **New → Blueprint** and select this repo. Each deploy runs typecheck and tests before building, and PR previews are on. SPA rewrites make `/play/<id>` deep links work.

The demo wallet and RNG run in the browser. For real money, put a server wallet and a provably-fair RNG behind the same `Wallet` and `Rng` interfaces.

## Integrating Crocodile Dentist

`crocodile-dentist/` is still being built at the repo root (it's git-ignored for now). To integrate it:

1. Move it to `games/crocodile-dentist/`, drop its own lockfile, `node_modules`, `render.yaml`, and its React/Vite devDependencies (they now come from the root).
2. Add `manifest.ts`, an `index.ts` that wraps `App` with `defineReactGame`, and an `eval.ts` that drives its existing `buildLadder` maths.
3. Replace its local balance with `useBalance()` and `wallet.placeBet()`/`settle()`, its `crypto` RNG with `host.rng`, and its `:root` CSS variables with `:host` and the `--og-*` tokens.
4. Remove the `/crocodile-dentist/` line from `.gitignore`.
