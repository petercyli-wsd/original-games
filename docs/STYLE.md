# Originals style

One look for every game: flat, quiet, and built around the board. A player should see the board, one number for the odds, one sentence of rules and the buttons, and nothing else competing for attention. When this file and `docs/BUILDING-GAMES.md` disagree about presentation, this file wins.

The tokens and shared pieces live in the kit (`packages/game-sdk/src/ui/styles.ts`). Use them; don't restate them in a game's CSS.

## 1. Colour

### Neutral palette

Every surface, line and piece of text comes from these tokens. They are defined on `:host` by `tokenStyles` (already included in `kitStyles`).

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0b0b0e` | Wells: inputs, chip tracks, empty cells |
| `--card` | `#121216` | The stage (board area) |
| `--raised` | `#18181d` | The panel, and any surface on the stage |
| `--hover` | `#24242b` | Hover, the selected chip, neutral fills on the board |
| `--line` | `#2b2b33` | Every border and divider (1px) |
| `--line-strong` | `#3d3d47` | Board outlines, secondary buttons |
| `--faint` | `#5f5f6a` | Inactive or spent marks on the board |
| `--muted` | `#9a9aa5` | Labels and secondary text |
| `--text` | `#ececf0` | Text, primary buttons, the player's neutral marks |

### Outcome colours (fixed)

| Token | Value | Means |
|---|---|---|
| `--win` | `#3ecf74` | Safe / win / the share of the board that wins |
| `--lose` | `#ef5b5b` | Risk / loss / the share of the board that loses |

They mean the same thing in every game and are used for nothing else: not for buttons, decoration or a third category. A result that returns part of the stake is neutral (`--text`). The legacy names `--green`, `--red` and `--gold` still resolve (to `--win`, `--lose` and `--text`) so old CSS doesn't break, but new code uses `--win` and `--lose`. There is no gold: cash is not a colour.

### Content colours (only when the rules name a colour)

Some games are *about* a colour: card suits, roulette's red, black and zero pockets, a bet called "Red" or "Green". There, and only there, use:

| Token | Value | Use |
|---|---|---|
| `--suit-red` | `#b8434a` | Hearts and diamonds, red pockets, a bet named Red |
| `--suit-green` | `#3d8f66` | The roulette zero, a bet named Green |
| `--bg` / `--hover` | | Black pockets, black suits on a dark ground |

Card faces are flat light rectangles (`--text`) with `--bg` ink for clubs and spades and `--suit-red` for hearts and diamonds: rank and suit as text, no pips art or card backs with sheen. These colours never mark a result; the result still uses `--win` / `--lose`.

### One accent per game

Each game picks exactly one accent from this list (also exported as `ACCENTS` from `@originals/game-sdk/ui`) and uses the same value in `GameLayout accent=…` and `manifest.accent`:

| Name | Value |
|---|---|
| blue | `#7b93ff` |
| violet | `#a78bfa` |
| sky | `#5ec4e6` |
| amber | `#e6b450` |
| pink | `#e879b9` |
| sand | `#c9b28f` |

The accent marks **the player's own thing**: their piece, pick, target or bet on the board. It also colours focus rings (the kit does that). It is not used for buttons, readouts, headings, borders or backgrounds. If a board needs to tell several things apart (players, bands, suits), use the accent for the player's one and neutrals (`--text`, `--muted`, `--faint`, `--hover`) for the rest, with shape, fill vs outline, or a label doing the distinguishing. Never more than three hues on screen: neutrals, the accent, win/lose (plus the content colours above, in the games whose rules name them).

## 2. Surfaces: flat

- No gradients (`linear-`, `radial-`, `conic-gradient`, SVG `<linearGradient>`/`<radialGradient>`), including on text, buttons, tracks and backgrounds.
- No glows or shadows: no `box-shadow`, `text-shadow`, `filter: drop-shadow`, SVG `<filter>`, `feGaussianBlur` or `feDropShadow`.
- No glassmorphism: no `backdrop-filter`, no translucent panels laid over the board. The info modal's backdrop is a plain dim (`rgb(0 0 0 / 0.6)`).
- No decorative borders, outlines around groups of controls, textures, patterns, grid backgrounds or hatching. A border is 1px `--line` (or `--line-strong`, or an outcome colour to mark a result) and only where it separates something.
- Radii: `--radius` (6px) for controls, `--radius-lg` (8px) for surfaces. Circles stay circles.
- No emoji, mascots, illustrations or skeuomorphic objects (3D dice, cars, gems, card backs with sheen). Pieces are geometric: dots, lines, arcs, squares, plain numerals. Card faces are a flat rectangle with the rank and suit as text.
- Opacity is for disabled controls (`0.4`) and spent marks; don't fade things in and out for atmosphere.

## 3. Type

The font is the site font (`--og-font`). Sizes come from the scale only:

| Token | Size | Use |
|---|---|---|
| `--fs-1` | 12px | Hints, history, small labels, readout labels |
| `--fs-2` | 14px | Body, buttons, the rule sentence |
| `--fs-3` | 16px | Inputs, board labels, primary buttons |
| `--fs-4` | 20px | Readout values |
| `--fs-5` | 28px | The round result |
| `--fs-6` | 44px | A game's one hero number, if it has one (crash multiplier, rolled value) |

Weights: 500 for body, 600 for labels, buttons and numbers, 700 only for a hero number or the round result. No 800/900, no letter-spaced display caps except the kit's small section labels. Numbers use `font-variant-numeric: tabular-nums`.

## 4. Spacing

`--sp-1` 4px, `--sp-2` 8px, `--sp-3` 12px, `--sp-4` 16px, `--sp-5` 24px, `--sp-6` 32px. Gaps, paddings and margins use these.

## 5. Layout

The kit's layout, unchanged in structure:

- **Panel (left, stacked under the board on narrow frames):** `ModeTabs` (if the game has Auto), `BetField`, the game's settings (`Chips` / `Slider` with a `Label`; the volatility, if shown, is the plain `VolBadge` word in the label's hint), then the action buttons, then `PanelFoot`. No stats block repeating the odds; at most one `dl.og-stats` line for something that appears nowhere else (e.g. the prize for the chosen settings).
- **Buttons:** one primary style (`Bet`, `Cash out <amount>`, `Bet again`: a light fill) and one secondary (outline) for "continue" actions. The kit draws both; don't recolour them.
- **Stage:** `StageTop` (status text and history), then at most one `Readouts` row, then the `Board`, then the rule sentence (`Caption`). Nothing else on the stage: no extra panels, legends, paytables, keyboard hints or explanatory paragraphs. Those belong in the How to play modal.

## 6. The odds: one readout

The odds are a picture of **the whole bet**: a green share of a track, an arc, a count of lit cells, or a bar. On top of that the stage shows **at most one probability number**, once:

- `Readouts` holds at most two items: the one chance (labelled plainly, e.g. "Win chance", "Next drop safe") and, if useful, the one prize ("Prize", "If inside"). The cash-out value is on the Cash out button, so it is not repeated as a readout. Drop `sub` lines that restate a value.
- Keep one `ChanceBar` (or the game's own flat win/lose split bar) for the whole-bet chance unless the board itself already pictures **the whole bet**. If the board pictures only the next step (a red arc, the green faces of a die, one slot out of N), it doesn't. The bar is the picture of the readout's number, not a second readout, so the two may sit together. Never remove a bar that moves after each step: watching it move is how a player sees why their chance changed.
- Win and lose areas on the board stay coloured `--win` / `--lose` (or neutral for "pays back less than the stake"). Don't flatten them to one grey. Area that pays has to look like it pays.
- No percentage labels scattered on the board, no "from X% → Y%" previews, no per-option odds tables on the stage. A label on the board is fine when it *is* the picture's unit (a numbered track, a multiplier on a step).
- **Exception: a few equally likely next outcomes drawn as cells.** When the board draws the next random step as ≤ 4 cells around the piece (Tumble's four tips), each cell may print that piece's chance *if that outcome happens*, tinted `--win` if it beats the chance now, `--lose` if worse, neutral if the same, with a one-line unit key ("Tile: your chance after that tip"). The cells are the board's own picture of the next step, so the number is its unit, not a scattered label. *Why:* Tumble's restyle drew these as unlabelled gauges, and two 3-player panels scored odds 3 and simplicity 3 ("the bands on the tiles take study"); the pre-restyle numbered cells scored 4 and 4.
- **A unit key is not a legend.** When the picture encodes the odds in a way that isn't self-evident (dot size, bar width vs height, dashed vs solid, a gauge per option), name the encoding on the board in at most two short lines of ≤ 8 words each, e.g. "Dot size = chance the knight ends there", "Next tip: green helps, red hurts". Keep each line under 9 words: the AI evaluator's blind player doesn't see longer text, and nor do skimming players. The sandbox counts space-separated tokens, so a lone `=` or `·` counts as a word ("Dashed = next hop · green raises your chance" is 9 and is hidden; "Dashed: next hop, green raises chance" is 6). *Why:* the first restyle removed these keys under §5's "no legends" rule, and the re-review showed players then couldn't read the picture at all (Knight odds 4 → 3, Tumble 4 → 3, Derby simplicity 3 → 2). An encoding no one can decode is not a picture of the odds.
- Don't reuse `--win` / `--lose` for a second meaning on the same board. If the targets are green, mark "this step helps / hurts" with a different cue (dashed outline, fill vs outline) or label it, so green never means two things.
- A paytable of **payouts** (hand → multiplier, zone → multiplier) may stay on the stage when the board doesn't already label what each outcome pays. Keep it to one compact flat row or column, highlighting the hit. The chances go in the How to play modal.
- The panel doesn't repeat the chance either.

### Which games always show the number

Per `odds-synthesis.md` (Stake and Roobet show a chance only where the player can't bet without it, and hide it where the multiplier or board stands in for it), we keep the number by default everywhere, because the evaluator rewards odds legibility. The operator may hide it only where the picture and the prize already carry the odds.

| Game type | Examples | Number | Operator may hide? |
|---|---|---|---|
| Chance is the input | dice, limbo, range-dice | always, headline | no: the game breaks without it |
| Choice between options with different odds | hilo, bet-on-a-side games | always, one per option | no: it is the decision's unit |
| Timing | crash, crash-colours, leverage | always, tied to the target | no |
| Table classics | roulette, baccarat, craps | always | no |
| Skill | blackjack, video-poker | always (table facts only, no strategy odds) | no |
| Ladders | mines, chicken, tower, pump, coin-flip, rps, snakes | "Next ... safe" plus the moving bar | yes: the rising multiplier encodes it |
| Paytable draws and slots | plinko, keno, wheel, diamonds, cases, darts, tarot, reels | picture plus per-outcome chance | yes: no single win chance exists |

**The flag.** `oddsReadout` (`'on'` | `'off'`, default `'on'`) is in `HostSettings`. It is an operator setting, not a player toggle (no header button). The operator sets `VITE_ODDS_READOUT=off`; `apps/platform/src/oddsPolicy.ts` lists each game's group and resolves the effective value, so only ladder and paytable games ever receive `'off'`. When `'off'`, the kit adds `og-odds-off` to the game root and CSS hides only `Readouts` items with tone `chance` and the number in `ChanceBar`'s head. Every picture and every prize or multiplier stays. Evaluate the default (`on`) build only.

## 7. The rule under the board

Exactly one sentence, always visible under the board in `Caption`, saying how a round is won: "Win if the roll lands on the green." "Keep every point inside one 180° window." It doesn't change with the round state, quote theorems, give percentages or explain the controls. Keep it under about 15 words. (The AI evaluator's blind player doesn't see `.og-caption`; that's intended. Don't move rules into other elements to get around it.)

## 8. Motion

- **Events are readable in Manual.** Each event (a roll, a draw, a cut, a drop, a step) animates for about `EVENT_MS` (600 ms, `--dur-event`); a multi-part event can take longer, but none is instant. The moving thing is visible throughout and lands where the outcome is decided. With Turbo on, and in Auto, use `eventMs(turbo)` (about 25%).
- UI transitions (hover, selected chip) are `--dur-ui` (120 ms) colour changes. No bounces, overshoots, pulses, shimmer, confetti or looping idle animations.
- `prefers-reduced-motion` is handled by the kit.

## 9. The last result stays marked

After a round ends, its outcome stays visible on the board until the next round starts: the rolled marker stays at the rolled value, the losing cell stays red, the final cut stays drawn, and the winning or losing element keeps its outcome colour. Clearing the board (Esc / Clear board) or changing a setting is the only thing that removes it before the next bet. Don't fade results out on a timer. The history row's newest result is boxed by the kit (`.og-hist:first-child`) for the same reason; `InstantResult` and `RoundOver` likewise stay until the next action.

## 10. Checklist

Before committing a game:

```bash
# Run against games/<id>/src. Every hit must be gone or justified in a comment.
rg -n "gradient|box-shadow|text-shadow|drop-shadow|backdrop-filter|feGaussianBlur|feDropShadow|<filter" games/<id>/src
rg -n "#[0-9a-fA-F]{3,8}\b|rgba?\(" games/<id>/src --glob "*.{css,tsx}"   # colours should be tokens; only the accent hex may appear
rg -n "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" games/<id>/src            # emoji
```

- One accent from the list, the same in `GameLayout` and the manifest.
- At most one probability number on the stage; nothing in the panel repeats it.
- One rule sentence under the board.
- Manual events take about 600 ms; Turbo about 150 ms.
- The last result stays on the board until the next bet.
- Screenshots at 1280×800 and 420×900 show nothing clipped or overlapping.
