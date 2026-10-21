# Building a kit-based Original

How the games in `docs/CATALOGUE.md` are built. `games/half-moon` is the reference implementation; copy its structure.

## Files

```
games/<id>/
  package.json        name "@originals/<id>" (copy from half-moon, rename)
  index.html          <title><Name> (standalone)</title>
  vite.config.ts      unchanged copy
  tsconfig.json       unchanged copy
  src/dev.ts          unchanged copy
  src/index.ts        defineReactGame(Game, { styles: kitStyles + styles })
  src/manifest.ts     id, name, tagline, mechanic, status 'prototype', rtp, maxMultiplier, volatility, checkpoints, accent
  src/math.ts         pure maths, no React, no DOM. Header comment explains the theorem and why pricing is fair
  src/eval.ts         defineEval: configs (one per volatility level) + playRound with a sampled strategy
  src/math.test.ts    vitest: exact formulas vs simulation, martingale property, odds-on-screen = true risk, runEval RTP
  src/Board.tsx       the SVG board (or several components)
  src/Game.tsx        state, flow and layout, using @originals/game-sdk/ui
  src/styles.css      board styles only; layout and panel come from the kit
```

No new npm dependencies. Do not run `npm install`; the root `node_modules` already resolves everything (`@originals/game-sdk`, React, Vite).

## The maths contract

**Pricing rule.** Every on-screen state S has a fair value

> cash-out(S) = RTP × E[final payout multiplier | S] with E[final payout | start] = 1,

so the cash-out is a martingale starting at RTP = 0.99. Then by optional stopping every strategy returns exactly RTP. Three patterns are allowed:

1. **Fixed prize.** A full win pays `prize = RTP / P(win)`; cash-out = `prize × P(win | S)`, with `P(win | S)` computed **exactly** (closed form, DP, exact enumeration).
2. **Per-step fair factor (ladders).** Surviving a step with bust chance q multiplies the cash-out by `1/(1−q)`. Steps with q = 0 are free. A step with q = 1 must never be offered: end the round instead (auto cash-out).
3. **Staged reveal.** A short sequence of reveals (2–4 stages), each a checkpoint priced with pattern 1.

**Player choices** (which edge, which door, switching, reveal order, window placement) must leave the cash-out value unchanged at the moment of choosing. A choice changes volatility, never EV. For example, when switching a held door, re-lock the prize at `value / P(new door)`.

**Max-win cap.** If per-step factors are unbounded (tiny safe regions), add a cap such as `MAX_WIN = 10_000`. Before a step, if surviving would push the cash-out above the cap, the round auto-cashes instead ("Max win reached"). This is a stopping rule, so RTP is unchanged. `manifest.maxMultiplier` must be an honest bound on any payout. The eval checks `max ≤ maxMultiplier`.

**Exactness.** No Monte Carlo pricing, ever. Numerical integration or tables are allowed only if the test suite checks them against closed forms to about 1e-6. Floating comparisons on boundaries need a stated tie rule.

**RNG.** All randomness comes from `host.rng` (`useHost().rng`); no `Math.random`. The outcome of an animated step is decided when the step starts. `useTicket(fairValue)` must then return the *resolved* value while the animation plays, so leaving mid-animation settles at the true result and the pre-step value can't be dodged.

**Volatility.** Offer controls that move P(win) over at least 25:1. The eval should have 3–4 configs labelled low / medium / high / extreme. Rubric: std-dev of the highest config ≥ 5× the lowest. Average steps per round should sit roughly between 1 and 15, with a checkpoint reached in at least half the rounds. If a process is long (cover times, many draws), checkpoint at meaningful events or in bursts.

**Eval strategies.** `playRound` should sample the player's behaviour: a random stopping step, a risk-threshold stop, play-to-the-end, and random choices when the game has choices. One strategy is not enough.

**Tests** (`math.test.ts`, keep under ~15 s total):

- The closed-form win probability matches a direct simulation of the raw process (4 standard errors).
- The martingale step: at random reachable states, E[cash-out after one step] equals the cash-out now (exactly, or to 1e-9).
- Whatever is drawn as "the odds" (a red arc, shaded area, lit count) equals the true risk, e.g. by sweeping positions.
- `runEval(evalSpec, { rounds: 50_000 })` is within 4 SE of the manifest RTP, and its max is ≤ `maxMultiplier`.

## The UI contract

Use `@originals/game-sdk/ui` (see `packages/game-sdk/src/ui`). Layout and round flow must match Half Moon:

- **Panel (left):** `BetField`, then the game's own controls (`Chips` / `Slider`, a `VolBadge` hint showing the current volatility level), a small `dl.og-stats` with "Chance to win" and "Prize" for the chosen settings, the action buttons, then `PanelFoot` (Turbo plus How to play).
- **Action buttons:** in idle it's **Bet**. While live at a checkpoint, it's **Cash out <amount>** (`kind="cash"`) plus a secondary that continues ("Drop next", "Flip", "Reveal x"…). When over, it's **Bet again**. Disable everything while an animation runs.
- **Stage:** `StageTop` (status pill plus history chips), `Readouts` (win chance with `tone: 'chance'`, cash out now with `'cash'`, prize or next step with `'prize'`), `Board` holding the SVG plus `RoundOver`, then a `ChanceBar` while live or a `Caption` when idle.
- **Round flow:** idle → live → over. Over shows `RoundOver` (`Bet again` re-bets the same settings; `Clear board` returns to idle). Controls are disabled while live. Changing any setting while over clears the board to an idle preview of the new settings. Hotkeys come from `useHotkeys({ space, cashOut }, !infoOpen)`: Space is the main action, C is cash out, and Esc (handled by RoundOver) clears.
- **Idle preview:** the board shows the settings (window, targets, initial geometry) so you can see the odds before betting.
- **Turbo** (`useTurbo()`) shortens every animation to ~25%.
- **InfoModal** sections, in order: Goal, How to play, Reading the odds, The maths (name the theorem and give the formula), Payouts and fairness.
- **Base skin is geometric.** Shapes, lines, dots and arcs; no themed illustration. Use the accent colour from the catalogue, plus `var(--red)` for risk, `var(--green)` for safe/win and `var(--gold)` for cash.
- **The board must show the odds as a literal quantity** wherever possible: an arc length, a shaded area, a count of lit cells, a bar. Label it.
- **Responsive.** The kit stacks the board above the panel in frames narrower than 760 px. SVGs use a `viewBox` and scale; nothing may overflow at 420 px wide.
- **Performance.** Each step's computation is under 50 ms. Precompute tables lazily and cache them by settings.

## Checking your game

Run from the repo root (`C:/Users/chengyuan.li_whitesw/Dev/original-games`):

```bash
npx tsc --noEmit -p games/<id>
npx vitest run games/<id>
npx tsx scripts/eval.ts --game <id> --rounds 100000
node scripts/play.mjs <id> --out <scratch-dir> --steps "shot:idle;text:Bet;wait:1500;shot:live;text:<continue label>;wait:1500;shot:checkpoint;key:c;wait:1200;shot:over;dump;key:Escape;wait:500;shot:cleared;size:420x900;wait:300;shot:mobile"
```

`play.mjs` exits 2 on any console error or exception. Open every PNG it writes (Read tool) and fix anything clipped, overlapping, unreadable or confusing. Also play a losing round and a full win (use `until:` / repeated steps), plus the over → change-setting → idle path.

## Committing

```bash
node scripts/commit-game.mjs <id> "Add <Name>: <one-line principle>"
```

It commits only `games/<id>` and retries while other agents hold the git lock. Never commit other paths and never run `git add .`.
