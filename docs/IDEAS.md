# Game ideas backlog

Single-player Originals concepts, scored against the brief. The maths-first batch of 39 built games is in `docs/CATALOGUE.md`.

1. Gameplay can be fast or slow
2. Volatility is player-customisable
3. Win condition is clear
4. Win probability is visually obvious as the round plays out
5. Checkpoints where the player can pause and cash out
6. Works as pure geometry, with no theme required

Already on the reference site, so not repeated here: Laser, Proximity, Shapes/Nearest, Battleships.

## The design rule

Choose a game state where the win probability is something visible: a position, an area or a count. Then price cash-out as

> **cash-out = RTP × prize × P(win | what's on screen)**

Under this rule, cashing out is worth exactly the RTP whenever you do it. Because no stopping strategy beats any other, the eval reduces to one RTP check. It also means the odds are always on screen, and you can place a checkpoint anywhere. Underneath, it's a martingale, and any martingale you can draw becomes a game. That gives a mechanical filter for generated concepts: **is the dominant on-screen quantity literally the win probability?**

## Tier 1 (built: see `games/`)

| Game | Loop | Odds on screen | Volatility knob |
|---|---|---|---|
| **Slice** | A dot is hidden in a square. Random cuts discard the half without it. Is it inside your circle? | The share of the remaining region your circle covers | Circle size |
| **Drift** | A dot random-walks between a red wall and a green wall. Reach green to win. | The dot's position (P(win) = x/W), and the cash-out value can fall | Start position |
| **Overhang** | Blocks stack with random sideways offsets. If the tower topples, you lose. | The width of the safe landing zone on the top block | Offset range |
| **Snowball** | Pólya urn: each ball drawn goes back with a twin. Win if your colour holds the majority after N draws. | The two-colour bar's split and an exact win meter | Starting counts, underdog start |
| **Circuit** | Get power from S to T across a network whose wires fail at random. | A live reliability meter, with dead branches greyed out | Network shape (series to parallel) |

## Tier 2 (promising, needs a twist)

| Idea | Loop | Odds on screen | Concern |
|---|---|---|---|
| **Skyline** | Each new bar must be taller than every bar before it | The empty space above the tallest bar | Close to HiLo, but continuous and with no player choice |
| **Full Set** | Light all 6 segments of a hexagon before the draws run out | Segments missing versus draws left | Needs a meter, because the picture alone doesn't show the odds |
| **Pack** | Random-length pieces drop into a bar. Overflow busts. | The remaining gap against a ruler of the longest piece | A tower game with changing odds, carried by the visual |
| **Percolate** | Grid edges are revealed column by column. Connect left to right. | The lit region still reachable from the left | Heavy to compute exactly, and hard to read on big grids |

## Cut, and why

- **Collision** (birthday problem): mines with the player's choice removed.
- **Gaps / Fence**: tower with a geometric reskin. This is the "frozen lake" trap.
- **Escape** (2D walk): the odds aren't visible without a heat-map.
- **Secretary / choice-driven mazes**: RTP depends on skill, which breaks "the same return whatever you do".

## Eval rubric (automatable)

| Check | Pass |
|---|---|
| Measured RTP vs target | Within 4 standard errors across every config and sampled strategy (`npm run eval`) |
| Strategy independence | Same RTP for "cash at step k" for every k |
| Volatility range | Std-dev ratio between the lowest and highest settings ≥ 5× |
| Round length | Median steps per round between 1 and 15, with a checkpoint reached in at least 50% of rounds |
| Odds legibility | P(win) is a single on-screen quantity (a length, an area or a count) |
| Theme independence | The concept can be explained in one sentence using only shapes |
