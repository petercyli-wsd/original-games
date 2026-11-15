# Slots: maths contract, design guide and production pipeline

Slots are the second kind of in-house casino content, next to the Originals. This file is the contract every slot on the site follows, and the guide the slot pipeline (`/generate-slots`, `/review-slot`, `/search-slots`) builds from. Read it before building, tuning or reviewing a slot.

The maths authority is the manager's **Slot Math engine pack** (`/Users/petercyli-wsd/Dev/slot-math-engine-pack`, Python 3.12, a venv at `.venv`). It holds base-round engines that were verified before they shipped, and it refuses anything outside its verified scope, by name. Our browser runtime, `packages/slots` (TypeScript), is a port of the parts we use. Parity with the pack is what makes a port trustworthy: same spec, same seed, same board and same win, coin for coin.

## 1. How slots are made (and what's commonly misunderstood)

| Belief | Correction |
|---|---|
| A slot is a creative theme wrapped around a probability engine. | Yes. But the maths model is designed for the theme's promise, not bolted on. A "volcano" slot promises big rare eruptions (high volatility, a top win of 5,000× or more). A "picnic" slot promises frequent small wins (low volatility, a hit rate around 35%). Theme, volatility and feature must tell the same story. |
| RTP is 85–98%. | Online slots are mostly **94–97%**, with 96% the most common figure. 85–92% is land-based or lottery-style. Many operators run the same game at several RTPs (for example 96 / 94 / 92), built from different reel sets. Ours default to **96%**, inside a 95.5–96.5% band. |
| RTP is best found by Monte Carlo. | **No. Exact first.** With independent uniform reel stops, a base game's RTP is a closed form over the strips' symbol counts, or an exact enumeration of every stop combination: a 5-reel game of 40-stop strips has about 10⁸ boards. Paytables are tuned against the exact number. Monte Carlo is a check, and the honest fallback only where randomness after the stops (tumbles, random multipliers) blocks a closed form. Then it always carries its standard error and n. The engine pack labels every RTP `exact`, `exact_mixture` or `mc`, and so do we. |
| Choose a mechanism: payline, ways or scatter. | Right idea; the full set of evaluation laws is wider. **Payline** (fixed lines, left to right), **ways** (243, 1024; any position on adjacent reels), **cluster** (5+ touching symbols on a grid), **scatter pays** (8+ of a symbol anywhere), **hold-and-spin** (coins lock and respin) and **static grid**. Then the **board law**: fixed reel heights, variable heights per spin (Megaways), a top reel, and weighted reel sets. Then **modifiers** on top: wilds (sticky, expanding, walking, multiplier), tumbles/cascades, mystery symbols, random multipliers, collectors, respins. The pack lists 97 such families. |
| Choose a size. | Size follows the mechanism. Paylines use 5×3 (also 3×3 and 5×4). Ways use 5×3 = 243 or 5×4 = 1024. Cluster uses 6×6 to 8×8. Scatter pays uses 6×5. Megaways uses 6 reels of 2–7 rows. Size changes the hit rate more than anything else. |
| Pick symbols (A K Q J low), set payouts, rare symbols pay big. | Yes. Typically 4–6 low symbols (the card ranks, or themed equivalents), 3–5 premiums, a wild and a scatter. Pays rise steeply with length (3 → 4 → 5 is often ×3 to ×4 per step). A 3-of-a-kind on the low symbols often pays **less than the stake** across all lines. That's normal: it gives a "win" that's a loss, and it's part of why the hit rate looks high. |
| Number of a symbol on the middle reel decides 4/5-of-a-kind. | Partly right. For left-to-right lines, P(run ≥ k) is the **product** of the symbol's frequency (plus wild's) on reels 1..k. **Every** reel up to k matters, not only the middle. Designers thin out premiums on **reels 4 and 5** to make the 5-of-a-kind rare without touching the 3-of-a-kind. And they put wilds only on reels 2–4, so a wild can't start a line or make the 5-of-a-kind too common. |
| Order on the reel matters. | It doesn't change the RTP of a single centre line, because every stop is equally likely. It **does** matter for what the window shows. A 3-row window shows 3 consecutive stops, so stacking (the same symbol 3 in a row) creates full-reel symbols, raising the chance of many lines or ways at once (volatility). Spacing decides whether two scatters can appear on one reel. The pack's only hard layout rule is a minimum gap between scatters. |
| Tune reel sizes and proportions to hit RTP and experience. | Yes. And "experience" has measurable targets, listed in §3: hit rate, volatility, how often the feature comes, how the RTP splits between base game and feature, the maximum win, and dry streaks. A good slot is tuned to all of these, not only to RTP. |
| Wilds and special symbols trigger features, which affect RTP. | Yes. Features are usually **30–50% of the RTP**. Free spins typically trigger once in 120–250 spins and pay 30–100× on average. The base game alone then returns only ~55–65%, which is why base play feels "tight". |
| Can mechanisms combine? | Yes, within limits. Tumbles combine with ways, cluster and scatter pays (that is how Megaways games and "pay anywhere" games work), and multipliers sit on top. Some pairs conflict. The pack has tested 16,456 combinations and blocks 156 pairs, by name. Check `enginepack.composability.pair(a, b)` before combining two modifiers. |

## 2. The slot maths contract (non-negotiable)

1. **Independent reels.** Each reel stops at one uniform position on its circular strip. Weighted stops exist only as integer-weighted virtual strips. Reels never couple except through a declared reel-set choice. No outcome is chosen first and then "dressed" as reels.
2. **Draw after the bet.** Draw the stops (and any later draws) only after `await ticket.place()` succeeds. Guard the Spin button against double presses with a ref. Settle every paid spin, including any free spins it triggers, on that spin's ticket.
3. **The spec is the game.** Each slot's maths lives in one `game_spec_v2` JSON file: symbols, strips, geometry, evaluation, pays, mechanics and trigger. The UI reads it and never hard-codes a pay or a strip.
4. **Verified by the pack.** `npm run slots:oracle -- <id>` (which runs `scripts/slots/oracle.py` in the pack's venv) does three things:
   - builds the spec through `enginepack.base.build`. A refusal is a failed build, never a reason to route around the pack;
   - records the pack's analytics (RTP with its tier);
   - records 2,000 seeded spins.

   It writes `games/<id>/src/oracle.json`, which is committed. CI has no pack, so the TypeScript tests replay `oracle.json`: the same seeds must give the same stops, board, wins and coins, and our exact RTP must equal the pack's to 1e-9.
5. **Features.** Free spins and other bonus rounds are a sequence of ordinary feature-spin boards, each a pack-verified spec of its own. Their value is exact algebra over those specs:
   - E[spins] comes from a DP over spins awarded and spins left;
   - a multiplier that depends only on the spin index gives Σₖ P(N ≥ k)·mₖ·E[w].

   It is checked by Monte Carlo within 4 SE. A bonus law outside that shape needs the pack's bonus engine (`enginepack.bonus`) or doesn't ship.
6. **Honest RTP.** The RTP shown is the computed one, with its tier: 96.00% `exact`, or 96.02% ± 0.03% `mc` (n = 10⁸). It must sit inside 95.5–96.5%. The game page shows it, along with the hit rate, the maximum win and the feature frequency.
7. **Max win.** A declared cap, typically 5,000×–25,000× the stake. A round that reaches it ends and pays the cap. The cap's effect on RTP is included in the calculation.
8. **No fake near-misses.** Reels show real strip positions. Never substitute "almost" boards, and never slow down or tease reels unless the anticipation is real: for example, two scatters have landed and the third reel can still complete the trigger, which is exactly when real slots slow down.
9. **No player-editable maths.** Bet size and the number of lines (if lines are a choice) don't change RTP. Buying the feature, if offered, is priced at its exact value ÷ the target RTP.

## 3. Player experience: measured targets

`npm run slots:eval -- <id>` measures these from the spec. Exact where possible, otherwise from 10⁷ simulated spins with SE.

| Measure | What it means | Healthy band |
|---|---|---|
| RTP | Long-run return | 95.5–96.5% |
| Hit rate | Spins that pay anything | 20–45%. Classic 3×3: 10–25%; cluster/scatter pays: 25–45% |
| Win > stake rate | Spins that return more than the stake | 8–25% |
| Volatility (SD of win per spin, in stakes) | Swinginess | Low 2–5, medium 5–10, high 10–20, extreme > 20. It must match the theme's promise and the manifest |
| Feature frequency | 1 in N spins | 1 in 80–300 for free spins; 1 in 40–120 for smaller features |
| Feature share of RTP | How much rides on the feature | 25–55% (0% for a pure base game) |
| Average feature win | In stakes | 15–150× |
| P(win ≥ 100×) per spin | How often the big moments come | Low: 1 in 5,000+; high: 1 in 1,500 or more often |
| Max win | Declared cap, and the measured P(hitting it) | 1,000×–25,000×, never unreachable in practice: P > 1 in 10⁹ |
| Dry streak p95 | 95th percentile of the longest run of non-paying spins in 100 spins | ≤ 15 |
| Session | Median balance after 200 spins at 1 unit, starting from 100 | Shows how the volatility feels |

These are guides for tuning and inputs to the review. The gate (§5) uses only the ones marked there.

## 4. Theme and UI (`docs/SLOT-STYLE.md` has the details)

- **The UI stays simple.** The kit's slot layout is the same for every game: a reel window, Spin, bet, Autoplay, Turbo, an info/paytable sheet, a win readout and the balance. The kit draws it; games don't build their own panels.
- **The theme is the game's own:** palette, symbol art, names, the feature's story and its sounds-as-motion (no audio yet). Symbols are original flat vector art drawn in SVG inside the game (no emoji, no copied art, no real brands), readable at 48 px. The low symbols are themed (gems, tools, fish species), not plain A K Q J, unless the theme is a classic.
- **The paytable is generated from the spec,** so it can never disagree with the maths. It shows every symbol's pays, how the wild and the scatter work, the feature rules, the RTP with its tier, the hit rate, the max win and the feature frequency.
- **Win presentation:** highlight the winning lines, ways or clusters one at a time (Turbo: all at once). Count up the win over a time proportional to its size, capped at 3 s. Mark big wins at ≥ 20× and ≥ 100×. Every highlighted win shows its symbol × count = amount.
- **Anticipation only when real** (§2.8).

## 5. The slot review (`/review-slot`)

A slot is reviewed like an Original. There are three isolated Opus roles plus the measured facts, and code computes the overall. The scores are slot-specific.

- **Rules card (reads the spec and source):** the mechanism, symbols, pays, features and theme. Facts only.
- **Blind player (screenshots only, never the spec or code):** plays at least 60 spins, plus a feature if one can be forced through the dev hook `?feature=1`. Scores 1–5:
  - **theme** (does it feel like a place, a story);
  - **readability** (can you tell which symbols pay and what just won);
  - **feature clarity** (did you understand what triggered and what happened);
  - **excitement** (anticipation and big moments);
  - **fun** (would you keep spinning).
  
  It answers factual checks: what pays the most, how the feature is triggered, and what the wild does.
- **Designer (card + measured facts + player review):** scores 1–5:
  - **creativity** (theme and mechanic together, beyond a reskin);
  - **maths fit** (volatility, hit rate and feature fit the theme's promise; measured facts inside the §3 bands);
  - **uniqueness** against the slot catalogue (`docs/SLOT-CATALOGUE.md`);
  - **polish** (art consistency, symbols readable at size).
- **Overall** (code): weighted mean.
  - Fun ×3; excitement ×2; theme ×2; readability ×2; creativity ×2; maths fit ×2; feature clarity ×1.5; uniqueness ×1.5; polish ×1.
  - Readability cap: overall ≤ 1.5 + 0.75 × readability.
  - Maths-fit floor: any §3 band missed by more than its width caps maths fit at 2.
- **Gate (keep):** all of these must hold:
  - overall ≥ 3.5;
  - readability ≥ 3, feature clarity ≥ 3;
  - the oracle passes (`oracle.json` reproduced, pack RTP inside 95.5–96.5%);
  - the measured hit rate, dry streak and max-win reachability are inside §3;
  - not a reskin (another catalogue slot with the same evaluation law, the same modifier set and the same volatility band).
- **Panel:** 3 blind players when the overall is 3.25–3.75, as for Originals.
- **Team ratings,** once they exist, decide over the AI, the same rule as Originals.

## 6. Production pipeline

1. **Concept** (`opus`): the theme, its promise, the mechanism (evaluation law + board law + 0–3 modifiers, checked with `composability.pair`), the target volatility and feature, the symbol list with art direction, and why it isn't a catalogue reskin.
2. **Maths** (`sonnet` with the tuner):
   - start from the closest pack exemplar or example (`enginepack.base.examples()`);
   - write the spec;
   - tune strips and pays with `npm run slots:tune -- <id>` until RTP (exact) and the §3 targets are met;
   - run the oracle.
3. **Build** (`sonnet`): manifest (`collection: 'slots'`), symbol SVGs, theme palette, the game's feature presentation, using the kit's slot layout.
4. **Checks:**
   - typecheck;
   - tests (`oracle.json` parity, exact RTP, the feature algebra vs MC, fairness: draw after place, no double spin);
   - `slots:eval` bands;
   - screenshots at 1280×800 and 420×900.
5. **Review and gate** (§5). Repair from the review's cons up to twice, then keep it or drop it, with the reason logged in `docs/SLOT-CATALOGUE.md`.
