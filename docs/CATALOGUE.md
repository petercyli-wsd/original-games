# Maths-first Originals: catalogue

The 39 kit-based games below were designed from a theorem outwards, built against the brief and the eval rubric in `docs/IDEAS.md`, and checked for uniqueness against each other, the existing games in `games/`, and the reference site's core list (Dice, Limbo, Crash, Mines, Plinko, Keno, Blackjack, Baccarat, Proximity, Coin Flip, HiLo, Laser, Shapes, Battleships). Build conventions are in `docs/BUILDING-GAMES.md`, and `games/half-moon` is the reference implementation.

## The maths in one page

**Fairness comes from one theorem.** Put a game in any state S whose win chance you can compute exactly, and price the cash-out as

> V(S) = RTP × prize × P(win | S).

V is a martingale. By optional stopping, the expected value at *any* stopping time equals V(start) = RTP. Every cash-out strategy, auto-rule or player choice is therefore worth exactly 99%. Three consequences:

- One eval checks every strategy (it still samples many).
- Checkpoints can go anywhere.
- The design question shrinks to: *can the player see P(win | S)?*

**Volatility is free once P is visible.** A binary bet with win chance p pays RTP/p, and its standard deviation is RTP·√((1−p)/p). Any knob that moves p by 25:1 gives the rubric's ≥5× spread in standard deviation, with RTP unchanged.

**Where visible probabilities come from:**

| Source | Why P is a picture | Games |
|---|---|---|
| Uniform position on a line or circle | P = a length or an angle | Half Moon, Needle, Snap, Chords, Lighthouse, Core |
| Uniform position in a region | P = an area | Convex, Line Cut (Crofton: P ∝ perimeter), Quadrant |
| Harmonic functions | Level sets you can draw (rings, arcs) | Halo (harmonic measure), Pearson Walk |
| Exchangeability and symmetry | P = a count ratio | Last Light, Records, Doors, Call It, Mismatch, Pascal |
| Combinatorial structure | P from exact counting | Loops, Patience, Ramsey, Penney, Noughts, Sperner, Full Set |
| Generating functions / Markov chains | P from a small recursion | Branching, Half-Life, Landing, Tumble, Knight |
| Bayes' rule | P = the posterior bar | Bayes, Doors |
| Number theory densities | P = lit dots among candidates | Prime Time, Line of Sight, Slide Rule, Factor |
| Algorithms on random input | P = red slots / intervals | Deep (random BST), Probe (linear probing), Two-Tone, Snake |

**Dynamics tags** (for the uniqueness check, because "mines with a new skin" is the trap):

- **L (ladder):** bust or climb.
- **M (martingale):** the odds can swing back up as well as down.
- **S (staged reveal):** two to four reveals that redraw the geometry.
- **C (choice):** the player picks an element, but EV is invariant to which one.

Ladders are capped at about a third of the roster, and each one has a different law for how its danger evolves.

## Roster

| # | id | Name | Theorem | Dyn. | Mechanic | Uniq. | Closest existing → fundamental difference |
|---|---|---|---|---|---|---|---|
| 1 | half-moon | Half Moon | Wendel's semicircle theorem, n/2ⁿ⁻¹ | L | geometry | 4 | Arc Climb (template) → risk is the span of *all* points so far, which grows and shrinks with free drops |
| 2 | needle | Needle | Buffon's needle 2ℓ/πd (and Laplace grid) | S | geometry | 4 | Laser → one object, angle-arc odds after the centre lands |
| 3 | snap | Snap | Broken stick → polygon iff no piece ≥ ½ | M,C | geometry | 3 | Half Moon (dual event) → you place the first break; odds *rise* as cuts land in the long piece |
| 4 | chords | Chords | Non-crossing matchings = Catalan(n)/(2n−1)!! | L,S | combinatorics | 4 | Half Moon → planar regions on a circle; the second endpoint must find its region |
| 5 | lighthouse | Lighthouse | Cauchy distribution (beam angle → tan) | S | geometry | 4 | Limbo → heavy-tailed geometry; the odds are the beam sector |
| 6 | line-cut | Line Cut | Cauchy–Crofton: P(line hits K) = perimeter/2πR | S,C | geometry | 5 | Slice → random *lines*; the shadow width is the odds; a thin rod is as easy to hit as a disc |
| 7 | pearson | Pearson Walk | Pearson/Kluyver: n unit steps end within 1 w.p. 1/(n+1) | M | random-walk | 4 | Drift → 2D, radial iso-odds rings, fixed number of steps |
| 8 | convex | Convex | Sylvester / Valtr: [C(2n−2,n−1)/n!]² | L | geometry | 4 | Shapes → the risk is the hull plus its "swallow cones", shaded |
| 9 | halo | Halo | Harmonic measure in a disc (Poisson kernel) | M | random-walk | 5 | Drift → 2D Brownian exit; iso-odds arcs through the arc's endpoints |
| 10 | roots | Roots | Random quadratic has real roots w.p. (41+6 ln 2)/72 | S | number-theory | 4 | Dice → coefficients revealed one by one; the odds are an interval on the b-axis |
| 11 | prime-time | Prime Time | Prime number theorem density / exact prime counts | S,C | number-theory | 4 | Keno → hidden number's digits revealed; lit primes among the candidates |
| 12 | slide-rule | Slide Rule | Benford's law from products (log-uniform mantissa) | M | number-theory | 4 | Wheel → log-scale dial; sector widths are the digit odds |
| 13 | loops | Loops | Cycle structure of permutations (100 prisoners, ln 2) | M | combinatorics | 5 | none → follow a permutation's loops; every loop must stay under the limit |
| 14 | records | Records | Rényi: record indicators independent, P = 1/i | M | combinatorics | 4 | HiLo → bet on the *count* of records; each new item drops into one of i ranks |
| 15 | patience | Patience | Patience sorting piles = longest increasing subsequence | M | combinatorics | 5 | none → cards build piles; finish with ≤ k piles |
| 16 | penney | Penney | Penney's game / Conway's leading numbers | M,C | combinatorics | 5 | Coin Flip → race of two patterns; non-transitive odds |
| 17 | noughts | Noughts | Random-play tic-tac-toe (X 58.5%, O 28.8%, draw 12.7%) | M | combinatorics | 4 | none → back X, O or a draw in random play; exact game-tree odds |
| 18 | pascal | Pascal | Uniform lattice paths, binomial counts | M,C | combinatorics | 4 | Plinko → paths are *uniform* (not 50/50 steps); Pascal numbers on every cell |
| 19 | sperner | Sperner | Sperner's lemma: rainbow triangles are odd in number | M | combinatorics | 5 | none → topology-guaranteed colourings; bet on exactly one rainbow |
| 20 | ramsey | Ramsey | R(3,3) = 6 | L,C | graph | 5 | Mines → choose an edge; its risk (0, ½, 1) is visible; Ramsey guarantees a forced end |
| 21 | two-tone | Two-Tone | Random graph stays bipartite (no odd cycle) | L | graph | 4 | Circuit → growing graph; the 2-colouring shows exactly which edges kill |
| 22 | last-light | Last Light | Cover time of a cycle: last vertex is uniform | M,C | random-walk | 5 | Drift → pick a lamp; win if it's the *last* to light |
| 23 | snake | Snake | Self-avoiding random walk | L | random-walk | 4 | none → random direction each step; the free arrows are the odds |
| 24 | deep | Deep | Random binary search tree height | L | graph | 5 | none → keys build a BST; red intervals would exceed the height limit |
| 25 | probe | Probe | Linear probing / primary clustering (Knuth) | L | combinatorics | 4 | none → hash keys into a ring; red cells overflow the probe limit |
| 26 | branching | Branching | Galton–Watson extinction via generating functions | M | process | 5 | none → a family tree must survive G generations; P = 1−qᶻ |
| 27 | half-life | Half-Life | Exponential races, memorylessness | M,C | process | 4 | Crash → pick an atom to decay last; odds only move at decays |
| 28 | landing | Landing | Renewal theorem: P(hit n) → 2/(d+1) | M,C | process | 4 | Plinko → choose gates on a track; die rolls must land on each |
| 29 | bayes | Bayes | Bayesian updating (posterior is a martingale) | M | inference | 5 | none → which coin is it? the posterior bar is the odds |
| 30 | doors | Doors | Progressive Monty Hall with value-preserving switches | M,C | inference | 5 | none → probability mass flows between doors; switching changes volatility, not value |
| 31 | quadrant | Quadrant | Sheppard's formula ¼ + arcsin(ρ)/2π | S | geometry | 3 | Dice → correlated Gaussian; the correlation knob is the volatility knob |
| 32 | factor | Factor | Erdős–Kac / prime factor counts | M | number-theory | 3 | Prime Time → trial division builds a factor tree; bet on Ω(N) |
| 33 | line-of-sight | Line of Sight | Visible lattice points 6/π² (coprimality) | S | number-theory | 3 | Prime Time → lattice shadows from the origin |
| 34 | mismatch | Mismatch | Derangements → 1/e | M | combinatorics | 3 | Mines → slots whose token is already placed are safe; count bets |
| 35 | full-set | Full Set | Coupon collector, k!S(n,k)/kⁿ | M | combinatorics | 3 | IDEAS backlog → budgeted draws with exact meter |
| 36 | core | Core | Helly's theorem in 1D: intervals share a point | L | geometry | 3 | Slice → the common core shrinks; risk = l² + (1−r)² shown as two squares |
| 37 | tumble | Tumble | Markov chain on cube orientations | M | process | 3 | none → a rolling cube; bet on the red face's final place |
| 38 | knight | Knight | Random walk on a graph, stationary ∝ degree | M | process | 3 | none → a random knight; bet on the region after T moves |
| 39 | call-it | Call It | Red-card martingale (Winkler): timing can't help | M | inference | 3 | HiLo → one call at a time of your choosing; the deck bar is the odds |

Uniqueness: 5 = no structural cousin anywhere; 4 = a cousin exists but the risk law, decision or visual quantity is fundamentally different; 3 = a cousin within this batch or repo; worth a prototype, but the first to cut.

## Rejected principles (and why)

| Principle | Reason |
|---|---|
| Birthday problem / Discs / Rooks / Queens | Random drop with a growing forbidden set: Shapes or mines with the choice removed (IDEAS "Collision") |
| Banach matchbox, Ballot theorem, Arcsine law, Voter model / Moran | 1D walks to a boundary or with a fixed horizon: Drift with a different label |
| Records-as-a-ladder (Skyline), Irwin–Hall (Pack/Fill) | Same distribution as each other, and the tower family (Overhang) |
| Last-ball urn (3 colours) | Share-equals-probability bar: Snowball |
| Map colouring, Schur, van der Waerden | Same mechanic as Ramsey (pick an element, random colour, forbidden pattern) |
| Hex / percolation / Hall matching | Network reliability: Circuit |
| Sierpinski (Lucas), Sieve (CRT), Bloom filter | Constant-p ladders: Arc Climb |
| Span over GF(2) | Final step is always 50/50; volatility tops out around 3.5× (fails the ≥5× rule) |
| Airplane seat puzzle | Live odds are constant until the very end, so checkpoints carry no information |
| Kingman coalescent | Constant-structure ladder (bust chance 1/C(k,2)) |
| Secretary problem | Fair locking at i/n fixes the skill issue, but the visual collapses into Records |
| Monte Carlo π, CLT window bets | Binomial window bets: Plinko and Dice |
| Kruskal count, Collatz, Game of Life, DLA | No exact probability, so no exact pricing |
| Spaghetti loops, Prüfer codes | Constant-risk ladders |

## Specs

Each spec gives the loop, the odds on screen, the volatility knobs, checkpoints, pricing and pitfalls. Builders may refine details but must keep the theorem, the visible-odds quantity and exact pricing.

### needle
**Needle** · geometry · accent `#ffd166` · S
Floor with parallel lines 1 apart (a "Grid" floor adds perpendicular lines: Buffon–Laplace). The player sets needle length ℓ ∈ [0.1, 1] (slider) and backs **Cross** or **Miss**. Lines: P(cross) = 2ℓ/π. Grid: P(cross any) = (4ℓ − ℓ²)/π.
Stage 1, the centre lands (x, y uniform in a cell). Checkpoint: P(cross | centre) = fraction of directions θ ∈ [0, π) for which the needle reaches a line. Draw it literally: a circle of radius ℓ/2 around the centre with the crossing directions shaded. For lines it's 1 − (2/π)·arcsin(2y/ℓ) when 2y < ℓ (y = distance to the nearest line), else 0. Stage 2: the needle spins and settles at uniform θ. Prize = RTP/P(side); cash-out at the checkpoint = prize × P(side | centre). Add a multi-needle option only if it stays exact.

### snap
**Snap** · geometry · accent `#ff9f43` · M, C
A stick [0, 1]. The player places the first break x (slider or drag) and picks the number of random breaks k ∈ {1, 2, 3, 4}. The random breaks drop one at a time. Win if, at the end, the pieces can form a polygon ⟺ every piece < ½. At most one piece is ≥ ½ (the "long piece", length ℓ). With m breaks left: P(win) = Σⱼ Bin(j; m, ℓ)·S(j, ℓ), where S(j, ℓ) = P(j uniform cuts split ℓ into pieces all < ½) = Σᵢ (−1)ⁱ C(j+1, i)·(1 − i/(2ℓ))₊ʲ. If no piece is ≥ ½, P = 1: auto-pay. Show a ½-ruler and the long piece. For the last break, the zone that fixes it, the middle (ℓ − ½, ½) of the long piece, is literally green. Prize = RTP/P₀ (after the player's break); checkpoints after each random break. Note the duality with Half Moon in the info modal.

### chords
**Chords** · combinatorics · accent `#4cc9f0` · L, S
Chords are added to a circle one at a time. Lose if two chords cross. Existing chords cut the boundary into regions (faces); region r owns arcs of total length Lᵣ (fraction of the circle). A new chord survives iff both endpoints land in the same region.
Use the value-preserving two-stage reveal:
- Before the chord, P(survive) = Σ Lᵣ², shown as a stacked bar of region shares.
- The first endpoint lands in region r. The value becomes V·Lᵣ/ΣL², which can rise or fall, and region r's arcs glow (their length is the odds).
- On the second endpoint, if safe, V·Lᵣ/ΣL² / Lᵣ = V/ΣL².

Per-chord factor ≤ (c+1) for c existing chords (Cauchy–Schwarz), so maxMultiplier = RTP × N!. Target N ∈ {3, 4, 5, 6, 8} chords auto-cashes. Reference: P(N random chords non-crossing) = Catalan(N)/(2N−1)!! (N=3: 1/3, N=5: 0.0444, N=8: 7.05e-4).

### lighthouse
**Lighthouse** · geometry · accent `#ffe066` · S
A beacon at height h above a straight shore; the beam stops at a uniform angle in (−90°, 90°) and hits the shore at x = h·tan θ (Cauchy). The player chooses a window [a, b] on the shore (presets near, mid, far, very far, plus drag). P(win | h) = (atan(b/h) − atan(a/h))/π: the sector angle from the beacon to the window ends over 180°. Draw that sector.
Stage 1, the tower rises to a random height h ~ U[h₁, h₂] (checkpoint: the sector redraws). Stage 2, the beam sweeps and stops. Prize = RTP / E_h[P]. Use the closed form ∫atan(c/h)dh = h·atan(c/h) + (c/2)·ln(h² + c²). Restrict windows so P ≥ 1/200.

### line-cut
**Line Cut** · geometry · accent `#80ed99` · S, C
A disc arena of radius 1 with several convex shapes inside: a big disc, a square, a thin rod, a triangle and a dot. A random line (Crofton measure: direction φ ~ U[0, π), offset p ~ U[−1, 1]) is drawn. Pick one shape and back **Hit** or **Miss**. P(hit K) = perimeter(K)/(2π). The surprise is that a rod of length L has perimeter 2L, so it's as hittable as a disc of perimeter 2L.
Stage 1, the direction is revealed. Checkpoint: P(hit | φ) = width of K perpendicular to φ ÷ 2, drawn as the shape's shadow on a ruler (literal length). Stage 2, the offset; the line appears. Layout fixed per volatility level or chosen from presets; prize = RTP/P.

### pearson
**Pearson Walk** · random-walk · accent `#ff70a6` · M
A walker starts at the centre of a unit "home" circle and takes n unit steps in uniformly random directions (n ∈ {2, 3, 4, 6, 9}). Win if it ends inside the home circle. P = 1/(n+1) (Kluyver), prize = RTP·(n+1).
Live: Pₖ(r) = P(end inside | distance r, k steps left), radial. P₁(r) = arccos(r/2)/π for r ≤ 2. Pₖ(r) = (1/π)∫₀^π Pₖ₋₁(√(r² + 1 + 2r cos φ)) dφ. Tabulate with high-resolution quadrature and interpolation, and test Pₖ(0) = 1/(k+1) to 1e-6. Draw iso-probability rings for the current k (labelled 50/25/10/5%); on the last step, shade the arc of directions that land home. Checkpoint after each step.

### convex
**Convex** · geometry · accent `#43aa8b` · L
Points drop uniformly into a square; survive while every point is a vertex of the convex hull. The first 3 drops are free. Bust region = hull interior ∪ for each hull vertex v the "swallow cone" {v + s(v−u) + t(v−w): s, t ≥ 0} (u, w are v's hull neighbours), clipped to the square. Shade it red; its area is the risk (compute exactly with convex polygon clipping and inclusion–exclusion or slab decomposition; test by sampling). Per-step factor 1/(1−q) with the max-win cap. Target N ∈ {5, 6, 7, 8}. Reference: Valtr P(N in convex position) = (C(2N−2, N−1)/N!)². Option: a triangle arena.

### halo
**Halo** · random-walk · accent `#a0c4ff` · M
A unit disc with a green arc G (size 10°–180°) on the boundary. A particle starts at the centre and moves by Brownian motion until it hits the boundary; win if it exits through G. P(win | z) = harmonic measure ω(z, G). Map z → 0 by φ(w) = (w − z)/(1 − z̄w); ω = (mapped arc length)/2π. At the centre P = |G|/360°, prize = RTP·360/|G|.
Movement is exact "walk on circles": each hop jumps to a uniform point on a circle centred at the particle with radius ½·(distance to the boundary). ω is harmonic, so it's a martingale. When the distance is < 0.02, sample the exit point exactly (uniform at 0 in the mapped disc, mapped back). Draw iso-odds level sets: circular arcs through G's endpoints (10/25/50/75/90%). Checkpoint after each hop or burst. Optional start offset or arc-size slider.

### roots
**Roots** · number-theory · accent `#c77dff` · S
y = ax² + bx + c with a, c ~ U(−1, 1) and b ~ U(−B, B), B ∈ {0.5, 1, 2, 4}. Back **Real roots** or **No real roots**. Reveal a, then c, then b; the parabola morphs.
- After a and c: if ac ≤ 0, real roots are certain; else P(real) = max(0, 1 − 2√(ac)/B), shown as red/green zones on a b-axis ruler.
- Before that: P(real) = ½ + ½∫₀^{min(1, B²/4)} (1 − 2√t/B)(−ln t) dt.
- After a only: integrate over c.

(B = 1 gives (41 + 6 ln 2)/72.) Prize = RTP/P(side).

### prime-time
**Prime Time** · number-theory · accent `#ffb4a2` · S, C
A hidden integer N uniform in [10^(d−1), 10^d − 1], d ∈ {2, 3, 4, 5}. Bet: **Prime**, **Perfect square**, or **Not prime** (or similar, so P ranges at least 25:1). Digits are revealed one at a time; the player chooses which digit to reveal next (choice is EV-neutral). Board: the candidate set consistent with the revealed digits as a dot grid (bucketed when large) with qualifying numbers lit. The lit fraction is the odds. Prize = RTP/P; exact counts by sieve.

### slide-rule
**Slide Rule** · number-theory · accent `#e9c46a` · M
Start at 1; multiply k times (k ∈ {1, …, 6}) by a random factor from {2, …, 9}. Bet on the final product's leading digit d. Exact P by enumerating the remaining factor combinations (8^k ≤ 262,144; cache by state). Board: a circular log-scale dial (slide rule). The current mantissa is a pointer; digit sectors use Benford widths log₁₀(1 + 1/d) as reference, and the possible landing points of the next factor are ticks. Live odds per digit as bars around the dial. Prize = RTP/P(d). Explain Benford in the modal.

### loops
**Loops** · combinatorics · accent `#2ec4b6` · M
n boxes in a ring (n ∈ {8, 12, 20, 30}) hide a random permutation. The cycle-following procedure opens boxes: start at the lowest unvisited box, follow the number inside to the next box, until the loop closes. Win if every loop has length ≤ L (limit; presets n/2 → 1 − ln 2 asymptotically, plus 2n/3, 3n/4, n/3).
Live: with an open chain of length ℓ and m unseen boxes, the next box closes the loop w.p. 1/(m+1). f(ℓ, m) = [1/(m+1)]·[ℓ ≤ L]·q(m) + [m/(m+1)]·f(ℓ+1, m−1), where q(m) = (1/m)·Σ_{k ≤ min(L, m)} q(m−k). Draw the loop ruler (current loop length vs the limit) and arrows between boxes. Checkpoint at each loop closure, plus every few opens inside a long loop.

### records
**Records** · combinatorics · accent `#ff8fab` · M
n items (n ∈ {10, 20, 50, 100}) arrive one by one. Each new item drops into a uniformly random rank slot among the i items so far (an insertion ladder with i slots; the top slot is a record, so the odds are 1 in i, literally). Bet: **at least k records** (k chosen; E = Hₙ). Live P via a Poisson-binomial DP over the remaining independent Bernoulli(1/j). Checkpoint after each item (bursts for large n). Prize = RTP/P. The modal notes the equivalence with permutation cycles (Foata).

### patience
**Patience** · combinatorics · accent `#90be6d` · M
Cards 1..n (n ∈ {8, 10, 12}) are shuffled and dealt into piles by patience sorting: each card goes on the leftmost pile whose top is higher, else it starts a new pile on the right. Piles = longest increasing subsequence. Bet: finish with **≤ k piles** (or ≥ k). Live P exact by memoised DP over (remaining set, pile tops). A remaining card starts a new pile iff it's above the rightmost top, so highlight those cards in the remaining-deck strip; their count over the remaining count is the next-card odds. Checkpoint after each card.

### penney
**Penney** · combinatorics · accent `#f9c74f` · M, C
A coin (or two colours) flips repeatedly. The player picks a win pattern A and a lose pattern B (length 2–4, A ≠ B; presets include Penney's classic pairs). The first to appear decides. P(A first) by an absorbing Markov chain on the Aho–Corasick automaton of {A, B} (or Conway leading numbers). Live P from the current automaton state. Board: the flip strip, plus two progress meters showing how much of each pattern is matched by the current tail. Restrict pairs so P ≥ 1/32. Checkpoint after each flip.

### noughts
**Noughts** · combinatorics · accent `#8ecae6` · M
X and O play uniformly random legal moves on 3×3; X moves first. Back **X wins** (≈58.5%), **O wins** (≈28.8%) or **Draw** (≈12.7%). Live P exact by memoised enumeration of the game tree under random play. Show each empty cell's effect on the odds as a small heat tint when useful, and the threat lines. Checkpoint after each move. Optional extra variant (e.g. 4×4 with 3-in-a-row) only if the enumeration is fast.

### pascal
**Pascal** · combinatorics · accent `#b8f2e6` · M, C
A grid of w×h steps. A uniformly random monotone lattice path (right/up) from the bottom-left to the top-right is drawn one step at a time: step right with probability paths(after right)/paths(here). The player picks target cells (one or several on the same anti-diagonal). Win if the path passes through one. Cells display Pascal counts; P = paths(start→cell)·paths(cell→end)/paths(start→end). Live from the current position. Sizes 4×4, 6×6, 8×8. Prize = RTP/P.

### sperner
**Sperner** · combinatorics · accent `#ff4fa3` · M
A big triangle with corners R, G, B, subdivided into m² small triangles (m ∈ {3, 4, 5}). Boundary vertices on side XY get colour X or Y at random (½ each); interior vertices get one of three colours uniformly. Sperner's lemma guarantees an odd number of rainbow small triangles. Bet: **exactly 1 rainbow** vs **3 or more** (vs **5 or more**). Vertices are coloured one at a time. Live P exact by enumeration or memoised DP over the remaining vertices (precompute per configuration). Highlight rainbow triangles as they appear.

### ramsey
**Ramsey** · graph · accent `#f15bb5` · L, C
A complete graph on a polygon. The player picks an uncoloured edge; it's coloured at random from c colours. Lose if a monochromatic triangle appears. Each edge shows its risk: the share of colours that would complete a triangle (0, ⅓, ½, ⅔ or 1). Edges with risk 1 are disabled. If only risk-1 edges remain, the round auto-cashes. Per-pick factor 1/(1−q). Include a "random edge" button.
Modes:
- **K5, 2 colours:** colour all 10 edges to win (possible: 12 good colourings).
- **K6, 2 colours:** R(3,3) = 6, so you must cash out eventually.
- **K8, 3 colours:** with the max-win cap.

### two-tone
**Two-Tone** · graph · accent `#cdb4db` · L
n nodes on a ring (n ∈ {6, 8, 10, 12}). Uniformly random new edges (among non-edges) appear one at a time. Survive while the graph is bipartite (no odd cycle). Each component is shown 2-coloured. An edge between same-colour nodes of the same component is fatal, so risk = (#fatal non-edges)/(#non-edges); show it as a count and highlight fatal pairs faintly. Per-step factor; target edge count E auto-cashes; when every non-edge is fatal, auto-cash.

### last-light
**Last Light** · random-walk · accent `#fee440` · M, C
n lamps on a ring (n ∈ {6, 10, 16, 24}); a walker starts on lamp 0 and steps ±1 at random, lighting lamps on the first visit. Pick s lamps (1–3). Win if the last lamp to light is one of yours: P = s/(n−1) (Lovász: the last vertex is uniform). Live: the lit set is an arc [−a, b] with the walker inside. It next extends right w.p. (x + a + 1)/(a + b + 2) (gambler's ruin), then DP over (a, b, side). Checkpoint each time a lamp lights; the walker animates between.

### snake
**Snake** · random-walk · accent `#00f5d4` · L
A grid (7×7 or 9×9). A snake's head moves one cell per step in a uniformly random direction (4 options); its body is every cell visited. Hitting the body or the wall loses. Safe arrows light up; P(survive) = free/4, literally. Per-step factor 4/free; a step with free = 0 auto-cashes (trapped). Target length T ∈ {8, 12, 16, 24} auto-cashes; max-win cap.

### deep
**Deep** · graph · accent `#9b5de5` · L
Keys uniform on [0, 1] are inserted into a binary search tree, drawn above a number line. Height limit H ∈ {3, 4, 5, 6} (root depth 0). The next key's slot is determined by which value-interval between existing keys it falls in. Intervals whose slot would exceed depth H are red; their total length is the risk. Per-step factor, target key count K, max-win cap; all-red auto-cashes.

### probe
**Probe** · combinatorics · accent `#00bbf9` · L
A hash table of m slots in a ring (m ∈ {16, 24, 32}). Each key hashes to a uniform slot and probes forward to the first empty one. Bust if the probe distance exceeds P (P ∈ {1, 2, 3, 5}). Red cells are home slots whose probe would exceed P; risk = red/m. Clusters merge and risk jumps. Per-step factor, target fill K, max-win cap.

### branching
**Branching** · process · accent `#06d6a0` · M
One seed. Each generation, every node independently has 0–3 children from a preset distribution (thin, fragile, steady, booming; means about 0.9–1.7). Win if the family is alive at generation G (G ∈ {3, 5, 8, 12}). P(survive | z alive at gen g) = 1 − q_{G−g}^z, with q_t = f^(t)(0) (iterated generating function). Show "each node's line survives s%" and P = 1 − (1−s)^z. When the population exceeds a display cap, auto-cash at the fair value (P ≈ 1). Checkpoint each generation.

### half-life
**Half-Life** · process · accent `#caffbf` · M, C
k atoms (k ∈ {3, …, 6}) with decay rates 1..k (shown as half-lives). Pick an atom and back it to decay **last** (or **first**). P(i last) = Σ_{S ⊆ others} (−1)^|S| λᵢ/(λᵢ + λ_S); P(i first) = λᵢ/Σλ. Time runs continuously (sample exponential times). By memorylessness the odds only change when an atom decays; the modal makes that the lesson. Checkpoints at each decay.

### landing
**Landing** · process · accent `#ffadad` · M, C
A track of squares 0..60; a d-sided die (d ∈ {4, 6, 10}) advances a token. The player marks 1–4 gate squares; win if the token lands exactly on every gate. u(n) = P(the renewal process hits n) = (1/d)·Σⱼ u(n−j), u(0) = 1, limit 2/(d+1). P = ∏ u(gap). Overshooting a gate loses at once. Highlight the d reachable squares each roll. Prize = RTP/P.

### bayes
**Bayes** · inference · accent `#fdffb6` · M
A coin is secretly drawn as **Gold** (P(heads) = p_G) or **Silver** (p_S) with prior π. Presets: separation subtle/clear (0.55/0.45, 0.7/0.3); prior 50/25/10%. Back Gold or Silver. n flips (n ∈ {5, 10, 20}) are shown one at a time, then the truth is revealed. P(win | flips) = posterior, the literal bar. Prize = RTP/prior(your coin). Show the likelihood ratio per flip.

### doors
**Doors** · inference · accent `#bdb2ff` · M, C
N doors (N ∈ {3, 5, 8, 12}), one prize. You hold a door. The host opens one empty, non-held door per step (uniformly among eligible). After each opening, posteriors update by Bayes with the host likelihoods; bars above the doors show them. At any checkpoint you may switch your hold: value is conserved, prize relocks at value/P(new door). You may also cash out at value. When two closed doors remain, reveal. Prize at start = RTP·N. Bound maxMultiplier honestly (or cap).

### quadrant
**Quadrant** · geometry · accent `#a8dadc` · S
A point from a bivariate normal with correlation ρ ∈ {−0.9, …, 0.9}. Bet **Same sign** (P = ½ + arcsin(ρ)/π) or **Top-right** (¼ + arcsin(ρ)/2π). Draw the ellipse cloud. Stage 1 reveals x (P(y > 0 | x) = Φ(ρx/√(1 − ρ²)), the shaded slice). Stage 2 reveals y.

### factor
**Factor** · number-theory · accent `#f4a261` · M
A hidden N uniform in [2, 9999]. Trial division animates: divide by 2 while possible, then 3, 5, …, building a factor tree. Bet on Ω(N) (prime factors with multiplicity) **≥ k**, or **N prime**. Live P exact over the candidates consistent with what's been revealed.

### line-of-sight
**Line of Sight** · number-theory · accent `#b5e48c` · S
An N×N lattice (N ∈ {10, 20, 50}) seen from the origin. A random point (a, b) is chosen. Win if it is visible (gcd = 1, ≈ 6/π²), or bet **gcd ≥ 2** / **gcd ≥ 3** for volatility. Stage 1 reveals the column a, lighting the visible points in it (the odds). Stage 2 reveals b.

### mismatch
**Mismatch** · combinatorics · accent `#ffcad4` · M
n colour slots and their n matching tokens (n ∈ {5, 8, 12}). Tokens are drawn at random into slots left to right. A token in its own slot is a match. Bets: **no matches** (→ 1/e), **exactly one**, **≥ 2**. A slot whose token is already placed elsewhere is safe; otherwise the next draw matches w.p. 1/remaining. Live P exact by inclusion–exclusion on (remaining tokens, open "own-token" slots, matches so far).

### full-set
**Full Set** · combinatorics · accent `#9bf6ff` · M
k segments of a ring (k ∈ {4, 6, 8, 12}) and a draw budget D. Each draw lights a uniform segment. Win if all are lit within D. Live P = Σⱼ (−1)ʲ C(m, j)(1 − j/k)^d (m missing, d draws left). Show "new segment chance m/k" literally.

### core
**Core** · geometry · accent `#e76f51` · L
Intervals with uniform random endpoints drop onto [0, 1]. Survive while all intervals share a point (Helly in 1D: the core [l, r] is non-empty). Next-interval risk = l² + (1 − r)². Show it literally on an inset unit square of endpoint pairs, with two red corner squares of sides l and 1 − r. Per-step factor, target K, max-win cap. Reference: P(n intervals share a point) = 2ⁿ·(n!)²/(2n)!.

### tumble
**Tumble** · process · accent `#84a59d` · M
A cube with one red face rolls on a grid in a uniformly random direction each step for n steps (n ∈ {3, 5, 8, 12}). Bet the red face ends **on top**, **on the bottom**, or **on a side**. The red face's position is a 3-state chain (top → side; side → top ¼, bottom ¼, side ½; bottom → side). Live P by matrix power.

### knight
**Knight** · process · accent `#d4a373` · M
A knight makes uniformly random legal moves on an 8×8 board for T moves (T ∈ {3, 5, 8, 12}). Bet it ends in a region: rim, centre 4×4, a corner quadrant, or a chosen square. Live P by matrix power. Each square shows its degree; long-run P ∝ degree.

### call-it
**Call It** · inference · accent `#ffc6ff` · M
A deck of r red and b black cards (presets 13/13, 8/16, 5/20, 2/23) is turned over one at a time. At any moment, call "next is red". The prize RTP·(r+b)/r is fixed at the start, and no timing changes the win chance (Winkler's martingale). Cash-out = prize × current red share (the deck bar). The last card forces the call.

## Results

All 39 catalogue games are built and pass the CI checks: typecheck, 451 unit tests (exact formulas against simulation, a one-step martingale check, drawn odds equal to the true risk), `npm run eval` and the platform build. Every game also passed a second 200k-round eval on a seed the builders never used, and a headless-Chrome smoke test (load, bet, play) with no console errors.

The independent adversarial review stage (re-derive the maths, attack the RTP with hostile strategies, play every UI path) did not run: the batch hit the org spend limit first. It is the recommended next step before promoting any game from `prototype`. Known trade-offs the builders flagged:

- Heavy-tailed payouts make the sample RTP noisy on extreme configs (Chords, Convex, Core, Records). The exact martingale tests are the proof of fairness.
- Some settings have high top prizes: Chords 8,886×, Core 6,290×, Probe 56,712×.
- On phones, the round-over card covers part of some boards.
- A few one-shot extreme settings (Snap with one cut, Needle at small p) reach no checkpoint.

Eval at 100k rounds per config (`npx tsx scripts/report.ts`). Spread is the std-dev of the riskiest config divided by the safest; the rubric asks for at least 5×.

| Game | Mechanic | RTP range (z) | Std dev low → high | Spread | Avg steps | Max seen | ok |
|---|---|---|---|---|---|---|---|
| Bayes | inference | 94.80%–98.93% (max \|z\| 2.2) | 0.27 → 5.93 | 22.2× | 6.2–11.0 | 50× | ✓ |
| Branching | process | 98.02%–99.18% (max \|z\| 1.1) | 0.28 → 3.74 | 13.3× | 2.2–3.4 | 36× | ✓ |
| Call It | inference | 98.03%–100.02% (max \|z\| 1.1) | 0.87 → 6.05 | 6.9× | 8.8–13.7 | 50× | ✓ |
| Chords | combinatorics | 97.90%–113.52% (max \|z\| 1.7) | 1.19 → 46.18 | 38.7× | 3.3–4.3 | 8886× | ✓ |
| Circuit | graph | 97.71%–99.17% (max \|z\| 0.9) | 0.50 → 4.36 | 8.7× | 1.7–5.8 | 63× | ✓ |
| Convex | geometry | 96.73%–98.87% (max \|z\| 1.9) | 1.36 → 15.07 | 11.1× | 4.0–4.4 | 2412× | ✓ |
| Core | geometry | 86.07%–98.74% (max \|z\| 1.9) | 1.35 → 21.57 | 15.9× | 2.1–3.0 | 6290× | ✓ |
| Croc Dentist (Solo) | mines | 98.16%–107.72% (max \|z\| 1.8) | 1.48 → 52.25 | 35.3× | 2.2–7.0 | 15349× | ✓ |
| Croc Dentist (vs House) | duel | 98.60%–99.47% (max \|z\| 1.9) | 0.77 → 1.53 | 2.0× | 1.3–4.0 | 38× | ✓ |
| Deep | graph | 98.31%–99.01% (max \|z\| 0.8) | 0.56 → 7.92 | 14.1× | 5.6–8.1 | 125× | ✓ |
| Doors | inference | 98.91%–100.59% (max \|z\| 2.2) | 0.41 → 2.32 | 5.6× | 1.8–8.5 | 12× | ✓ |
| Drift | random-walk | 98.86%–100.03% (max \|z\| 1.5) | 0.65 → 6.47 | 10.0× | 18.4–107.8 | 99× | ✓ |
| Factor | number-theory | 99.00%–102.40% (max \|z\| 2.7) | 0.76 → 8.86 | 11.7× | 2.0–6.0 | 124× | ✓ |
| Full Set | combinatorics | 96.99%–99.03% (max \|z\| 2.8) | 0.33 → 4.44 | 13.4× | 4.3–9.1 | 44× | ✓ |
| Half-Life | process | 98.02%–99.53% (max \|z\| 0.8) | 0.72 → 4.22 | 5.9× | 1.4–2.3 | 60× | ✓ |
| Half Moon | geometry | 89.27%–99.18% (max \|z\| 1.3) | 0.46 → 26.68 | 57.4× | 2.2–4.2 | 4977× | ✓ |
| Halo | random-walk | 95.78%–99.21% (max \|z\| 1.7) | 0.52 → 5.89 | 11.2× | 2.4–4.4 | 71× | ✓ |
| Knight | process | 98.77%–101.64% (max \|z\| 0.6) | 1.11 → 13.29 | 12.0× | 2.4–7.1 | 302× | ✓ |
| Landing | process | 97.77%–98.70% (max \|z\| 1.1) | 0.92 → 18.51 | 20.2× | 2.6–5.5 | 1619× | ✓ |
| Last Light | random-walk | 98.27%–100.13% (max \|z\| 1.6) | 0.65 → 4.37 | 6.7× | 2.1–3.2 | 35× | ✓ |
| Lighthouse | geometry | 96.24%–99.88% (max \|z\| 1.1) | 0.99 → 7.62 | 7.7× | 2.0–2.8 | 161× | ✓ |
| Line Cut | geometry | 98.81%–99.72% (max \|z\| 1.6) | 0.45 → 3.28 | 7.3× | 3.5–4.6 | 49× | ✓ |
| Line of Sight | number-theory | 97.92%–98.86% (max \|z\| 1.0) | 0.68 → 6.26 | 9.3× | 1.8–3.4 | 115× | ✓ |
| Loops | combinatorics | 97.54%–99.11% (max \|z\| 0.7) | 0.55 → 6.84 | 12.5× | 3.7–5.3 | 75× | ✓ |
| Mismatch | combinatorics | 99.08%–100.17% (max \|z\| 0.5) | 0.52 → 12.02 | 23.3× | 3.9–6.5 | 271× | ✓ |
| Needle | geometry | 96.03%–99.15% (max \|z\| 1.2) | 0.67 → 7.76 | 11.5× | 1.8–2.6 | 156× | ✓ |
| Noughts | combinatorics | 98.62%–101.21% (max \|z\| 1.6) | 0.74 → 6.22 | 8.4× | 5.0–6.3 | 61× | ✓ |
| Overhang | geometry | 91.69%–97.64% (max \|z\| 2.5) | 4.87 → 14.51 | 3.0× | 1.3–3.1 | 3610× | ✓ |
| Pascal | combinatorics | 96.76%–100.27% (max \|z\| 1.4) | 0.22 → 10.07 | 46.0× | 3.1–5.7 | 199× | ✓ |
| Patience | combinatorics | 97.90%–98.95% (max \|z\| 1.0) | 0.26 → 7.51 | 28.8× | 4.0–7.0 | 88× | ✓ |
| Pearson Walk | random-walk | 98.79%–99.67% (max \|z\| 0.7) | 0.88 → 5.13 | 5.8× | 2.6–8.6 | 50× | ✓ |
| Penney | combinatorics | 98.49%–99.48% (max \|z\| 1.4) | 0.43 → 3.17 | 7.4× | 3.4–5.4 | 32× | ✓ |
| Prime Time | number-theory | 98.52%–99.19% (max \|z\| 1.9) | 0.32 → 14.62 | 46.0× | 1.8–2.9 | 411× | ✓ |
| Probe | combinatorics | 98.82%–100.83% (max \|z\| 0.5) | 0.37 → 12.73 | 34.4× | 11.0–11.4 | 1553× | ✓ |
| Quadrant | geometry | 96.01%–99.77% (max \|z\| 0.9) | 0.32 → 15.58 | 48.2× | 1.9–2.8 | 722× | ✓ |
| Ramsey | graph | 98.56%–100.88% (max \|z\| 1.3) | 1.08 → 18.16 | 16.8× | 3.7–10.8 | 2926× | ✓ |
| Records | combinatorics | 95.31%–99.96% (max \|z\| 1.4) | 0.51 → 10.49 | 20.6× | 3.7–11.3 | 224× | ✓ |
| Roots | number-theory | 97.26%–100.50% (max \|z\| 2.2) | 0.45 → 7.06 | 15.8× | 2.0–2.2 | 71× | ✓ |
| Scratch | mines | 98.21%–100.68% (max \|z\| 1.9) | 0.71 → 9.93 | 13.9× | 1.0–6.2 | 99× | ✓ |
| Slice | geometry | 98.93%–99.22% (max \|z\| 1.0) | 0.69 → 2.84 | 4.1× | 2.1–3.3 | 25× | ✓ |
| Slide Rule | number-theory | 96.65%–99.24% (max \|z\| 2.7) | 0.58 → 3.89 | 6.8× | 2.8–4.0 | 23× | ✓ |
| Snake | random-walk | 98.94%–101.36% (max \|z\| 0.9) | 0.70 → 14.30 | 20.5× | 2.2–3.6 | 2403× | ✓ |
| Snap | geometry | 98.22%–99.95% (max \|z\| 1.9) | 0.31 → 4.55 | 14.6× | 1.0–2.0 | 33× | ✓ |
| Snowball | urn | 98.94%–100.45% (max \|z\| 2.1) | 0.27 → 5.70 | 21.1× | 4.0–10.5 | 77× | ✓ |
| Sperner | combinatorics | 99.10%–101.11% (max \|z\| 1.7) | 0.46 → 6.23 | 13.7× | 5.3–6.5 | 51× | ✓ |
| Tumble | process | 98.67%–101.79% (max \|z\| 0.9) | 0.60 → 9.93 | 16.7× | 3.0–5.0 | 260× | ✓ |
| Two-Tone | graph | 98.98%–100.17% (max \|z\| 0.5) | 0.30 → 6.81 | 22.9× | 4.7–6.3 | 378× | ✓ |

## Batch 2

Twenty-one more concepts, drawn from areas of maths the first batch did not touch: coding theory, social choice, cooperative game theory, quantum optics, primality testing, permutation patterns, spanning trees and topology. They are checked against all 46 games already in `games/`, the reference-site list and the rejected list above. The build contract is unchanged (`docs/BUILDING-GAMES.md`).

| id | Name | Theorem | Dyn. | Mechanic | Uniq. | Closest existing → fundamental difference |
|---|---|---|---|---|---|---|
| hamming | Hamming | Hamming(7,4) corrects one flip: P = (1−p)⁷ + 7p(1−p)⁶ | M | combinatorics | 5 | none → bits cross a noisy channel; the Venn-diagram code shows which flips it can absorb |
| median | Median | Sample median ~ Beta(m+1, m+1) | M,C | geometry | 4 | Records → tug of war: the median is in your window iff neither side gets m+1 points |
| mediant | Mediant | Stern–Brocot tree, Minkowski ?(x) | M,C | number-theory | 4 | Pascal → fair coin steps land very unevenly on the number line (mediants) |
| thales | Thales | Acute triangle iff C is in the band and outside the Thales circle | S | geometry | 5 | Convex → the third point's winning region is a band minus a disc |
| zigzag | Zigzag | André: P(alternating) = Eₙ/n! (sec + tan) | L | combinatorics | 4 | HiLo → direction forced; safe gap literal; exact boustrophedon polynomials |
| connect | Connect | Erdős–Rényi connectivity within an edge budget | M | graph | 4 | Two-Tone → you need merges before the budget runs out (a race, not survival) |
| spanning | Spanning | Kirchhoff: P(e ∈ UST) = effective resistance; transfer-current determinants | M,C | graph | 5 | Circuit → a uniform spanning tree is revealed edge by edge; edge widths are marginals |
| euclid | Euclid | Euclid's algorithm / continued fractions, gcd density | M | number-theory | 4 | Line of Sight → squares are cut from a fogged rectangle; each cut reveals a quotient |
| waldegrave | Waldegrave | Waldegrave's circulation problem (1713) | M,C | process | 5 | none → winner stays on; first to a streak takes the pot; seats have unequal odds |
| bootstrap | Bootstrap | Bootstrap percolation; perimeter never grows (needs ≥ n seeds) | M | graph | 5 | none → seeds land, then infection spreads; the perimeter budget is a literal bar |
| lasso | Lasso | Winding number of a lattice walk round a hole | M | random-walk | 4 | Drift / Halo → topology: the walk must loop the pole, not reach a wall |
| serials | Serials | German tank problem: posterior ∝ 1/C(N, k) | M,C | inference | 3 | Bayes → a posterior over an unknown maximum, drawn as a histogram you cut at X |
| shunt | Shunt | Knuth's stack sorting: P = Catalan(n)/n! (231-avoiding) | M | combinatorics | 5 | Patience → a railway siding; cars that would jam are red in the queue |
| euler | Euler | Degree parity: the odd-node count is a Markov chain | M | graph | 4 | Two-Tone → parity, not cycles; odd nodes glow |
| gossip | Gossip | Push rumour spreading, ≈ log₂n + ln n rounds | M | process | 4 | Full Set → exponential doubling then a coupon-style mop-up inside a round budget |
| socks | Socks | Sock matching with a bounded table | L | combinatorics | 4 | Mismatch → twins clear pairs; the table fills; risk = tokens without a twin on the table |
| condorcet | Condorcet | Condorcet paradox (≈ 8.8% cycles, Guilbaud) | M,C | inference | 5 | none → random voters; pairwise-majority arrows may form a cycle |
| polarizer | Polarizer | Malus's law cos²Δ and the quantum Zeno effect | L,C | geometry | 4 | Arc Climb → you set each turn angle; the squared projection is the odds |
| witness | Witness | Miller–Rabin strong liars, Bayesian primality | M | number-theory | 4 | Prime Time → random bases test a hidden number; composites survive at their liar rate |
| pivot | Pivot | Shapley–Shubik power index | M,C | combinatorics | 5 | none → weighted voters join in random order; back the one who tips the quota |
| homecoming | Homecoming | Pólya's recurrence theorem (return certain in 1D/2D, ≈ 34% in 3D) | M,C | random-walk | 3 | Pearson Walk → dimension is the volatility knob; return to the origin within T steps |

### hamming
**Hamming** · combinatorics · accent `#7bdff2` · M
A 4-bit message is encoded as a Hamming(7,4) codeword and drawn as the three-circle Venn diagram (data bits in the overlaps, parity bits in the petals). The 7 bits cross a noisy channel one at a time, and each flips independently with probability p ∈ {2, 5, 10, 20, 30}%. The decoder corrects any single flip. Bet **Decoded** (P = (1−p)⁷ + 7p(1−p)⁶) or **Fooled** (the complement). Add 1–4 blocks in a series (P^k) for volatility. Live P from (flips so far, bits left) is exact. Board: the Venn diagram, flipped bits glowing, syndrome circles lighting, and a "flips absorbed f / 1" gauge.

### median
**Median** · geometry · accent `#f4d35e` · M, C
n = 2m+1 points (n ∈ {3, 5, 9, 15, 25}) drop uniformly on [0, 1]. The player drags a window [a, b]. Win if the sample median lands inside. P = Beta(m+1, m+1) mass of [a, b]. The median is inside iff at most m points fall below a and at most m above b. Draw it as a tug of war: two tallies with their m-limits. Live P is an exact multinomial sum over the remaining points with probabilities (a, b−a, 1−b).

### mediant
**Mediant** · number-theory · accent `#c3f584` · M, C
Descend the Stern–Brocot tree from 1/1 (bounds 0/1 and 1/0). Each step goes Left or Right with ½ each, and the value becomes the mediant of the new bounds. After n steps (n ∈ {4, 6, 8, 10}) the fraction is final. The player picks a window on the number line (presets plus drag). P = (#depth-n fractions in the window)/2ⁿ, exact. Live: count the reachable depth-n fractions under the current node that lie in the window. Draw every reachable final fraction as a dot on the number line; the lit dots in the window over all reachable dots are the odds. Mention Minkowski's ?(x) in the modal.

### thales
**Thales** · geometry · accent `#ff9b85` · S
Three points land uniformly in an arena (square, disc or equilateral triangle). Back **Acute** or **Obtuse** (square: P(obtuse) = 97/150 + π/40; disc: P(acute) = 4/π² − 1/8). Stage 1: A and B land (checkpoint). The third point C makes the triangle acute iff C lies strictly between the perpendiculars to AB through A and B **and** outside the circle with diameter AB (Thales). Shade that band-minus-disc region clipped to the arena; its area is the odds, computed exactly. Stage 2: C lands. A series of 1–3 triangles (p^k) widens volatility.

### zigzag
**Zigzag** · combinatorics · accent `#f7aef8` · L
Bars of uniform random height arrive and must alternate up, down, up, down. The next bar's safe zone is literal: above the last bar (chance 1 − x) when an up is due, below it (chance x) when a down is due. André: P(n values alternate starting with up) = Eₙ/n! (Euler zigzag numbers, sec x + tan x). Fixed prize RTP/P. Live P(survive the rest | last value x, next direction) is a polynomial in x (Entringer/boustrophedon), computed exactly by rational polynomial integration. Target length n ∈ {4, …, 12}; optional "either first direction".

### connect
**Connect** · graph · accent `#90f1ef` · M
n nodes (6–10) on a circle. Uniformly random new edges (among non-edges) are added one at a time. Win if the graph is connected once E edges are placed (budget E ≥ n−1). Live P is exact by DP over (multiset of component sizes, number of edges inside components). The next edge merges two components with chance (cross pairs)/(non-edges); show that count literally. The budget relative to n is the volatility knob.

### spanning
**Spanning** · graph · accent `#b8c0ff` · M, C
A uniform spanning tree of a small grid graph (from 3×3 to 4×5 vertices) is revealed edge by edge in a fixed sweep. Each edge is IN with its exact conditional probability: the effective resistance across it after contracting IN edges and deleting OUT edges (Kirchhoff), computed by Laplacian solves. That sequential procedure samples the UST exactly. The player picks 1–3 edges before betting; win if all are in the tree. P = det of the transfer-current matrix (Burton–Pemantle), live on the contracted/deleted graph. Edge widths show the current marginals.

### euclid
**Euclid** · number-theory · accent `#ffd6a5` · M
A hidden pair 1 ≤ b < a ≤ N (uniform; N ∈ {30, 60, 100, 200}). Euclid's algorithm is drawn as squares cut from a rectangle. The unexplored remainder stays a fogged box, and each cut step reveals the next partial quotient. Bet **Coprime** (~6/π²), **Final square ≥ 2**, or **≥ k cuts**. Live P is exact over all pairs consistent with the quotients revealed so far.

### waldegrave
**Waldegrave** · process · accent `#e5989b` · M, C
n players (3–5) wait in a ring queue. The first two play a fair duel. The winner stays and plays the next in the queue; the loser goes to the back. The first to win k duels in a row takes the pot (Waldegrave 1713; k = n−1 by default; for n = 3 the odds are 5/14, 5/14, 2/7). Back a seat. Live P is exact by solving the Markov chain over (champion, streak, queue order). Show streak pips and each seat's live odds; seat and k set volatility.

### bootstrap
**Bootstrap** · graph · accent `#caf0f8` · M
An n×n grid (n ∈ {4, 5}). k seed cells are infected at random, revealed one at a time. Then infection spreads: any cell with ≥ 2 infected neighbours is infected. Bet **Full grid** or **Not full**. Live P is exact by enumerating the remaining seed placements with closure checks (memoise; < 50 ms per step). The perimeter of the infected set never grows and the full grid needs 4n, so show the perimeter budget as a literal bar. Animate the spread at the end.

### lasso
**Lasso** · random-walk · accent `#98f5e1` · M
A simple random walk on an annular lattice (a square grid with a blocked central hole) for T steps (T ∈ {10, 20, 40, 60}). Bet the final winding number round the hole is ≠ 0 (or |w| ≥ k). Live P is exact by DP over (cell, winding). Draw the path, the accumulated angle sweep and a winding counter.

### serials
**Serials** · inference · accent `#ffafcc` · M, C
The unknown top serial N is uniform on [10, 100]. Serials are drawn without replacement from 1..N and revealed one at a time (k ∈ {2, …, 6}), then N is revealed. Bet **N ≤ X** (the player picks X). Live P = posterior mass with P(N | draws) ∝ 1/C(N, k) for N ≥ the max seen. Board: the drawn serials on a number line and the posterior histogram over N; the mass left of X is the odds.

### shunt
**Shunt** · combinatorics · accent `#a2d2ff` · M
Knuth's railway: cars 1..n (n ∈ {4, …, 9}) arrive in random order and are routed through a stack siding by the greedy rule. The exit must read 1, 2, 3, … Win if every car exits in order: P = Catalan(n)/n! (231-avoiding). Live P = the exact count of sortable completions of the arrival prefix. Highlight in red the remaining car numbers that would jam the siding next; their share is the next-car risk.

### euler
**Euler** · graph · accent `#fcbf49` · M
n nodes (6–12). T random edges are drawn with repeats allowed (each a uniform random pair). Bet **All degrees even** at the end (or **≥ 4 odd nodes**). The odd-node count k is a Markov chain: both endpoints odd → k−2, one odd → k, none → k+2. Live P is exact. Odd nodes glow; a k-chain meter shows the state.

### gossip
**Gossip** · process · accent `#8ac926` · M
n nodes (8–32); one knows a rumour. Each round every informed node calls a uniformly random other node and tells it. Win if everyone knows within R rounds. Live P is exact by DP over the informed count, using the occupancy distribution of the hits. Show the doubling phase and the mop-up phase.

### socks
**Socks** · combinatorics · accent `#ff99c8` · L
n pairs of distinct coloured tokens (n ∈ {5, …, 12}) are shuffled and drawn one at a time. An unmatched token goes onto a table with k slots; its twin later clears the pair. Bust if a token without a twin on the table arrives while the table is full. When the table is full, the next draw is safe with chance (tokens on the table)/(tokens remaining); show it literally. Otherwise the draw is free. Exact DP over (untouched pairs, tokens on the table). n and k set volatility.

### condorcet
**Condorcet** · inference · accent `#bde0fe` · M, C
Three candidates; n voters (odd, 5–25), each with a uniformly random ranking out of 6, revealed one at a time. The pairwise majorities form arrows on a triangle. Bet **Cycle** (Condorcet paradox: 1/18 for n = 3, rising to ≈ 8.8%), or that a chosen candidate is the Condorcet winner. Live P is exact by DP over the three pairwise margins with the remaining votes.

### polarizer
**Polarizer** · geometry · accent `#80ffdb` · L, C
A photon polarised at 0° must reach 90°. At each checkpoint the player sets the next polarizer's turn Δ (5°–90°, never past 90°); the photon passes with P = cos²Δ (Malus). Draw it literally: the polarisation vector projected onto the new axis, with the squared projection as a bar. Per-step fair factor 1/cos²Δ; the choice of Δ is EV-neutral. Reaching 90° pays and ends the round. Presets show the quantum Zeno effect: cos^(2n)(90°/n) → 1. The max-win cap applies.

### witness
**Witness** · number-theory · accent `#e9ff70` · M
A hidden odd N, uniform on an odd range (e.g. [101, 1999]). Each round runs a Miller–Rabin test with a uniformly random base. "Composite" ends it (certain); "probably prime" updates the odds. Bet **Prime** or **Composite**. Live P is the exact posterior: primes have likelihood 1, and composites have (strong liars / bases)^r. Precompute the strong-liar counts. Board: the candidates as weighted dots.

### pivot
**Pivot** · combinatorics · accent `#ffb703` · M, C
Weighted voters (presets such as [5, 4, 3, 2, 1] with quota 9) join a coalition in uniformly random order. The pivot is the voter whose weight first takes the total to the quota or beyond. Back a voter: P = Shapley–Shubik index, exact by enumeration or subset DP. Live: the coalition bar fills towards the quota line, with your block marked and the gap where your joining would tip it shaded.

### homecoming
**Homecoming** · random-walk · accent `#e0aaff` · M, C
A simple random walk on ℤ^d with d ∈ {1, 2, 3} (dimension is the volatility knob). Win if it returns to the origin within T steps (T ∈ {10, 20, 40}). Pólya: return is certain eventually in 1D and 2D, ≈ 34% in 3D. Live P is exact by DP over positions (use symmetry to reduce states). For 3D, draw the three coordinates as projections.

### Batch 2 results

All 21 are built and committed. Each passes typecheck, its unit tests (625 across the repo), `npm run eval`, a second 200k-round eval on a fresh seed, a headless-Chrome smoke test with no console errors, and the platform build. As with the end of batch 1, the separate adversarial review stage was not run. Flagged by the builders:

- **Witness:** Miller–Rabin settles most rounds on the first test, so only 27–49% of rounds reach a checkpoint.
- **Thales:** the equilateral-triangle constant comes from exact-piecewise quadrature, checked to 1e-12 against the square's closed form.
- **Median, Mediant, Shunt:** rounds are short, about 2–4 steps.

| Game | Mechanic | RTP range (z) | Std dev low → high | Spread | Avg steps | Max seen | ok |
|---|---|---|---|---|---|---|---|
| Hamming | combinatorics | 98.51%–99.63% (max \|z\| 1.4) | 0.29 → 9.07 | 31.5× | 3.1–7.9 | 126× | ✓ |
| Median | geometry | 98.89%–99.52% (max \|z\| 1.8) | 0.18 → 3.83 | 20.8× | 2.8–4.0 | 59× | ✓ |
| Mediant | number-theory | 98.76%–102.69% (max \|z\| 0.8) | 0.93 → 15.39 | 16.6× | 1.9–2.3 | 1014× | ✓ |
| Thales | geometry | 98.75%–100.16% (max \|z\| 1.4) | 0.55 → 4.51 | 8.3× | 1.6–2.1 | 48× | ✓ |
| Zigzag | combinatorics | 96.26%–99.28% (max \|z\| 1.1) | 1.10 → 7.87 | 7.2× | 2.7–3.0 | 175× | ✓ |
| Connect | graph | 99.02%–99.51% (max \|z\| 1.7) | 0.20 → 2.96 | 14.6× | 5.8–8.3 | 28× | ✓ |
| Spanning | graph | 98.52%–100.12% (max \|z\| 2.1) | 0.58 → 3.33 | 5.8× | 2.2–2.6 | 41× | ✓ |
| Euclid | number-theory | 98.68%–99.17% (max \|z\| 0.8) | 0.71 → 4.92 | 6.9× | 2.4–3.4 | 61× | ✓ |
| Waldegrave | process | 97.82%–99.74% (max \|z\| 1.6) | 0.20 → 2.69 | 13.7× | 2.1–5.0 | 15× | ✓ |
| Bootstrap | graph | 97.92%–99.55% (max \|z\| 1.4) | 0.29 → 3.21 | 11.1× | 2.4–5.0 | 33× | ✓ |
| Lasso | random-walk | 99.13%–104.22% (max \|z\| 1.0) | 1.04 → 16.18 | 15.5× | 2.9–10.0 | 453× | ✓ |
| Serials | inference | 98.45%–99.26% (max \|z\| 1.4) | 0.61 → 4.07 | 6.7× | 1.5–3.1 | 56× | ✓ |
| Shunt | combinatorics | 98.61%–101.27% (max \|z\| 1.3) | 0.72 → 5.58 | 7.8× | 2.0–2.4 | 74× | ✓ |
| Euler | graph | 98.98%–99.34% (max \|z\| 1.3) | 0.29 → 7.23 | 24.8× | 4.1–4.6 | 113× | ✓ |
| Gossip | process | 98.59%–99.77% (max \|z\| 0.9) | 0.36 → 8.50 | 23.5× | 3.1–5.0 | 131× | ✓ |
| Socks | combinatorics | 92.73%–99.09% (max \|z\| 1.1) | 1.38 → 42.88 | 31.1× | 4.2–8.5 | 8981× | ✓ |
| Condorcet | inference | 96.92%–99.70% (max \|z\| 1.7) | 1.35 → 10.11 | 7.5× | 2.8–4.1 | 139× | ✓ |
| Polarizer | geometry | 99.03%–102.46% (max \|z\| 1.1) | 0.42 → 9.91 | 23.7× | 1.8–13.4 | 131× | ✓ |
| Witness | number-theory | 80.97%–99.89% (max \|z\| 1.9) | 0.60 → 33.67 | 56.2× | 1.2–1.5 | 2442× | ✓ |
| Pivot | combinatorics | 98.93%–100.13% (max \|z\| 1.5) | 0.56 → 5.36 | 9.6× | 2.3–4.8 | 42× | ✓ |
| Homecoming | random-walk | 97.96%–99.76% (max \|z\| 2.5) | 0.34 → 2.30 | 6.7× | 3.1–5.2 | 8× | ✓ |
