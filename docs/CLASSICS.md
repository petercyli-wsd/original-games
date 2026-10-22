# Casino Classics

Proven formats from the big crypto casinos (Stake, Roobet, BC.Game, Shuffle, Rollbit, Rainbet, Betfury), rebuilt to house standard and shown in the lobby's **Casino Classics** section (`collection: 'classics'` in the manifest). They are what players already know and trust. They also double as a **rating benchmark**: if a classic like Mines rates 4.2, an original rating 4.4 has genuinely beaten a proven format.

`games/dice` is the reference implementation. Copy its structure: Manual/Auto tabs, linked inputs, instant result pill, history, info modal.

## Contract (in addition to `docs/BUILDING-GAMES.md`)

- **Manifest:** `collection: 'classics'`, `status: 'live'`, and the mechanic from the table below.
- **Familiar, but ours.** Match the controls, terminology and flow players expect from the format (the layout of Stake's version is the benchmark). Use our own names, art and kit skin: no third-party branding, logos or copied artwork. Visuals should be polished and casino-grade (card flips, wheel spins, ball physics that follow the drawn outcome), but geometric and tasteful.
- **Manual and Auto are mandatory.** Use `ModeTabs`, `useAutoBet` and `AutoBetControls` from the kit. `play(stake)` plays one complete round using the game's own auto choices, rendered as children of `AutoBetControls`:
  - Mines: tiles pre-selected on the board.
  - Tower and Chicken: target row or lane plus a pick pattern.
  - HiLo: a rule such as "pick the likelier side, cash out at ×N".
  - Crash and Leverage: an auto cash-out target.
  - Blackjack and Video Poker: optimal or basic-strategy play.
  - Table games: repeat the last chip layout.
- **Round flow:**
  - **Instant games** (one bet, one reveal): show `InstantResult` plus history and never block; Bet again is the Bet button or Space.
  - **Multi-step games** (Mines, Tower, Chicken, Pump, HiLo, Coin Flip, RPS, Snakes, Blackjack, Video Poker, Craps, Leverage): use `RoundOver` with Bet again and Clear board, as in the originals.
  - Changing a setting after a round clears the board.
- **Exact maths.** Payout tables are listed, or derived exactly, so the RTP is known in closed form. Tests check the RTP analytically (enumeration or closed form) **and** by simulation. Bets with different edges (baccarat Tie, sic bo totals, craps props) declare a per-config `rtp` in `eval.ts` (`configs: [{ label, params, rtp }]`). `manifest.rtp` is the main bet's RTP.
- **Customisability.** Every game exposes its format's standard knobs (risk level, rows, mines, difficulty, segments, chip size…). Where the original has none, add a risk or variant knob priced to the same RTP.
- **Keyboard:** Space = Bet / main action. Table games add letter shortcuts (H hit, S stand, D double, P split).
- **Tests:** RTP exact (closed form or enumeration), simulation within 4 SE, paytable sanity (monotone where expected), auto-bet `play` resolves once per round, and the max multiplier is honest.

## The 30 classics

| id | Name | Seen at | Mechanic | RTP | Flow |
|---|---|---|---|---|---|
| dice | Dice | Stake, BC.Game, Roobet, Shuffle, Rainbet, Betfury | dice | 99% | instant (**built: reference**) |
| range-dice | Range Dice | BC.Game (Ultimate Dice) | dice | 99% | instant |
| limbo | Limbo | Stake, BC.Game, Shuffle, Rainbet | crash | 99% | instant |
| crash | Crash | Stake, Roobet, BC.Game, Rollbit, Shuffle | crash | 99% | live (cash-out) |
| crash-colours | Crash Colours | BC.Game (Trenball) | crash | 99% | instant |
| mines | Mines | Stake, Roobet, BC.Game, Rollbit, Shuffle, Rainbet | mines | 99% | multi-step |
| plinko | Plinko | Stake, Roobet, BC.Game, Rollbit, Shuffle, Rainbet | other | 99% | instant |
| keno | Keno | Stake, BC.Game, Shuffle, Rainbet | other | 99% | instant |
| hilo | HiLo | Stake, BC.Game, Shuffle | table | 99% | multi-step |
| tower | Tower | Stake (Dragon Tower), Roobet (Towers), BC.Game (Tower Legend) | mines | 99% | multi-step |
| chicken | Chicken | Roobet (Mission Uncrossable), Stake (Chicken) | mines | 99% | multi-step |
| pump | Pump | Stake | mines | 99% | multi-step |
| blackjack | Blackjack | Stake, Roobet, BC.Game, Shuffle | table | ≈99.5% (exact, basic strategy) | multi-step |
| baccarat | Baccarat | Stake, BC.Game | table | Banker 98.94%, Player 98.76%, Tie 85.64% (8-deck) | instant |
| roulette | Roulette | Stake, Shuffle, Roobet | table | 97.30% | instant |
| strip-roulette | Strip Roulette | Rollbit (X-Roulette) | other | 99% | instant |
| wheel | Wheel | Stake, BC.Game, Shuffle | other | 99% | instant |
| diamonds | Diamonds | Stake | other | 98% (exact) | instant |
| video-poker | Video Poker | Stake, BC.Game | table | 99.54% (9/6 Jacks or Better, optimal play) | multi-step |
| coin-flip | Coin Flip | Stake (Flip), Roobet, BC.Game | other | 99% | multi-step |
| rps | Rock Paper Scissors | Stake | duel | 99% | multi-step |
| darts | Darts | Stake | geometry | 99% | instant |
| cases | Cases | Stake | other | 99% | instant |
| snakes | Snakes | Stake | other | 99% | multi-step |
| tarot | Tarot | Stake | other | 99% | instant (staged reveal) |
| reels | Reels | Stake Originals slots, BC.Game slots | slots | 97% (exact) | instant |
| sic-bo | Sic Bo | Stake, BC.Game (RNG table) | table | per bet (Big/Small 97.22%) | instant |
| dragon-tiger | Dragon Tiger | BC.Game, Stake (RNG table) | table | per bet (Dragon/Tiger 96.27%) | instant |
| craps | Craps | BC.Game, Stake (RNG table) | table | per bet (Pass 98.59%, odds 100%) | multi-step |
| leverage | Leverage | Rollbit (1000× trading) | other | 99% (fee-priced) | multi-step |

## Specs

### range-dice
**Range Dice** · accent `#06b6d4`
A number from 0 to 9999 (uniform). A dual-handle slider picks a range [a, b]. Bet **In** (win if the result is in [a, b], P = (b−a+1)/10000) or **Out** (the complement). Payout = 0.99/P, with chance limited to 0.01%–98%. Inputs: low, high, win chance and multiplier, all linked. Instant, with the result marker on the track.

### limbo
**Limbo** · accent `#a855f7`
Pick a target multiplier t ∈ [1.01, 1,000,000]. Result X = floor(100·0.99/U)/100 with U uniform, so P(X ≥ t) = 0.99/t exactly. Win pays t. Show a rolling counter that climbs to X, then green or red. Inputs: target multiplier and win chance (linked). Instant.

### crash
**Crash** · accent `#f97316`
A single-player crash curve: the multiplier m(t) = e^(0.00006·t_ms) rises, and the crash point C has P(C ≥ x) = 0.99/x (so C = 1.00 with probability 1%). Cash out manually at the current m, or set an auto cash-out target (required in Auto). Cashing out at m pays m, so every rule returns 99%. Draw the graph with axes; the history row shows past crash points coloured by size. Cap C at 1,000,000.

### crash-colours
**Crash Colours** · accent `#ef4444`
The same crash process; no cash-out. Stake any of three outcome bands at once: **Red** (C < 2×) pays 0.99/0.505 ≈ 1.9604×, **Green** (C ≥ 2×) pays 2×, **Moon** (C ≥ 10×) pays 10×. Each band returns exactly 99%. Three stake inputs and one Bet. The curve plays out; the bands light up as thresholds pass.

### mines
**Mines** · accent `#22c55e`
A 5×5 grid with 1–24 mines. Reveal tiles; after k safe reveals the multiplier is 0.99·C(25,k)/C(25−m,k). Cash out any time after the first reveal; "Pick random tile" button. On the end, reveal every mine and every gem (dimmed). Auto: select tiles on the board, and each auto bet reveals that set. Show the next multiplier and the live chance.

### plinko
**Plinko** · accent `#ec4899`
Rows 8–16 and risk Low/Medium/High; the ball makes fair left/right bounces into binomial slots. Use multiplier tables with Stake's familiar shape for each (rows, risk). Then normalise them exactly so RTP = 0.99, adjusting the middle slots minimally and keeping the edges round, and print each table's exact RTP in the tests. Animate balls along the pegs following the drawn path; allow several balls in flight. Slot buckets flash and the history shows multipliers.

### keno
**Keno** · accent `#eab308`
40 numbers; pick 1–10; 10 are drawn. Risk: Classic, Low, Medium, High. Each has a paytable per picks count (Stake-like shape) normalised to exactly 99% via the hypergeometric distribution. Auto-pick and Clear buttons. Draw animation; hits highlighted. The table under the board shows the payout and chance for each hit count.

### hilo
**HiLo** · accent `#f43f5e`
Infinite deck: ranks A–K uniform, suits cosmetic. From the current card, guess **Higher or same** or **Lower or same** (at A: Higher / Same; at K: Lower / Same). Apply the RTP once (the round starts at 0.99× of the stake) and price each correct guess at 1/P(guess), so the cash-out is a martingale and every stopping rule returns exactly 99%. (Stake compounds 0.99 per guess; ours keeps one edge.) Skip-card allowed (unlimited, as on Stake). Cash out any time after a correct guess. Card flip animations; a history row of cards.

### tower
**Tower** · accent `#fb923c`
9 rows; difficulty Easy (4 tiles, 3 safe), Medium (3, 2), Hard (2, 1), Expert (3, 1), Master (4, 1). Climb a row by picking a tile; the multiplier after k rows = 0.99/(safe/tiles)^k. Cash out any time after row 1; "Random pick". Auto: pick a column pattern and a target row. Reveal every row on the end.

### chicken
**Chicken** · accent `#facc15`
A token crosses up to 20 lanes. Difficulty sets the per-lane hit chance: Easy 1/25, Medium 3/25, Hard 5/25, Daredevil 10/25. The multiplier after k lanes = 0.99/(1−h)^k. Cash out between lanes. Auto: a target lane. Geometric road with lanes and moving blocks; the next lane's multiplier is shown on the lane.

### pump
**Pump** · accent `#38bdf8`
A balloon with 25 pump positions, of which d are "pop" positions (Easy 1, Medium 3, Hard 5, Expert 10). Each pump reveals the next position; the multiplier after k safe pumps = 0.99·C(25,k)/C(25−d,k). Cash out any time. The balloon grows; the multiplier ladder is visible. Auto: a target pump count.

### blackjack
**Blackjack** · accent `#10b981`
Infinite deck. Blackjack pays 3:2; dealer stands on soft 17; double on any first two cards; split once (aces get one card each); insurance offered against an ace (pays 2:1); no surrender. Compute the exact basic-strategy RTP for these rules (dynamic programming over the infinite deck) as `manifest.rtp`. The eval plays exact basic strategy. UI: animated dealing; Hit/Stand/Double/Split/Insurance buttons with H/S/D/P keys; hand totals (soft/hard); a basic-strategy hint toggle. Auto plays basic strategy.

### baccarat
**Baccarat** · accent `#8b5cf6`
8-deck punto banco with the standard third-card tableau. Chips on **Player** (1:1), **Banker** (0.95:1) and **Tie** (8:1), plus optional pair side bets (11:1) if exact. Compute exact probabilities for the 8-deck shoe (enumerate draws by rank counts, treating the shoe as fresh each round); declare a per-config rtp per bet. Chip selector, undo and clear, card animations. Instant.

### roulette
**Roulette** · accent `#dc2626`
European single zero. A full betting table: straight, split, street, corner, six line, column, dozen, red/black, odd/even, low/high. Chip denominations, undo, clear, double, and repeat-last. Every bet is 97.30%. Wheel and ball animation stopping on the drawn pocket; a history of recent numbers. Instant; Auto repeats the layout.

### strip-roulette
**Strip Roulette** · accent `#14b8a6`
A 15-slot strip (7 red, 7 black, 1 green) scrolls horizontally and stops under a pointer. Payouts for exactly 99%: red/black 0.99·15/7 = 2.1214×, green 0.99·15 = 14.85×. Stake any combination per spin. Recent results as coloured dots.

### wheel
**Wheel** · accent `#f59e0b`
Segments 10/20/30/40/50 and risk Low/Medium/High (Stake's familiar segment patterns). Every (segments, risk) table is normalised to exactly 99%. Spin animation; legend of multipliers with counts and chances.

### diamonds
**Diamonds** · accent `#2dd4bf`
5 gems, each one of 7 colours uniformly. Hands: no pair, pair, two pair, three of a kind, full house, four of a kind, five of a kind, with Stake's familiar paytable (0, 0.1, 2, 3, 4, 5, 50) as the "Classic" risk. Add Low and High risk tables, each exactly 98% (exact enumeration over 7⁵). Gems drop in one by one; the hand name lights up.

### video-poker
**Video Poker** · accent `#6366f1`
9/6 Jacks or Better, single 52-card deck, 5 coins: royal flush 800, straight flush 50, quads 25, full house 9, flush 6, straight 4, trips 3, two pair 2, jacks or better 1. RTP with optimal holds = 99.54%. Deal, hold (click or keys 1–5), draw. Optimal-hold hint toggle. Auto holds optimally, so it needs a fast exact hold-EV solver (cache by hand pattern). The eval must play the same strategy and match its exact RTP.

### coin-flip
**Coin Flip** · accent `#fbbf24`
Pick Heads or Tails (or Random) each flip; each correct call multiplies the cash-out by 1.98 (RTP 99% per flip). Up to 20 flips; cash out any time after a win. 3D-ish flip animation and a streak row.

### rps
**Rock Paper Scissors** · accent `#e879f9`
Each round you pick, the house picks uniformly. A win multiplies by 1.98, a draw continues at the same value, a loss busts. P(win before loss) = ½, so each round is fair after RTP 99%. Cash out after any win. Streak row.

### darts
**Darts** · accent `#84cc16`
A dartboard whose rings (bull, inner, triple band, outer, miss) have probabilities equal to their area share under a uniform landing on the board disc, so the area is the odds. Difficulty Easy/Medium/Hard/Expert sets the ring multipliers, each normalised to exactly 99%. The dart flies to a sampled point; the ring lights.

### cases
**Cases** · accent `#f472b6`
Difficulty Easy/Medium/Hard/Expert, each a case with a discrete multiplier distribution (e.g. Easy 0.5×–10×, Expert 0×–1000×) normalised to exactly 99%. Opening scrolls a reel of items that stops on the drawn one (the reel's neighbours are cosmetic). Show the case contents with chances.

### snakes
**Snakes** · accent `#4ade80`
A 12-square loop board; each roll of two dice moves the token by the sum. Squares hold multipliers (×) or snakes (bust). Difficulty sets the snake count. Every roll is priced fair: the probability-weighted factor over the reachable squares is 1, with RTP 99% applied once. The value accumulates; cash out between rolls.

### tarot
**Tarot** · accent `#c084fc`
Three cards are drawn and revealed left to right; each shows a multiplier, and the payout is their product. Risk Low/Medium/High sets each card's distribution, chosen so E[card]³ = 0.99 exactly. Dramatic staged reveal; no cash-out (instant).

### reels
**Reels** · accent `#f97316`
A 5×3 slot with 20 fixed paylines. Geometric symbols (gems and shapes): wild (substitutes, can't replace scatter) and scatter (3/4/5 anywhere → 10/15/20 free spins at 2×, retriggerable). Provide three reel sets (Low/Medium/High volatility), each with RTP computed **exactly**:
- line EV from per-reel symbol frequencies (every line has the same distribution);
- scatter counts from per-reel strip windows;
- free-spin EV as a geometric series.

Target ≈ 97%; declare each set's exact RTP as a per-config rtp. Win-line highlights, big-win banners, Turbo and Auto spin.

### sic-bo
**Sic Bo** · accent `#fb7185`
Three dice. Standard table: Big/Small 1:1 (lose on triples), Odd/Even 1:1 (lose on triples), specific totals 4–17 with standard pays (4/17: 60, 5/16: 30, 6/15: 17, 7/14: 12, 8/13: 8, 9/12: 6, 10/11: 6), single number 1:1/2:1/3:1, two-dice combination 5:1, specific double 10:1, specific triple 180:1, any triple 30:1. Exact per-bet RTP by enumeration (216 outcomes), with a per-config rtp for a representative set. Chips on the table; dice tumble.

### dragon-tiger
**Dragon Tiger** · accent `#f97316`
One card each to Dragon and Tiger from an 8-deck shoe; the higher rank (A low) wins. Bets: Dragon/Tiger 1:1 (half back on a tie), Tie 8:1, and suited tie 50:1 if exact. Exact per-bet RTP; chips and card flips.

### craps
**Craps** · accent `#22d3ee`
The standard pass/don't pass flow: come-out roll, point, roll until point or 7. Bets: Pass, Don't Pass (bar 12), Odds behind pass (true odds), Field (2 and 12 pay 2:1), Any 7 (4:1), Any Craps (7:1). Exact per-bet RTP via the Markov chain, with a per-config rtp. Two-dice animation, point puck, rules overlay. Multi-step (a round = one pass-line decision).

### leverage
**Leverage** · accent `#22c55e`
A **simulated** price (clearly labelled, no real market data) follows a fair random walk (geometric, mean-zero drift). Pick Up or Down and leverage 2×–1000×; the bust price is where the loss equals the stake. The position's value is the martingale stake × (1 + leverage·return), clamped at 0 when busted. Close any time; an auto close sets take-profit and stop-loss levels. RTP is set exactly by an entry fee (value starts at 0.99·stake). Use a price lattice where every step moves the value by an exact amount and the bust level is hit exactly, never jumped past. A discrete step that overshoots the bust and gets clamped to 0 would leak value to the player. Chart with entry, bust and current price lines.
