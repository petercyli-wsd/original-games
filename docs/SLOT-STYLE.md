# Slot style

How slots look on this site. Peter's brief: **simple UI, different creative themes, as creative as real online slots.** So there are two layers:

- **Chrome (the same in every slot):** the panel, buttons, readouts, history and modals. It is the site's flat kit style (`docs/STYLE.md`), drawn by `SlotGame` (`packages/slots/src/ui`). A game never builds its own.
- **Theme (the game's own):** the **reel window and the symbols**: a palette, a window style and original flat-vector SVG art. This is where a slot gets its place and its story.

When this file and `docs/STYLE.md` disagree about the chrome, `STYLE.md` wins. When they disagree about the window and symbols, this file wins.

What stays banned everywhere, theme included, because Peter dislikes "the AI gradient look": gradients (CSS or SVG), glows, drop shadows, blur, glassmorphism, textures, emoji, mascots rendered with sheen, and copied art (no real brands, no art traced from another slot). Flat shapes in flat colours, layered as much as the theme needs.

## 1. What is themed and what is not

| Part | Themed? | Source |
|---|---|---|
| Panel, bet field, Spin / Skip / Autoplay buttons, Turbo, How to play | No | kit tokens and `ActionButton` |
| Status line, history, Balance / Win readouts, rule sentence | No | kit (`StageTop`, `Readouts`, `Caption`) |
| Win chip, cards (intro, outro, retrigger, big win), paytable text | No (they sit on `--raised`, 1px borders) | `slotStyles` |
| Reel window: background, frame, tiles, separators, win frame, payline, badges | **Yes** | `SlotTheme` |
| Symbols | **Yes** | `symbols[id].render(size)` |
| Window palette swap during a feature | **Yes** (optional) | `palette.feature*` |
| Win / lose colours (`--win`, `--lose`) | No: they keep their meaning (Won 2.50 is green; the window never uses green *because* it won) | kit |
| Accent | The game's one accent from `ACCENTS` (focus rings only; the window does not use it) | manifest |

The three-hue limit of `STYLE.md` §1 applies to the chrome. The window is allowed its own palette (below), and nothing from the window leaks into the chrome.

## 2. The palette

A theme is a background tone, a frame tone and 2 to 4 theme colours (hex strings, flat):

```ts
palette: {
  bg: '#0b2a3c',          // behind the reels
  frame: '#1d6f93',       // the frame, and the gaps between tiles
  tile: '#123e55',        // tile tone (defaults to frame)
  colors: ['#ff7a59', '#f3d9a4', '#38b48b', '#f5f1e8'],  // [0] is the win highlight
  ink: '#ffd23f',         // text on bg, for decor badges (defaults to --text)
  featureBg / featureFrame / featureTile                  // optional: a flat swap in the feature
}
```

Rules:

1. **Everything in the window comes from the palette**: symbol art uses `colors` plus the `bg`, `frame` and `tile` tones, and nothing else. A symbol that needs a fifth colour means the palette needs one, so the palette has to change, not the symbol.
2. **`colors[0]` is the win highlight.** It must be visible on `tile` and on `bg` (aim for contrast 3:1 or better) and should not be the colour of the most common low symbol. Cinder Peak uses gold (only the spark is a gold-led symbol; elsewhere gold is a detail); Tide Chest uses coral.
3. **Dark windows.** Both reference themes are dark so the window sits quietly in the dark site. A light window is allowed if the frame separates it from the stage; it may not use pure white as its background.
4. **Feature palette.** If the feature changes the place (night, underwater, a vault), swap `bg`, `frame` and `tile` with the `feature*` fields. It is a flat swap at the moment the feature starts (no fade, no animation). Symbols do not change.
5. **Name the theme.** `theme.name` is the slot's name in the paytable and the review.

### The window style

```ts
window: { cell: 'tile' | 'plain', separators: 'gap' | 'line' | 'none', frameWidth: 4..14, radius: 0..12, cellRadius: 0..10 }
```

Pick the combination that suits the story: `tile` + `gap` (separate tiles on a dark window, the reference style), `plain` + `line` (symbols straight on the background, classic reels), `plain` + `none` (open cluster grids), `tile` + `none` (a mosaic). A thick `frameWidth` with a big `radius` reads as a cabinet, a thin frame with `radius: 0` reads as stone or metal. Nothing else about the window is configurable, on purpose: a theme that needs a new window feature asks for it in the kit.

## 3. Symbols

Each symbol is a function `render(size) => <svg width={size} height={size} viewBox="0 0 100 100">` plus a `name`.

**Allowed:** filled paths, circles, rects, polygons; strokes with round caps and joins (a stroke is a shape here); layers (a body, a stripe, an eye); shapes that overlap; the palette colours.

**Not allowed:** `<linearGradient>`, `<radialGradient>`, `<filter>`, blur, shadows, `opacity` for depth, `<image>`, `<text>`, emoji, glyph letters (a "W" on the wild), tiny detail that disappears at 48 px, anything traced from another game.

### Readable at 48 px

- Draw inside a 6-unit margin (shapes between 6 and 94 on a 100 grid) so tiles never crop art.
- No stroke thinner than 3 units and no gap thinner than 4: they vanish at 48 px.
- At most 8 shapes. A symbol is recognised by its silhouette first and its colour second.
- Look at it small before accepting it: render at 48 px, then again with the tile in greyscale. If two symbols can be confused, redraw one.
- Every symbol has a plain-language `name` ("Angelfish", "Stone mask"). It is the symbol's aria label, its paytable name and its win-chip name. Never "P2".

### Premiums differ by silhouette, not only by colour

Premiums are the symbols a player must tell apart at a glance. Give each a different outline from the others:

| Silhouette | Tide Chest | Cinder Peak |
|---|---|---|
| Tall and thin | Seahorse | Obsidian crystal (a kite) |
| Wide and low | Sea turtle | Stone mask (squared, flat top) |
| Angular / diamond | Angelfish | Dragon egg (tall oval) |
| Radial or pointed | Starfish | Flame (teardrop with a notch) |

Test: fill each premium solid black and look at the row of them. If two read as the same blob, redraw. Colour then adds a second cue. The same applies between a premium and a low: lows are simpler (one colour, one or two shapes) and sit lower in contrast.

### Roles

| Role | How it should look |
|---|---|
| Premium (3 to 5) | Layered, 2 to 3 palette colours, a distinct outline |
| Low (4 to 6) | Themed objects (kelp, coal, shell), not A K Q J unless the theme is a classic. One colour, simple shape |
| Wild | Reads as special: a unique outline not used by any other symbol, a light accent colour. No letter on it |
| Scatter | A different outline again (a box, a burst, a mountain). The feature's trigger must be the most recognisable symbol on the reel |
| Special (orb, coin) | A round or badge shape that can carry a value badge on top |

Low symbols are not allowed to be the same shape in different colours.

## 4. Layout

The kit's slot layout, always:

- **Panel:** Manual | Autoplay tabs, bet field, **Spin** (the primary button; it reads **Skip** while a round plays, and **Stop autoplay · N left** in Autoplay), Autoplay settings, Turbo, How to play. In Autoplay the settings are: number of spins (10, 25, 50, 100), stop on a win of 5×, 20× or 100× (or off) and, if the game has a feature, stop on the feature.
- **Stage:** status line and history, one readouts row (**Balance** and **Win**; in a feature: **Free spin n of m**, **Feature total**, **Multiplier**), the reel window, the win chip row under it, the one rule sentence.
- **Nothing else.** No paytable on the stage, no legends, no pulsing Spin button, no jackpot ticker. The paytable and rules are in How to play (the `PayTableSheet` in the kit's info modal).

The window takes the full stage width, limited to 60% of the viewport height, with square cells: a 5×3 slot is wide, a 7×7 slot is nearly square. A reel with a different row count (megaways) keeps the window height and splits it into taller cells.

### Grids

| Mechanism | Typical grid | Notes |
|---|---|---|
| Paylines | 5×3, 3×3, 5×4 | A payline is drawn as a path through the winning cells |
| Ways | 5×3, 5×4 | No line; the chip names the ways |
| Megaways | 6 reels of 2 to 7 rows | Cells stretch; art stays square and centred |
| Cluster / scatter pays | 6×5 to 8×8 | All matching cells highlight together |

At 8×8 on a 420 px frame a cell is 46 px: symbols must still read (§3). Test every new theme at 8×8 if its grid is that large.

## 5. Motion

All motion is functional. No bounce, overshoot, shake, pulse, shimmer, particles or confetti.

- **Spin.** Reels scroll (no blur) and stop left to right. In Manual the first reel stops at 0.9 s and the last by 1.6 s (stagger 700 ms spread over the gaps, at most 180 ms each). In Turbo every reel is down in about 0.3 s. The symbols that pass are the real neighbours on the strip when the engine gives its strips, otherwise a fixed cycle through the symbols (never random). The landing symbols are the engine's result, always.
- **Space** while spinning lands every reel now (and ends the current animation); Space while idle spins. In a card, Space continues.
- **Reduced motion** (`prefers-reduced-motion`) uses the Turbo timings.
- Win highlight and chip changes are instant. Cards fade in over the kit's `--dur-ui`.

### Anticipation (only when real)

The reels slow only when the trigger is really in play: the scatters already landed to the left are one short of the trigger and a scatter on the next reel (or later) would complete it (`anticipationPlan`). Then each such reel gets 700 ms more and an outline in `colors[0]` while it is the one still spinning. It never slows a reel just for show, and there is none in Turbo. If the reel then shows no scatter, the slow-down was still honest: it could have. This is `docs/SLOTS.md` §2.8.

## 6. Win presentation

1. **Highlight.** A winning cell gets a 3 px frame in `colors[0]`. Every other cell steps back to 40% so the win is the only bright thing. (This is the one use of fading for clarity; it is not atmosphere.)
2. **One at a time.** With up to 4 wins in a step, each is shown in turn (its cells, its line, its chip) for about half a second to a second, then all of them together. With 5 or more wins, or in Turbo, all are shown at once with the chip "N wins = amount". The last result stays marked on the board until the next spin.
3. **Payline path.** A payline win draws a path through its cell centres in `colors[0]`, with a 8-unit casing in the window background so it reads over symbols of its own colour. Ways, cluster and scatter wins have no line.
4. **The chip**, under the window: the symbol on a tile of the theme, then **name ×count = amount** ("Angelfish ×4 = 2.50"; ways add "· 3 ways"). Every highlighted win shows one. Keep it under 9 words (blind players do not see more).
5. **The counter.** The Win readout rolls up while the wins show. Its time is proportional to the win in stakes (350 ms + 45 ms per stake) and capped at 3 s; Turbo uses a quarter. Space lands it.
6. **Tumbles.** Played step by step from `SpinResult.steps`: the step's wins show, the winning symbols pop out (swell, then vanish; 320 ms), survivors fall and new symbols drop in from above (420 ms, accelerating, no bounce), then the next step. The counter keeps running across steps.
7. **Decor.** Values attached to cells (`orb_sum_terminal.orbVals`) show as a small badge on the cell (a pill in `bg` with a `colors[0]` border and `palette.ink` text, "×8"). They appear when the final board is shown, before the event below.
8. **Multiplier events.** An `extras` entry such as "ORB SUM x35" shows as a chip with a `--text` border ("ORB SUM ×35 · +60.45") and adds to the counter.
9. **Win readout colour.** Amounts in the chrome follow `STYLE.md`: `Won` is `--win`, no win is plain. The window never shows red or green for outcomes.

### Big wins

A round that pays at least **20×** its stake shows a **Big win** card; **100×** shows **Huge win**. The card is a solid `--raised` surface with a 1px `--text` border (2 px at Huge) in the middle of the window: the tier word as a small label, the amount rolling up (same time rule, 3 s cap), "64.5× your bet". It closes by itself after a short hold (a click or Space closes it now). If the cap was hit it adds "Max win reached". No coins, no confetti, no sunbursts, no shaking.

## 7. The feature

For a free-spins feature (`config.feature` in `slot.config.json`):

1. **Intro card**, after the triggering spin's wins: the feature's name (`copy.featureName`), "8 free spins" (from what the engine awards for the scatters that landed), "3 scatters", a note ("Every win pays ×2", generated from the multiplier law, or `copy.introNote`), and a **Start** button. In Autoplay or Turbo it closes by itself after about 1.6 s (0.4 s in Turbo); otherwise it waits for a press (button, click or Space).
2. **During the feature**, the readouts become **Free spin n of m**, **Feature total** (rolling) and **Multiplier ×k**; the status line names the feature. If the theme has a feature palette, the window swaps to it here.
3. **Retrigger.** More spins add a small card ("+4 free spins", "Retrigger") for about 1.4 s and *m* grows.
4. **Outro card:** "Total win" (or the big-win tier) with the feature's total, the number of spins, the multiple of the bet, and **Collect**. Same auto-advance rule. The window returns to the base palette and the Win readout rolls to the whole round's total.

Spins in the feature use the same win presentation (with each win multiplied by the feature multiplier). The stake of the whole round is settled once, on the first spin's ticket.

## 7b. Modifier features, multipliers, reveals and the backdrop

**Modifier-driven features** (hold and spin, sticky or expanding-wild respins) are found in the spin itself: a chain of boards with no win between them, or a `*.respins` decor (or the game's own `modifierFeature.detect` in `slot.config.json`). They get the same arc as free spins: an intro card (`copy.modifierName`, default "Bonus", with "N respins"), a live counter in the readouts (**Respin n of m**, **Bonus total**, `copy.respinLabel`), coin values shown on their cells as each lands (in bets; `copy.decorLabels` overrides) with the total rolling up, an outro card with the total, and a paytable section generated from the mechanic's params. `?feature=1` finds the game's main feature (free spins when it has them, else the chain; `copy.mainFeature` overrides), `?feature=free` and `?feature=respin` pick one (also `__slotDev.feature('free' | 'respin')`).

**A chain without coin values** (sticky respins) shows what the current board would pay: the step's own `stepCoins` and wins when the engine reports them, otherwise the engine's evaluator over that board, never a guess per cell. The paying cells are framed, the readout (`copy.pendingLabel`, default "Pending win") rolls to the sum and a chip names it; the payment itself is made on the final board. **The chain has its own palette**: `palette.chainBg / chainFrame / chainTile`, defaulting to a light tint of the base, not the feature palette.

**Engine extras labels are never shown raw.** "HOLD & SPIN: 9 coins" and "ORB SUM x35" are engine text. Map them with `copy.extrasLabels` (a function, or a record keyed by the label or its start). The neutral default is "Scatter pay", "Bonus ×35" or "Bonus total"; a label already in the game's own words passes through.

**The multiplier readout shows what is applied.** The feature's multiplier times the spin's own: a `global_iid` reel value, the `global_additive` total, or the sum of orbs. A plain ×1 is not shown. `global_additive` rockets show their "+N" badges and a chip "Multiplier ×6 (1 + 5)" before the wins. A game can add the multiplier reel (the marquee) above the window with `copy.multiplierReel` (`values` is one list, or `{ base, feature }`; each phase defaults to its own spec's `global_iid`): its values step along while the reels spin and rest on the spin's value.

**Mystery reveal.** The reels stop on the board with the mystery symbols visible (rebuilt from the stops and strips), then every mystery cell flips into the revealed symbol at once, before any win shows.

**Cell overlays.** `renderOverlay({ col, row, symbol, decor })` draws extra content over a symbol's tile (a ticket in a cook's hand). It sits above the symbol, below the win frame, and takes no pointer events.

**Backdrop.** `theme.backdrop(w, h)` (and optional `theme.featureBackdrop`) returns flat SVG shapes for the window's size, drawn behind the symbols: a seabed, a skyline over water. Palette colours a shade off the window tone, no gradients, glows or filters. It shows through the gaps between tiles and fully with `window.cell: 'plain'`; with tiles, set `window.backdropMargin` (0 to 48 px) to leave a band around the grid where the scene frames the reels without sitting under the symbols. Keep it quiet: if a symbol is harder to read with it, make it quieter. Check it at 420 px.

**No spoilers.** A card or readout never shows an outcome before it plays. A modifier chain's intro says what starts ("3 respins", from the mechanic's params), never how long the chain turns out to be; its counter reads "Respin n", plus "k left" where respins reset on a new coin (known from what has played). A free-spins total grows only when a retrigger is played. `copy.featureRule` and `copy.chainRule` replace the rule line under the board while that feature or chain runs (under 9 words each).

**Standard moments.** The spin that triggers a feature frames the symbols that caused it (the scatters, or the coins of a hold-and-spin) for about a second, in Turbo briefly, before the card. Anticipation also covers hold-and-spin entry and checks the remaining reels' strips for the symbol. A cascade ladder (`cascade_step_ladder`) shows its rungs as a row that lights the paying step on show (the readout reads `copy.ladder.label`, default "Step": "Pressure ×5", or "Pressure ×5 · spin ×3"; free spins use the feature spec's own ladder, and six rungs fit one line at 420 px); a variable-height ways game shows "Ways n" as the reels stop. `copy.paytableFirst` (symbol ids) lists key symbols first, with the special symbols before the pays. The history chips are labelled "Recent rounds".

**Respin chains.** Held cells (coins that have landed, or the cells a sticky chain locked) stay fixed and visible through every respin with a lock frame and their value badges; only the other positions spin. Hold and spin reads "Respins left: 3" and "Filled 9/25" (`copy.respinsLeftLabel`, `copy.fillLabel`); a sticky chain reads "Tick 2/4" (`copy.respinLabel`). A chain never waits for a press: it plays by itself, its intro card closes on its own, and a sticky chain has no card at all, only the badge. The line win that started a sticky chain shows first, then "Pending win". The chain's total and the big-win tier are one card, so a big win does not count up twice.

**Several wins at once.** In Manual each win shows in turn (its cells, its line path, the chip "Symbol × count = amount"), then the summary "3 wins = 1.35" stays with a list under it of which win paid what ("Line 3 · Crab ×4 = 0.45"). Turbo shows the summary alone.

**Cards keep clear.** The free-spins Start card never covers the trigger cells: it goes to the half of the window that has none, or below the window when every half has one. The trigger cells stay framed for 1 s (0.6 s in Turbo) before it appears. A mystery reveal ends with the chip "Squares → <name>", before any win counts. A multiplier reel dims its landed value on a spin that pays nothing (`copy.multiplierReel.dimOnLoss`, default on).

**Landing effects.** `symbolFx={{ [symbolId]: (size) => <svg/> }}` plays a short flat burst over a symbol's cell when it lands, and the kit adds its own burst (rays in `colors[0]` and `colors[1]`) as the first win of a spin of 5× or more shows. Flat shapes, no glow.

**Copy the blind reviewer can read.** A game's own copy lines of 9 or more words are hidden from blind reviewers. In development the kit warns for each one; `checkCopy(copy)` returns the offenders so a game test can assert `expect(checkCopy(copy)).toEqual([])`.

**Paytable wording.** A pay-less symbol the spec names as the `mystery_reveal` symbol reads "Opens into one symbol"; `copy.symbolText` (`{ [id]: text }`, under 9 words) replaces any symbol's generated line. The feature rules and the trigger line name the scatter as the game does ("3 treasure chests: 12 free folds"), with "scatters" as the fallback. On a spin that pays nothing the multiplier readouts are dimmed (`copy.noWinMultiplier`: `'dim'` default, `'hide'`, or `'label'` for dimmed with "No win to multiply").

**Chains, round 10.** The counter advances on every respin and says "Up to 4 ticks" beside it (the chain's declared maximum). The running amount is "Board pays now" (`copy.pendingLabel`), the pill shows the same total, and the lines that started a chain add up in the readout as they show. A chain tick takes about half a second in Manual; a press on Skip fast-forwards the rest of the chain, never ignored. A chain inside a free spin shows its tick next to "Free spin n of m", holds its cells, and has no cards. A feature with a per-spin multiplier schedule shows "Multiplier ×1" from spin 1. The feature's Total win card uses one total for its amount and its "× your bet" line, with "Feature X + trigger spin Y" under it. The rules say "No retriggers" when the config has none and show the spin cap only where it can bind.

**Mystery reveal pacing.** The reels settle showing the folded squares outlined, hold 0.3 s, then flip one reel at a time; a small folded corner stays on those cells through the wins. Turbo also shows the per-win list under the summary. Wild symbols carry a small "WILD" tag the kit draws over the art (`copy.wildTag`: a string renames it, `false` hides it).

**Rule lines read as sentences.** The feature's spins use a noun, not the feature's name: `copy.featureSpins` ("rush spins", default "free spins"), or the name itself when it ends in "spins" ("Tide spins"). The scatter is named as the game does and counted: "3 order tickets: 5 rush spins", "Retrigger: 1 order ticket, +1 spin".

**Cascades.** The win chip carries its step's multiplier ("Fire opal ×5 · Pressure ×2 = 2.58"; dropped if the chip would pass 9 words, since the readout shows it) and a "Chain total" chip sits beside it. The Win readout never runs ahead of what is on screen: with several wins it adds each as that win shows. A step's win frames and its list go in the same commit that brings the new symbols, so they never sit on arrivals. A value-carrying symbol (orb, coin) shows its badge from the moment it lands, tracked through the tumbles to the engine's terminal values; a spin the engine draws no values for (an orb round that pays nothing) shows none, because none exist. The ladder highlight starts empty each spin and when a feature ends. When the feature's ladder differs, its intro card says where it starts ("Pressure starts at ×4") and the paytable lists each phase's ladder ("Base: ×1 ×2 ×3 ×5 ×8"). The trigger highlight boxes the scatters on the final board, so cascade triggers are boxed where the symbols ended up.

**Tiny pays** keep their digits ("0.0045×", never "0×"); a ways game says "Pays shown are per way". Coin and orb symbols show their value range and most common value instead of pays.

## 8. The paytable sheet

`PayTableSheet` is generated from the spec and the facts. A game never writes it by hand.

1. **How to win:** the evaluation rule in one sentence (from the spec's evaluation), the number of paylines, "Pays are multiples of your total bet".
2. **Symbols:** premiums then lows, highest pay first, each with its art on a tile and its pays by symbol count, in stakes ("5 10×, 4 3×, 3 1×"). Counts that pay the same merge into ranges ("8–9 0.5×"). Wilds and scatters are in their own section.
3. **Special symbols:** the wild and scatter text from `copy.wildText` and `copy.scatterText` (defaults are minimal, role-only), the scatter's own pays.
4. **The feature:** the rules as sentences generated from the law in `slot.config.json` (awards by scatter count, the multiplier, retriggers, the spin cap), so the text is the maths.
5. **Paylines:** a small picture per line (a dotted grid with the line drawn).
6. **The numbers:** RTP **with its tier** ("96.00% (exact)", "96.02% ± 0.03% (Monte Carlo, n = 100,000,000)"), hit rate ("31.0% of spins pay (1 in 3.2)"), max win ("5,000×"), the feature's frequency ("1 in 160 spins") and the volatility word. They come from `slot-facts.json`; if the facts file lacks one of RTP, hit rate or max win, the sheet refuses to build (`parseSlotFacts` throws) instead of showing a made-up number.

## 9. Mobile (420 px)

The kit stacks the stage above the panel in frames narrower than 760 px, with Spin right under the window. The slot rules on top:

- The window is the full width (388 px); a 5×3 cell is about 74 px, a 6×5 cell 62 px, an 8×8 cell 46 px. Design symbols for the smallest.
- The readouts row may wrap to two lines in a feature; never to three.
- Cards shrink their padding and use `--fs-5` for the amount.
- The paytable's symbol grid is two columns.
- Nothing scrolls sideways; the window never clips its frame.

## 10. Accessibility and dev hooks

- **Text label on every symbol** (an `aria-label` from `name`), the window is a group labelled "Reels", the win chip and status are live regions, and the Space key spins.
- Dev hooks for reviewers: `?seed=<n>` forces the next spin's seed; `?feature=1` searches seeds with the engine until one triggers the feature and forces it; `?win=<stakes>` does the same for a round that wins at least that many stakes (use `?win=20` and `?win=100` to see the big-win cards). In a page that cannot take a query, call `window.__slotDev.feature()`, `.win(n)` or `.seed(n)`. A forced seed is used for one spin and is then replayable: the same seed gives the same round. These only choose *which* seed is played. They never change a round, and they have no effect on the maths.

## 11. Checklist

Before a slot goes to review:

```bash
# Gradients, glows, shadows, blur, emoji: none (art and CSS)
rg -n "gradient|box-shadow|text-shadow|drop-shadow|backdrop-filter|feGaussianBlur|feDropShadow|<filter" games/<id>/src
rg -n "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" games/<id>/src
rg -n "<text|<image" games/<id>/src      # no text or images inside symbol art
```

- All symbol colours are palette colours; `colors[0]` is visible on `tile` and `bg`.
- Every symbol has a plain-language `name`; premiums differ in silhouette (greyscale test at 48 px).
- The window and the symbols carry the theme; nothing in the chrome is recoloured.
- Screenshots at 1280×800 and 420×900 (`node scripts/play.mjs <id> --out <dir> --size 420x900`): idle, a win, a tumble if any, a big win (`?win=20`), the feature intro, a feature spin, the outro and the paytable. Open each; nothing clipped, overlapping or unreadable.
- Chips and card lines are under 9 words.
- Space spins; Turbo finishes a whole feature in a few seconds.

## 12. Reference themes

`packages/slots/src/ui/demo/` has two worked themes (and a megaways variant) on the real engine. Run them with `VITE_SLOT_DEMO=reef|ember|ember8|mega node scripts/play.mjs slot-kit-demo`:

- **Tide Chest** (reef): dark teal window, coral highlight, sand / kelp / pearl; tile + gap, 8 px frame, a purple feature palette. Symbols: chest (scatter), pearl in a shell (wild), angelfish, seahorse, sea turtle, starfish, coral, kelp, shell, bubbles.
- **Cinder Peak** (volcano): near-black window with a brown frame, gold highlight, lava / ash / obsidian; tile + gap, thin 6 px frame, small radii. Symbols: volcano (scatter), dragon eye (wild), dragon egg, obsidian crystal, flame, stone mask, rock, hot coal, ash cloud, spark, fire orb (carries the multiplier badge).

Same kit, same chrome; only the window and the art differ.
