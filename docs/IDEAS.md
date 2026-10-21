# Game ideas backlog

Single-player Originals concepts, scored against the brief:

1. Gameplay can be fast or slow
2. Volatility is player-customisable
3. Win condition is clear
4. Win probability is visually obvious as the round plays out
5. Checkpoints where the player can pause and cash out
6. Works as pure geometry, with no theme required

None of these is a reskin of mines or crash. Each is built on a different piece of maths, and every one can price cash-outs at fair value (cash-out = RTP × P(win | state) × prize), so no strategy beats any other and the eval is a single RTP check.

Already on the reference site, so not repeated here: Laser, Proximity, Shapes/Nearest, Battleships.

| # | Name | Maths | Core loop | How the odds are visible | Volatility knob |
|---|------|-------|-----------|--------------------------|-----------------|
| 1 | **Drift** | Gambler's ruin (1D random walk) | A dot random-walks between a red wall and a green wall. Reach green to win. Checkpoint every few steps. | P(win) is the dot's distance from the red wall as a share of the corridor width. The position *is* the probability. | Start position (closer to red pays more), corridor width (longer rounds), step bias |
| 2 | **Percolate** | Bond percolation / graph connectivity | A grid of edges is revealed column by column, and each edge is open with probability p. Win if an open path crosses from left to right. | A live P(connect) meter computed exactly over column states, with reachable nodes lit up. | p, grid height, grid length |
| 3 | **Circuit** | Network reliability | Pick a topology (series = swingy, parallel = safe), then edges fail or survive one by one. Win if S stays connected to T. | Surviving paths glow, dead branches grey out, and a reliability meter tracks the odds. | Topology choice *is* the volatility selector |
| 4 | **Snowball** | Pólya urn | Draw a ball and put it back with another of the same colour. Win if blue holds the majority after T draws. | A two-colour bar that visibly snowballs. The bar's split is the current odds. | Starting ball count (few = wild swings), T |
| 5 | **Pack** | Continuous bust / stick filling | Random-length segments drop into a bar. Each one that fits raises the multiplier, and an overflow busts. | The remaining gap beside a ruler marked with the max segment length: P(next fits) = gap ÷ max. | Max segment length, bar length |
| 6 | **Collision** | Birthday problem | Balls drop into N bins one at a time, and the round busts when a bin gets a second ball. | The share of empty bins is the chance the next ball is safe. Bins fill up and the risk rises visibly. | N bins |
| 7 | **Gaps** | Geometric tower | A ball falls through a stack of walls, and each wall's gap is the win chance for that row. The player sets each gap's width *per row*. | The gap's width is the probability. | Per-row gap width: volatility you can change in the middle of a round |
| 8 | **Tightrope** | Ballot problem / random walk with an absorbing floor | A path is drawn step by step and must stay above the floor for T steps. | Height above the floor plus steps left, with a probability fan shown ahead of the path. | Starting height, T |
| 9 | **Fence** | Area ratio in a shrinking polygon | Random points drop into a square, and each must land inside the fence, which shrinks after every hit. | The fence's area as a share of the square is the next point's odds. | Shrink rate per hit |
| 10 | **Escape** | 2D harmonic measure | A token random-walks on a hex board. Exit through a green edge to win, a red edge to lose. | A heat-map of exit odds from every cell, plus green and red arc lengths. | Green/red split of the border |

## Shortlist

- **Drift**: the odds are literally the dot's position, so it's the easiest to read at a glance. Pace is tunable from instant to tense, and it fits a 3D or live show well (a ball on a track).
- **Percolate / Circuit**: real graph theory, and the board looks unlike anything in the category. Circuit's "pick a topology" step is a volatility control players can see.
- **Snowball**: a probability concept no other Originals game uses, built on one bar that snowballs.

## Eval rubric (automatable)

| Check | Pass |
|---|---|
| Measured RTP vs target | within 4 SE across every config and a sampled strategy (`npm run eval`) |
| Strategy independence | the same RTP for "cash at step k" for every k |
| Volatility range | std dev ratio between the lowest and highest settings ≥ 5× |
| Round length | median steps per round in the 1–15 range, with checkpoints in ≥ 50% of rounds |
| Odds legibility | P(win) is a single on-screen quantity (a length, area or count), not a number the player must compute |
| Theme independence | the concept explains in one sentence using only shapes |
