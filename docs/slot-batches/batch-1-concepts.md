# Slots batch 1: concepts

Twelve original slot concepts for the Originals site, written 2026-11-16 against `docs/SLOTS.md` and the Slot Math engine pack (`/Users/petercyli-wsd/Dev/slot-math-engine-pack`). Each one is a theme, a promise and a mechanism that tell the same story. Builders take a concept, start the maths from the named pack example, and tune it to the targets.

The screen that ranks these and picks the ones to build is in `batch-1-screen.md`.

## At a glance

| # | Name | Theme | Evaluation and board | Modifiers (base round) | Feature | Volatility | Grid |
|---|---|---|---|---|---|---|---|
| 1 | Noodle Cart | Night-market noodle stall | Payline, 10 lines | walking_wild | Free spins: walker + expanding wilds | Low | 5×3 |
| 2 | Spin Cycle | Laundromat of lost socks | Cluster (5+), intrinsic tumble | wild_injection | Free spins: heavier injection | Low | 8×8 |
| 3 | Unfold | Living origami world | Ways, 1,024 | mystery_reveal | Free spins: stacked mysteries | Low | 5×4 |
| 4 | Hi-Score | Retro arcade cabinet | Payline, 5 lines | global_iid | Free spins: richer multiplier reel | Medium | 3×3 |
| 5 | Escapement | Clockmaker's bench | Payline, 20 lines | expanding_wild + sticky_respin | Free spins: more pendulum wilds | Medium | 5×3 |
| 6 | Grand Finale | Rooftop fireworks show | Scatter pays (8+) | global_additive | Free spins: rocket-rich sky | Medium | 7×5 |
| 7 | Kiln | Pottery kiln firing | Cluster (5+), intrinsic tumble | cascade_step_ladder | Free spins: hotter ladder | High | 7×7 |
| 8 | Honeycomb | Beekeeper's apiary | Ways, 3,125 | hold_and_spin_lock_respin | The hold-and-spin itself | High | 5×5 |
| 9 | Late Set | Basement jazz club | Payline, 40 lines | per_wild_sum | Free spins: badge-wild reel set | High | 5×4 |
| 10 | Midnight Zone | Deep-sea bioluminescence | Scatter pays (8+), tumble | tape_continuation_refill + orb_sum_terminal | Free spins: orb-rich reel set | Extreme | 6×5 |
| 11 | Whiteout | Alpine avalanche | Megaways (6 reels, 2–7 rows), tumble | tape_continuation_refill + cascade_step_ladder | Free spins: steeper ladder + spin schedule | Extreme | 6×(2–7) |
| 12 | Dark Sky | Desert observatory | Ways, 4,096 | wild_injection + expanding_wild | Free spins: meteor shower + spin schedule | Extreme | 6×4 |

**Coverage.** Evaluation laws: payline ×4, ways ×3, cluster ×2, scatter pays ×2, Megaways ×1. Volatility: 3 low, 3 medium, 3 high, 3 extreme. Every one of the 12 runtime modifiers is used at least once. Ten different grids. No two concepts share a modifier set. None is a payline 5×3 game with plain free spins, which is what the existing `reels` game is.

## What makes these fun

Real online slots are probability engines whose pacing is designed. These are the mechanics batch 1 draws on, and why players like them.

- **Book-style expanding symbols** (one symbol chosen for the free spins expands to fill whole reels). The fun is *anticipation*: every feature spin you watch for the chosen symbol, and a single landing on a far reel can turn a dead board into a full-screen win. It works because the chosen symbol is known in advance, so the player knows exactly what to hope for. (Not in our runtime: see "Wanted but refused" below. Unfold uses stacked mystery symbols for a similar whole-reel reveal.)
- **Pay-anywhere tumbles with multiplier orbs** (8+ of a symbol anywhere pays; winners vanish and new symbols drop; orbs that land are summed and multiply the whole sequence). The fun is *escalation inside one spin*: a small win can cascade into a chain, and the orbs make the ending unknown until the board settles. Players love the slow drop of the final orb onto a board that's already paying. It is also *readable*: "count 8 of the same" needs no line map.
- **Hold-and-spin coin features** (coins lock, the rest respins, every new coin resets the counter to 3). The fun is *tension with a visible clock*: "two respins left" is a simple, gripping countdown, each coin is a small win you can see, and the full grid is a clear, aspirational goal. It's a different rhythm from free spins: slow, deliberate, cell by cell.
- **Megaways** (each reel shows a random 2–7 rows, so the number of ways changes every spin, up to 117,649). The fun is *variety*: no two spins look alike, and a tall board feels like a big chance before anything has paid. Paired with tumbles, a win can open more ways as new symbols drop.
- **Cluster cascades** (5+ touching symbols pay, then pop and refill). The fun is the *chain reaction* and the *shape*: players read groups by eye, and a cascade is visible cause and effect. With a ladder that rises on each cascade, every extra drop is worth more than the last.
- **Sticky and walking wild respins** (a win locks its symbols and the rest respins until nothing new sticks; or a full-reel wild moves along the reels). The fun is *agency without choice*: each respin either adds to what's locked or ends the chain, so the player feels a win being built. A walking wild every spin gives *constant hope*, which suits gentle, frequent-win games.
- **Mystery symbols** (blank tiles land, then all reveal as the same symbol). The fun is the *reveal moment*: a beat of suspense on every spin they appear, and the chance that a cluster of blanks becomes a premium. It turns an ordinary board into a small lottery that resolves in one flip.
- **Wild multipliers that add or multiply** (wilds carry ×2, ×3, ×5 badges that sum along a line, or a board-wide multiplier that is 1 + all the badges). The fun is *combination*: two badges on one line feel like teamwork, and the player can see exactly why a win was big.
- **Random multipliers and injected wilds** (a multiplier reel, a shooting star stamping wilds). The fun is *surprise on an ordinary spin*: the base game stays alive between features.

Three pacing rules sit under all of these:

1. **Near-feature tension must be real** (`SLOTS.md` §2.8). Two scatters down and a reel still to stop is exciting only because it can actually happen.
2. **Frequent small hits, rare large ones.** The §3 dry-streak band (p95 of the longest losing run in 100 spins ≤ 15) needs a hit rate of about **33% or more** for independent spins: the exact p95 is 20 at a 25% hit rate, 17 at 30%, 15 at 33% and 14 at 35%. So every concept below targets a hit rate of 34% or more, including the extreme ones. Big-volatility games get their swing from the top, not from long droughts.
3. **The feature is a different place.** Free spins should feel like entering another room of the theme (hotter, darker, louder), not the same reels with a number on them.

## Cross-cutting rules for builders

- **Free spins** are N spins on a feature reel set, each an ordinary pack-verified spec, with an optional multiplier that depends only on the spin index, and retriggers. Nothing carries from one free spin to the next. A multiplier that grows across free spins is fine only as a fixed schedule by spin number (the algebra in `SLOTS.md` §2.5).
- **Pack evidence.** Every base-round mechanism below was built through `enginepack.base.build` on 2026-11-16 at the stated grid and passed the scope check. The tuner starts from the named example in `base.examples()`.
- **Theme symbols** are original flat vector SVG, readable at 48 px, each with a distinct silhouette, so the shape alone tells them apart before colour.
- **Big-win marks** at ≥ 20× and ≥ 100× (`SLOTS.md` §4), dressed in each game's own language.

---

## 1. Noodle Cart

**Hook:** every spin the cook walks down the stalls, and whichever reel he stops at turns completely wild.

**Theme promise.** A warm, steamy night market: lanterns, sizzle, a queue that keeps moving. The feeling is cosy and generous: something good happens on most spins. That means **low volatility**, a high hit rate and modest top wins.

**Mechanism.**
- Evaluation: payline, left to right, 10 lines. Board law: one base reel set (`global_mixture`).
- Modifier: `walking_wild`: one iid draw per spin picks a reel from `placement_pmf` (reels 2–4 weighted, 1 and 5 lighter) and that whole reel becomes wild before evaluation. The walker covers a scatter if he stops on one, which the paytable must say.
- Feature: 3 order-ticket scatters on reels 1, 3 and 5 award 8 free spins on a feature reel set that adds wild symbols on reels 2–4 with `expanding_wild`, so a second "helper cook" can fill a reel alongside the walker. Retrigger +5.
- Pack evidence: example panel `panel-walking-wild-guaranteed-iid-overlay` (payline, walking_wild, `exact_mixture`). The free-spin pair `walking_wild + expanding_wild` is verified in `payline|global_mixture` (cells ab and ba); built at 5×3, 10 lines.
- **Start the maths from:** `panel-walking-wild-guaranteed-iid-overlay`.

**Grid:** 5×3, 10 fixed lines.

**Symbols** (flat vector, bold outlines, steam wisps as a motif):
- Low (5): chopsticks (two crossed diagonals), chilli (curved tapered pod), spring onion (tall stalk with a bulb), fish-cake slice (a round disc with a pink swirl), bok choy (a fan of leaves).
- Premium (4): dumpling basket (round bamboo steamer, lid ajar), roast duck (hanging glazed silhouette), tiger prawn (curled C-shape), golden noodle bowl (deep bowl, noodles lifted on chopsticks), the top pay.
- Wild: the cook (a tall full-reel portrait carrying a wok over a flame; also a one-cell "WOK" tile on the feature reels that expands).
- Scatter: order ticket (a red paper slip with a torn edge and a stamped number).

**Feature story.** The walker is the cook carrying orders down the alley; the reel he stops at is the stall he's cooking at, so it's wild. Three order tickets mean the dinner rush: free spins where a second cook joins and any wok that lands takes over its whole stall. The mechanic is the theme's promise made literal: the cook always shows up.

**Target maths.**

| Measure | Target |
|---|---|
| Volatility | Low (SD 3–5) |
| Hit rate | 40–45% |
| Free spins | 1 in 130; average 35× |
| Feature share of RTP | ~28% |
| Max win | 1,500× |

**Palette:** night indigo `#1B1A3A`, lantern red `#E2483D`, warm amber `#F5B342`, steam cream `#F4EBDD`, jade `#3FA48A`, neon sign pink `#FF5FA2`.

**Reel window:** five stalls under a string of paper lanterns, each reel framed as a stall front with a striped awning; the walker's reel glows amber under its lantern.

**Why it's not a reskin.** It's the only game where a wild is guaranteed every spin. Its rhythm is constant small hope, not hunt-the-feature. Low volatility, 10 lines, and a modifier set ({walking_wild}) that no other concept uses.

---

## 2. Spin Cycle

**Hook:** a wall of washing machines; matching socks find their pairs, pop off the board and the drum tumbles in more.

**Theme promise.** A bright Sunday-morning laundromat: soap, warm air, the satisfying thunk of a drum. The feeling is light, playful and tidy (things getting matched up). That means **low volatility**: lots of small cluster wins and chains that keep the screen busy.

**Mechanism.**
- Evaluation: cluster, 5+ four-connected (`adjacency 4`), on an 8×8 grid. The cluster engine always cascades (intrinsic tumble: winners pop, symbols drop, the strip continues).
- Modifier: `wild_injection`: on about 1 in 8 spins, 1–2 soap-bubble wilds are stamped on random cells before evaluation (keep P(≥2 per episode) ≤ 5% as the pack's degeneracy cap asks).
- Feature: 4+ laundry-token scatters award 10 free spins ("Hot Wash") on a feature reel set where the injection fires every spin (1–3 bubbles). Retrigger +3.
- Pack evidence: `wild_injection` is verified on `cluster|global_mixture` (battery cell) and appears on a cluster in example `panel-cluster-tumble-generative-stack`; built at 8×8 with the injection on 2026-11-16.
- **Start the maths from:** `panel-cluster-tumble-generative-stack` (drop its vault family), checking the base against `panel-cluster-tumble-generative-board`.

**Grid:** 8×8, clusters of 5+ touching (no diagonals).

**Symbols** (flat vector, pastel, rounded corners):
- Low (5): five socks with distinct shapes, not only colours: a striped knee-high (long), an ankle sock (short stub), a toe sock (five toes), an argyle dress sock (diamond pattern, slim), a fluffy bed sock (round and puffy).
- Premium (3): rubber duck (classic profile), folded towel stack (three stepped rectangles), a sleeping cat curled on warm laundry (top pay).
- Wild: soap bubble (a translucent circle with a highlight; it can stand for any sock or premium).
- Scatter: laundry token (a brass coin with a hole in the middle).

**Feature story.** Clusters are socks finding their pairs; the tumble is literally the drum turning. A soap bubble is the detergent that makes anything match. Four tokens buy a hot wash, when bubbles pour in every spin.

**Target maths.**

| Measure | Target |
|---|---|
| Volatility | Low (SD 3–5) |
| Hit rate | 38–44% |
| Free spins | 1 in 110; average 30× |
| Feature share of RTP | ~28% |
| Max win | 2,000× |

**Palette:** porthole teal `#2EC4B6`, soap white `#F7FBFF`, lavender `#B8A1E3`, sunny yellow `#FFD166`, coral `#EF6F6C`, chrome grey `#8D99AE`.

**Reel window:** a chrome wall of front-loader doors; the grid sits behind one big porthole glass with a soft reflection. Popping clusters leave a puff of suds.

**Why it's not a reskin.** It's the only low-volatility cluster game and the only cluster game with injected wilds; Kiln (the other cluster) is high volatility with a multiplier ladder and no wilds injected. The 8×8 grid is the biggest board in the batch.

---

## 3. Unfold

**Hook:** folded paper squares land on the reels, then all open at once into the same animal.

**Theme promise.** A quiet paper world (cranes, foxes and koi folded from washi) where things transform. The feeling is calm wonder with a small surprise on most spins. That means **low volatility**, a gentle hit rate and the reveal as the recurring moment.

**Mechanism.**
- Evaluation: ways, 1,024 (5×4), adjacent reels from the left. Board law: one base reel set.
- Modifier: `mystery_reveal`: mystery cells (folded squares) on the strips all reveal to one symbol per spin, drawn from `reveal_pmf`, before evaluation.
- Feature: 3+ folded-sun scatters award 10 free spins ("Great Fold") on a feature reel set where the mystery squares come stacked 4 high, so whole reels unfold together. Retrigger +5.
- Pack evidence: example panel `panel-ways-mystery-reveal-no-mult` (ways, mystery_reveal, `exact_mixture`); the stacked feature reel set is a strip-layout choice (no pack panel has stacked mysteries; the screen built a stacked version at 5×4); built at 5×4 on 2026-11-16.
- **Start the maths from:** `panel-ways-mystery-reveal-no-mult`.

**Grid:** 5×4, 1,024 ways.

**Symbols** (flat vector in paper planes: two or three tones per symbol with crisp fold lines, never outlines):
- Low (5): paper boat, pinwheel, paper fan, paper star, water-bomb cube (each a distinct folded silhouette).
- Premium (4): frog (squat), koi (curved body), fox (pointed ears and tail), crane (wings spread), the top pay.
- Mystery: a blank folded square with diagonal crease lines; it opens with a flip.
- Wild: gold-foil square (a shining square of paper, folded once).
- Scatter: folded sun (a radiating paper medallion).

**Feature story.** The mystery reveal is the fold itself: a blank sheet becomes an animal. In the free spins the folder works faster, whole reels of paper open at once into the same creature.

**Target maths.**

| Measure | Target |
|---|---|
| Volatility | Low to the top of low (SD 4–5) |
| Hit rate | 36–40% |
| Free spins | 1 in 140; average 40× |
| Feature share of RTP | ~30% |
| Max win | 2,500× |

**Palette:** washi cream `#F6F1E7`, sumi ink `#2B2D42`, vermilion `#E4572E`, indigo `#3D5A80`, teal `#2A9D8F`, gold foil `#E9C46A`.

**Reel window:** a sheet of textured paper on a low wooden table; reels separated by soft fold lines rather than bars.

**Why it's not a reskin.** It's the only game built on mystery symbols, and the only low-volatility ways game. Its signature moment (the reveal) happens in the base game as well as the feature.

---

## 4. Hi-Score

**Hook:** a three-reel arcade cabinet with a bonus-multiplier marquee that lights up a number on every spin.

**Theme promise.** A late-80s arcade: CRT glow, chiptune energy, the drama of a multiplier light that stops last. The feeling is quick, punchy and readable. That means **medium volatility**: small line hits made exciting by the marquee.

**Mechanism.**
- Evaluation: payline, 3×3, 5 lines (three rows and two diagonals). Board law: one base reel set.
- Modifier: `global_iid`: one multiplier per spin (×1, ×2, ×3, ×5, ×10) from `value_pmf`, shown on a marquee "4th reel" that stops after the three reels, and applied to the whole spin's win.
- Feature: 3 golden tokens (one on each reel) award 10 free spins ("Continue?") using a feature marquee whose `value_pmf` starts at ×2 and reaches ×25. Retrigger +5.
- Pack evidence: example panel `panel-global-iid-multiplier-reel` (payline, global_iid, `exact`); built at 3×3, 5 lines on 2026-11-16.
- **Start the maths from:** `panel-global-iid-multiplier-reel`.

**Grid:** 3×3, 5 lines.

**Symbols** (flat vector built on a visible pixel grid, chunky 8-bit shapes):
- Low (4): pixel heart, pixel star, lightning bolt, pixel bell.
- Premium (3): joystick, pixel rocket, neon "7" in seven-segment strokes (the top pay).
- Wild: glitch block (a scrambled, colour-split tile that stands in for anything).
- Scatter: golden token (a coin with a star punched through).

**Feature story.** The marquee is the cabinet's bonus light: it spins up after every spin, so even a small win has one more beat of suspense. Three tokens mean "Continue?": the countdown screen, then free spins on a hotter marquee where ×1 is gone.

**Target maths.**

| Measure | Target |
|---|---|
| Volatility | Medium (SD 5–8) |
| Hit rate | 34–37%. This is above the classic 3×3 band of 10–25% on purpose, because the dry-streak band needs about 33% |
| Free spins | 1 in 90; average 25× |
| Feature share of RTP | ~29% |
| Max win | 2,500× |

**Palette:** CRT black `#0B0B1A`, neon cyan `#00E5FF`, magenta `#FF2E88`, lime `#B6FF3B`, amber `#FFB000`, scanline violet `#5B2A86`.

**Reel window:** a cabinet bezel with a thin scanline overlay; the marquee multiplier sits as a narrow fourth window on the right with a chasing-light border.

**Why it's not a reskin.** It's the only 3×3 and the only game with a per-spin multiplier reel. It's a compact, fast format that nothing else in the batch shares.

---

## 5. Escapement

**Hook:** a win locks its gears in place; the rest of the clock respins until nothing new clicks in, then the hour strikes and pays.

**Theme promise.** A clockmaker's bench at dusk: brass, ticking, intricate mechanisms. The feeling is building something precise. That means **medium volatility** with frequent "winding" sequences that grow a win step by step.

**Mechanism.**
- Evaluation: payline, 20 lines, 5×3. Board law: one base reel set.
- Modifiers: `expanding_wild`: a pendulum wild landing on reels 2–4 swings to fill its reel. And `sticky_respin`: any base win starts the winding. Every visible instance of each winning symbol, every wild and every scatter lock; every open cell is re-dealt from `cell_pool`; the chain continues while a respin locks at least one new cell; one payment is made on the final board.
- Feature: 3 key scatters award 10 free spins ("Grand Complication") on a feature reel set with more pendulum wilds on reels 2–4; the winding still runs on every winning free spin. Retrigger +5.
- Pack evidence: example panels `panel-payline-lockrespin-expandingwild-gapful` and `panel-payline-bothways-expandingwild-respin` (payline, expanding_wild + sticky_respin, `mc`); pair verified on `payline|global_mixture`.
- **Start the maths from:** `panel-payline-lockrespin-expandingwild-gapful`.

**Grid:** 5×3, 20 lines.

**Symbols** (flat vector, brass and enamel, fine engraved line details):
- Low (5): small cog (many teeth), screw (slotted head), mainspring (a coil), jewel bearing (a red faceted dot), hand (an ornate clock hand).
- Premium (4): pocket watch, mantel clock, cuckoo bird, astronomical dial (top pay).
- Wild: pendulum (a long rod with a brass bob; expands into a full swinging reel).
- Scatter: winding key (a butterfly-shaped key).

**Feature story.** Each respin is a tick of the escapement: locked gears hold, loose parts are re-dealt, and every new match clicks into place. The chain stops when a tick adds nothing, then the clock chimes and the final board pays. The theme literally is the mechanic: precision built one tick at a time.

**Target maths.**

| Measure | Target |
|---|---|
| Volatility | Medium (SD 6–9) |
| Hit rate | 34–38% |
| Winding chain | fires on every base win; average length 1.5–2.5 respins |
| Free spins | 1 in 160; average 50× |
| Feature share of RTP | ~33% |
| Max win | 5,000× |

**Palette:** walnut `#4A2C2A`, brass `#C9A227`, enamel white `#F2EFE6`, oxidised teal `#3E7C7B`, ruby jewel `#B0243A`, graphite `#2E2E2E`.

**Reel window:** an open clock case: reels behind bevelled glass, with a gear train ticking along the top edge; locked cells get a brass bezel ring.

**Why it's not a reskin.** It shares the 5×3, 20-line format with `reels`, but plays completely differently: every win becomes a respin chain, and the base game carries most of the action. It's the only game with sticky respins in the batch.

---

## 6. Grand Finale

**Hook:** symbols pay anywhere across a city skyline; every rocket that bursts adds to the night's multiplier.

**Theme promise.** A rooftop fireworks show over a harbour city: bursts, colour and crowd noise in motion. The feeling is a celebration that builds to a finale. That means **medium volatility**: frequent pay-anywhere wins with occasional bursts of multipliers.

**Mechanism.**
- Evaluation: scatter pays, 8+ of a symbol anywhere, on a wide 7×5 sky. No tumble.
- Modifier: `global_additive`: rocket symbols land carrying +1, +2, +3 or +5 (from `value_pmf`); the spin's multiplier is 1 + the sum of all rockets on the board, applied to every win on that spin.
- Feature: 4+ fuse scatters award 12 free spins ("Grand Finale") on a feature reel set with more rockets and larger values (+5, +10). Retrigger +4.
- Pack evidence: example panel `panel-scatterpay-notumble-globalwildmult` (scatter pays, global_additive, `exact`); built at 7×5 on 2026-11-16.
- **Start the maths from:** `panel-scatterpay-notumble-globalwildmult`.

**Grid:** 7×5, 8+ anywhere pays.

**Symbols** (flat vector, each a firework burst shape distinct in silhouette):
- Low (5): peony burst (round), willow (drooping trails), ring (hollow circle), crossette (a cross of four splits), palm (thick trunk with fronds).
- Premium (4): sparkler (a hand-held star), Roman candle (a tube shooting balls), firework barge (a boat on the water), grand shell (a giant gold chrysanthemum, the top pay).
- Wild: rocket (a slim rocket with its +value painted on the side). The pack takes the added values from wild symbols, so the rocket must be the wild, and in scatter pays it counts toward every symbol. Raise `min_count` to 9–10 at 7×5 to keep the hit rate in band.
- Scatter: lit fuse (a curling fuse with a spark).

**Feature story.** Every rocket on the board adds its number to the show, so a sky with three rockets visibly totals up before the wins are paid: the add-up is the finale. The free spins are the closing barrage: more rockets, bigger numbers.

**Target maths.**

| Measure | Target |
|---|---|
| Volatility | Medium (SD 7–10) |
| Hit rate | 34–38% |
| Free spins | 1 in 180; average 60× |
| Feature share of RTP | ~35% |
| Max win | 5,000× |

**Palette:** night navy `#0D1B2A`, gold burst `#FFC857`, magenta `#E84A8A`, electric blue `#4CC9F0`, ember orange `#F77F00`, smoke grey `#6C757D`.

**Reel window:** no reel bars: a dark sky above a silhouetted skyline and water, the 7×5 cells floating as soft glows; rockets streak up from the skyline before they burst into place.

**Why it's not a reskin.** It's the only additive-multiplier game and the only pay-anywhere game without tumbles. Midnight Zone (the other scatter-pays game) has tumbles, multiplying orbs and extreme volatility; this one is a single, medium-volatility evaluation that's read at a glance.

---

## 7. Kiln

**Hook:** glaze tiles fire in clusters; every cascade makes the kiln hotter and the multiplier climbs.

**Theme promise.** A ceramics studio on firing day: earth, flame and the risk of what the kiln makes. The feeling is heat building towards a dramatic result. That means **high volatility**: most spins are modest, but long cascades multiply hard.

**Mechanism.**
- Evaluation: cluster, 5+ four-connected, 7×7, intrinsic tumble.
- Modifier: `cascade_step_ladder`: the wins of each cascade step are multiplied by the step's rung: ×1, ×2, ×3, ×5, ×8, ×12, then the last rung repeats. Resets every spin.
- Feature: 3+ cone scatters award 10 free spins ("White Heat") on a feature reel set whose ladder starts higher: ×3, ×5, ×8, ×12, ×20, ×30. Retrigger +3.
- Pack evidence: `cascade_step_ladder` is verified on `cluster|global_mixture` (battery cell); the cluster cascade engine is shown on `panel-cluster-tumble-generative-board`; the ladder's parameters are shown on `panel-relax-ways-tumble-fishcollect-sampler`. Built at 7×7 on 2026-11-16.
- **Start the maths from:** `panel-cluster-tumble-generative-board` (replace orb_sum_terminal with the ladder).

**Grid:** 7×7, clusters of 5+ touching (no diagonals).

**Symbols** (flat vector with a matt glaze texture, earthy and then glowing):
- Low (5): five glaze tiles with distinct shapes: celadon square, tenmoku circle, ash-glaze triangle, cobalt hexagon, shino diamond.
- Premium (4): bud vase, tea bowl, lidded jar, a large crackle-glaze moon jar (top pay).
- Wild: molten drip (a glossy glaze drop that matches any tile).
- Scatter: pyrometric cone (the slender bent cone potters use to read heat).

**Feature story.** The ladder is the kiln's temperature: each cascade turns the dial up (cone 1, cone 6, cone 10) and the wins fire harder. A thermometer arc beside the grid fills on each step. In the free spins the kiln is already at white heat.

**Target maths.**

| Measure | Target |
|---|---|
| Volatility | High (SD 12–18) |
| Hit rate | 34–38% |
| Second cascade reached | 10–25% of paying spins |
| Free spins | 1 in 200; average 90× |
| Feature share of RTP | ~47% |
| Max win | 10,000× |

**Palette:** clay `#B5651D`, kiln black `#1E1A17`, ember `#FF6B35`, celadon `#A8C3A0`, cobalt `#2343A3`, ash cream `#EDE3D1`.

**Reel window:** the grid sits inside the kiln's arched brick mouth; the brickwork glows from dull red to white as the ladder climbs.

**Why it's not a reskin.** It's the only game with a cascade ladder on a cluster grid. Spin Cycle is the low-volatility, wild-injection cluster game; Whiteout uses a ladder on Megaways ways, not clusters.

---

## 8. Honeycomb

**Hook:** land six honey cells and the comb starts filling: three respins, reset by every new drop of honey.

**Theme promise.** A beekeeper's apiary in high summer: golden light, a buzzing hive and a comb filling cell by cell. The feeling is patient, gripping accumulation. That means **high volatility**: the base pays modestly, and the hold-and-spin carries the big moments.

**Mechanism.**
- Evaluation: ways, 3,125 (5×5). Board law: one base reel set.
- Modifier: `hold_and_spin_lock_respin`: 6+ honey-cell coins on the base board start the respins. Coins lock with values from `value_pmf` (1×, 2×, 3×, 5×, 10×, 25×, 100× the bet), every other cell respins, and each new coin resets the counter to 3. Filling all 25 cells adds a full-comb bonus (`full_grid_bonus`, 1,000×). It ends when the counter reaches 0, and all locked values are collected.
- Feature: the hold-and-spin itself (no free spins), which keeps the game single-minded and clear.
- Pack evidence: example panel `panel-ways-holdspin-respin-decorative` (ways, hold_and_spin_lock_respin, `mc`); built at 5×5 with `full_grid_bonus` on 2026-11-16.
- **Start the maths from:** `panel-ways-holdspin-respin-decorative`.

**Grid:** 5×5, 3,125 ways; the frame is drawn as hexagonal comb cells over the square grid.

**Symbols** (flat vector, warm, rounded hexagonal badges):
- Low (5): clover, lavender sprig, sunflower, dandelion clock, wax candle.
- Premium (4): wooden honey dipper, smoker (bellows can with a puff), beekeeper's veil hat, queen bee (top pay).
- Wild: worker bee in flight (wings blurred).
- Coin: honey cell (a filled hexagon with its value written on it).

**Feature story.** Each locked coin is a capped cell of honey; the counter is the bees' return trips. Every new cell sends them out again, so the player watches the comb fill. A full comb is the harvest.

**Target maths.**

| Measure | Target |
|---|---|
| Volatility | High (SD 11–16) |
| Hit rate | 34–38% |
| Hold-and-spin | 1 in 110; average 45× |
| Feature share of RTP | ~43% |
| Max win | 3,500× (25 coins at 100× plus the 1,000× full-comb bonus is the most the respins can pay; raise the top coin value to reach more) |

**Palette:** honey gold `#F2A900`, wax cream `#FFF3C4`, hive brown `#6B4226`, meadow green `#7FB069`, lavender `#9D8CC2`, deep amber `#C46D00`.

**Reel window:** a wooden hive frame with comb cells; locked coins cap with wax and the frame's empty cells dim during the respins.

**Why it's not a reskin.** It's the only hold-and-spin game in the batch, and its only feature is the coin respin: a different rhythm from every free-spins game here.

---

## 9. Late Set

**Hook:** soloist wilds carry riff multipliers that add up along a line: two soloists on one line jam together.

**Theme promise.** A basement jazz club after midnight: smoke, brass, a band that suddenly catches fire. The feeling is cool, then explosive. That means **high volatility**: quiet stretches broken by big combined-wild moments.

**Mechanism.**
- Evaluation: payline, 40 lines, 5×4. Board law: one base reel set.
- Modifier: `per_wild_sum`: every wild carries a ×2, ×3 or ×5 badge (from `badge_pmf`); a line win is multiplied by the sum of the badges of the wilds in its run.
- Feature: 3 ticket-stub scatters award 12 free spins ("Encore") on a feature reel set with denser wilds on reels 2–4 and a ×10 badge added. Retrigger +5.
- Pack evidence: example panels `panel-wild-mult-sum-doghouse` and `panel-payline-boosted-boardmult-wild` (payline, per_wild_sum, `exact`); built at 5×4, 40 lines on 2026-11-16.
- **Start the maths from:** `panel-wild-mult-sum-doghouse`.

**Grid:** 5×4, 40 lines.

**Symbols** (flat vector, art deco geometry, duotone with a gold accent):
- Low (5): drumstick pair, guitar pick, sheet-music note, cocktail glass (no brand), microphone grille.
- Premium (4): upright bass, trumpet, saxophone, grand piano (top pay).
- Wild: soloist (a spotlit musician silhouette with the badge value on the spotlight).
- Scatter: ticket stub (a torn admit-one ticket).

**Feature story.** Wilds are soloists taking a chorus; two soloists on the same line add their riffs together, so the multiplier on the screen is the band jamming. The encore is the late set when everyone's playing.

**Target maths.**

| Measure | Target |
|---|---|
| Volatility | High (SD 13–18) |
| Hit rate | 34–37% |
| Free spins | 1 in 220; average 100× |
| Feature share of RTP | ~47% |
| Max win | 10,000× |

**Palette:** midnight blue `#14213D`, brass gold `#E0A526`, smoky plum `#5E3A6E`, spotlight cream `#FFF1D0`, velvet red `#9B2335`, charcoal `#222222`.

**Reel window:** a small stage under a single spotlight cone, reels behind a deco proscenium; wild reels light up as a spot falls on the soloist.

**Why it's not a reskin.** It's the only game with summed wild badges on lines, and the only 40-line game. Its big moments come from wild combinations, not from tumbles, orbs or coins.

---

## 10. Midnight Zone

**Hook:** creatures of the deep pay anywhere and drift away in tumbles; glowing jellyfish orbs add up to multiply the whole chain.

**Theme promise.** The midnight zone, a kilometre down: total darkness lit by bioluminescence, unknown and immense. The feeling is awe and danger, the sense that anything could rise out of the dark. That means **extreme volatility**: long chains and big orb sums are rare, but they're enormous.

**Mechanism.**
- Evaluation: scatter pays, 8+ anywhere, 6×5.
- Modifiers: `tape_continuation_refill` (tumble: winners vanish, the reels slide down from the same strip) and `orb_sum_terminal`: jellyfish orbs that land carry values (×2 to ×100, from `value_pmf`); when the tumble sequence ends with a win, the total win is multiplied by the sum of the orbs on the final board.
- Feature: 4+ anglerfish-lure scatters award 15 free spins ("The Abyss") on a feature reel set with a higher orb density and larger orb values (up to ×500). Retrigger +5.
- Pack evidence: example panel `panel-scatterpay-tumble-orbsum` (scatter pays, tumble, orb_sum_terminal, `mc`); pair verified on `scatter_pays|global_mixture`.
- **Start the maths from:** `panel-scatterpay-tumble-orbsum`.

**Grid:** 6×5, 8+ anywhere pays.

**Symbols** (flat vector, dark shapes edged in luminous lines, like creatures seen by their own light):
- Low (5): copepod, glowing krill, sea gooseberry (an oval comb jelly), bristle worm, lantern shrimp.
- Premium (4): siphonophore chain, vampire squid, giant isopod, a gulper eel (huge mouth, top pay).
- Orb: jellyfish (a bell with trailing light; its value glows inside the bell). No wild.
- Scatter: anglerfish lure (a dangling glowing bulb in the dark).

**Feature story.** Tumbles are creatures drifting back into the dark; new ones rise from below. Jellyfish orbs pulse in as the chain runs, and when the board settles, their light gathers into one number that multiplies everything. The free spins go deeper, into a swarm.

**Target maths.**

| Measure | Target |
|---|---|
| Volatility | Extreme (SD 25–40) |
| Hit rate | 33–36% |
| Free spins | 1 in 280; average 140× |
| Feature share of RTP | ~52% |
| P(win ≥ 100×) | at least 1 in 1,500 spins |
| Max win | 15,000× |

**Palette:** abyss black `#03071E`, bioluminescent cyan `#00F5D4`, jelly violet `#9B5DE5`, lure gold `#FEE440`, deep teal `#0A3D62`, coral pink `#F15BB5`.

**Reel window:** no frame at all: symbols float in black water with drifting particles; tumbling creatures fade downward and new ones glow upward.

**Why it's not a reskin.** It's the only orb-sum game. Grand Finale is the other scatter-pays game, but it has no tumbles, applies its summed multiplier to a single board rather than at the end of a tumble chain, and is medium volatility.

---

## 11. Whiteout

**Hook:** a mountain face of shifting snow: wins slide away as avalanches, and every slide raises the multiplier.

**Theme promise.** High-alpine danger: a quiet slope, then a roar. The feeling is a sudden, overwhelming chain reaction. That means **extreme volatility**: Megaways variety on every spin, and runaway avalanches that are rare but huge.

**Mechanism.**
- Evaluation: ways, Megaways: 6 reels, each 2–7 rows drawn per spin (up to 117,649 ways). Board law: `heights` (independent per-reel heights).
- Modifiers: `tape_continuation_refill` (winners slide away and the reels refill from the same strip) and `cascade_step_ladder` (×1, ×2, ×3, ×5, ×8, then +1 per further slide with `beyond: increment`, capped at ×50).
- Feature: 4+ avalanche-beacon scatters award 12 free spins ("Whiteout") on a feature reel set whose ladder starts at ×2, with a spin-index schedule of ×1 for spins 1–4, ×2 for 5–8 and ×3 for 9–12 (the storm thickening). Retrigger +4.
- Pack evidence: example panel `panel-bg-megaways-cascade-roundbank` (variable heights with tumble; note its reel 1 is fixed at 4 rows, so as given it tops out at 67,228 ways; free that reel's height law to reach 117,649). The pair `tape_continuation_refill + cascade_step_ladder` is verified on `ways|heights` (cell ab), and the ladder with a tumble is on `panel-relax-ways-tumble-fishcollect-sampler`. Built on the Megaways height law with both modifiers on 2026-11-16.
- **Start the maths from:** `panel-bg-megaways-cascade-roundbank`.

**Grid:** 6 reels × 2–7 rows (Megaways). "Megaways" is a third-party trademark: the game and its paytable must not use the word. Call it "shifting snow depth" or "variable ways" on screen, and get the legal check the screen asks for before building.

**Symbols** (flat vector, crisp whites and blues, alpine signage style):
- Low (6): snowflake, ice crystal, pine sprig, ski pole basket, snow boot print, ice axe.
- Premium (4): ibex (curved horns), mountain hut (pointed roof), lammergeier (vulture with broad wings), the summit cross (top pay).
- Wild: snow cornice (an overhanging lip of snow; appears on reels 2–5).
- Scatter: avalanche beacon (a rescue transceiver with a pulsing signal).

**Feature story.** Each tumble is snow sliding off the mountain; the ladder is the avalanche gathering mass, so every further slide hits harder. The reel heights are snow depth: some columns are deep and full of ways, some are scoured to rock. The free spins are the whiteout itself: it starts heavier and thickens as the round goes on.

**Target maths.**

| Measure | Target |
|---|---|
| Volatility | Extreme (SD 22–35) |
| Hit rate | 34–38% |
| Free spins | 1 in 250; average 120× |
| Feature share of RTP | ~50% |
| P(win ≥ 100×) | at least 1 in 1,500 spins |
| Max win | 20,000× |

**Palette:** glacier white `#F1F7FB`, ice blue `#8ECAE6`, alpine navy `#023047`, warning orange `#FB8500`, rock grey `#5C677D`, dusk pink `#E5989B`.

**Reel window:** a steep slope seen head-on, with reel columns as snow chutes of varying depth; a ways counter at the top reads like an altimeter.

**Why it's not a reskin.** It's the only Megaways game, and the only one where the board shape changes every spin. Kiln shares the ladder idea but on a fixed cluster grid with high, not extreme, volatility.

---

## 12. Dark Sky

**Hook:** shooting stars land as wilds; a telescope swings to each one and lights its whole column.

**Theme promise.** A desert observatory on a moonless night: absolute clarity, a sky so full of stars it's dizzying. The feeling is rare wonder, the patience of watching and then a meteor. That means **extreme volatility**: on 4,096 ways, a few full-column wilds make huge wins, rarely.

**Mechanism.**
- Evaluation: ways, 4,096 (6×4). Board law: one base reel set.
- Modifiers: `wild_injection`: on about 1 in 7 spins, 1–3 shooting-star wilds are stamped on random cells. And `expanding_wild`: any wild visible on reels 2–5 (landed or injected) expands to fill its column.
- Feature: 3+ telescope scatters award 10 free spins ("Meteor Shower") on a feature reel set where the injection fires every spin, with a spin-index schedule of ×1, ×1, ×2, ×2, ×3, ×3, ×5, ×5, ×10, ×10. Retrigger +3.
- Pack evidence: the pair `wild_injection + expanding_wild` is verified on `ways|global_mixture` (cells ab and ba); single-family panels are `panel-injected-deterministic-wild-overlay` and `panel-expanding-wild-deterministic`; built at 6×4 on 2026-11-16.
- **Start the maths from:** `panel-plain-ways-substitution-no-overlay` (the plain ways base), adding the two families with the parameters from those two panels.

**Grid:** 6×4, 4,096 ways.

**Symbols** (flat vector, deep blues with starlight highlights, celestial-chart line style):
- Low (5): crescent moon, ringed planet, comet, nebula swirl, star chart compass rose.
- Premium (4): sextant, brass refractor telescope, observatory dome, the galaxy spiral (top pay).
- Wild: shooting star (a bright head with a long tail; expands into a full column of starlight).
- Scatter: telescope eyepiece (a circular lens view with crosshairs).

**Feature story.** Shooting stars fall at random; the telescope swings to each one and the column floods with starlight (the expanding wild). Two or three lit columns on 4,096 ways is a jackpot sky. In the Meteor Shower every spin has falling stars, and the night builds as the schedule climbs.

**Target maths.**

| Measure | Target |
|---|---|
| Volatility | Extreme (SD 22–32) |
| Hit rate | 34–38% |
| Free spins | 1 in 240; average 110× |
| Feature share of RTP | ~48% |
| P(win ≥ 100×) | at least 1 in 1,500 spins |
| Max win | 12,500× |

**Palette:** night sky `#0B132B`, starlight white `#F8F9FA`, desert sand `#E9C46A`, nebula violet `#7B2CBF`, dome copper `#B5651D`, horizon teal `#1C7C7D`.

**Reel window:** the reels are the slit of an observatory dome opening onto the sky; desert silhouette at the bottom; an expanding column draws as a telescope beam.

**Why it's not a reskin.** It's the only game where wilds are both injected and expanding, and the only 6×4 board. Noodle Cart's guaranteed walker is low volatility; here wilds are rare events on a huge way count.

---

## Wanted but refused or out of scope

Combinations considered for this batch that the pack refused, or that sit outside the TypeScript runtime list. All were checked on 2026-11-16 with `enginepack.base.build` (scope check) or `composability.pair`.

| Wanted | For | Verdict |
|---|---|---|
| Tumble + hold-and-spin (ways) | Honeycomb with cascades before the respins | **Refused:** "at most one continuation mechanic per record" |
| Tumble + sticky respin | Escapement with a cascade | **Refused:** same rule; the pair is `declared_excluded` |
| Hold-and-spin on Megaways (`ways\|heights`) | A Megaways coin game | **Refused:** fenced, a spin error under the height law (gap `respin_redraw_under_height_law`) |
| Wild injection or global_additive on Megaways | Whiteout with injected wilds or additive multipliers | **Refused:** both read a uniform-height board (`RAGGED_OK false`) |
| Orb sum + cascade ladder on scatter pays | Midnight Zone with a ladder too | **Refused:** pair not verified on `scatter_pays\|global_mixture` (a family never fired) |
| Sticky respin + orb sum | A respin that ends in an orb sum | **Refused:** pair not verified in any context |
| per_wild_sum on ways | Late Set on 1,024 ways | **Refused:** per_wild_sum applies to payline evaluators only |
| Hold-and-spin + cascade ladder; sticky respin + cascade ladder; per_wild_sum + cascade ladder | Ladder-driven respins | **Not verified** in any context (`composability.pair` shows no verified cells) |
| Book-style expanding special symbol in free spins | A classic "book" game | **Outside the runtime list.** The pack has `mystery_symbol_respin` (`panel-mystery-symbol-respin`), but it isn't among the modifiers being ported. Unfold's stacked mysteries give a similar whole-reel reveal. |
| Multipliers that accumulate across free spins | Midnight Zone or Whiteout feature | **Refused by doctrine:** cross-spin state is never generated. Replaced by spin-index schedules, which `SLOTS.md` §2.5 allows. |
