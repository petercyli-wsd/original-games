# Slots batch 1: screen

An independent screen of the 12 concepts in `batch-1-concepts.md`, done 2026-11-16. It checks each concept against `docs/SLOTS.md` and against the Slot Math engine pack directly (`/Users/petercyli-wsd/Dev/slot-math-engine-pack`), not against the concepts file's own evidence.

**Verdict in one line.** Build 9: Midnight Zone, Escapement, Honeycomb, Hi-Score, Kiln, Whiteout, Unfold, Noodle Cart, Grand Finale. Keep Dark Sky as the reserve. Drop Late Set and Spin Cycle. Seven of the nine need changes first, listed below. Two need a decision before the build starts: the 3×3 hit-rate band (Hi-Score) and the Megaways trademark (Whiteout).

## How the evidence was checked

- **Start examples.** All 19 example panels the concepts name exist in `base.examples()`, with the families and context the concepts say.
- **Builds at the concept's grid.** For each concept I took its start example, changed `geometry` (and the strips and paylines to match) and `mechanics`, and built it with `base.build`. All 12 base-round mechanisms built, and each modifier fired in 3,000 seeded spins. I also built the feature reel sets that change the mechanics (Noodle Cart's walker + expanding wild, Hi-Score's ×25 marquee, Kiln's ×3 ladder, Dark Sky's every-spin injection, Unfold's 4-high stacked mysteries). Scripts: `/private/tmp/claude-501/-Users-petercyli-wsd-Dev/13cfb5a8-9f14-40a3-bad6-8b3082015b38/scratchpad/screen_build.py`.
- **Pairs.** `composability.pair` for every two-modifier concept and for the "refused" table. The verified cells match what the concepts say.
- **Family cards.** `scope.family_card(f)['verified_contexts']` for all 12 runtime modifiers.
- **Maths checks.** Exact dry-streak p95 by dynamic programming. Feature-share consistency for all 12. A rough feature-only volatility floor, SD² ≈ A²(1 + CV²) / N, where A is the average feature win, N the feature gap (1 in N) and CV the feature win's spread (1 is mild, 2 to 2.5 is typical of big features). A rough base-board hit-rate simulation for cluster and scatter-pays grids by symbol mix.

The untuned builds use the example strips at a new size, so their RTPs are far off (0.10 to 19). They prove the mechanism runs. They say nothing about the tuned numbers.

## Summary table

Scores are 1–5. Fit = theme and mechanic tell one story. Fun = anticipation, escalation, variety. Distinct = from the other 11 and from `reels`. Feasible = can hit 95.5–96.5% RTP and the §3 bands, and is readable at 420 px.

| Rank | Name | Mechanism | Volatility | Theme | Fit | Fun | Distinct | Feasible | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Midnight Zone | Scatter pays 6×5, tumble + orb sum | Extreme | Deep sea | 5 | 5 | 4 | 4 | BUILD WITH CHANGES (minor) |
| 2 | Escapement | Payline 5×3 20 lines, expanding wild + sticky respin | Medium | Clockmaker | 5 | 4 | 4 | 4 | BUILD WITH CHANGES (minor) |
| 3 | Honeycomb | Ways 5×5, hold-and-spin | High | Apiary | 5 | 4 | 5 | 3 | BUILD WITH CHANGES |
| 4 | Hi-Score | Payline 3×3 5 lines, global multiplier | Medium | Retro arcade | 5 | 4 | 5 | 3 | BUILD WITH CHANGES (needs a ruling) |
| 5 | Kiln | Cluster 7×7, tumble + cascade ladder | High | Pottery kiln | 5 | 4 | 4 | 4 | BUILD WITH CHANGES (re-theme) |
| 6 | Whiteout | Megaways, tumble + cascade ladder | Extreme | Alpine | 4 | 4 | 5 | 3 | BUILD WITH CHANGES (needs a legal check) |
| 7 | Unfold | Ways 5×4, mystery reveal | Low | Origami | 4 | 4 | 4 | 3 | BUILD WITH CHANGES |
| 8 | Noodle Cart | Payline 5×3 10 lines, walking wild | Low | Night market | 4 | 3 | 4 | 4 | BUILD WITH CHANGES |
| 9 | Grand Finale | Scatter pays 7×5, additive multiplier wilds | Medium | Fireworks | 4 | 4 | 3 | 3 | BUILD WITH CHANGES |
| 10 | Dark Sky | Ways 6×4, wild injection + expanding wild | Extreme | Observatory | 4 | 4 | 3 | 3 | RESERVE (build with changes only if one of the 9 fails) |
| 11 | Late Set | Payline 5×4 40 lines, summed wild badges | High | Jazz club | 4 | 3 | 3 | 4 | DROP |
| 12 | Spin Cycle | Cluster 8×8, wild injection | Low | Laundromat | 4 | 3 | 3 | 2 | DROP |

## Recommended build list (9)

1. **Midnight Zone.** The strongest concept. The orb sum on a pay-anywhere tumble is a proven, readable thrill, and the deep sea delivers "anything could rise out of the dark". The extreme band is reachable.
2. **Escapement.** The theme is the mechanic: locks hold, loose parts re-deal, the clock strikes. A win becomes a short chain, so the base game carries the action.
3. **Honeycomb.** The only hold-and-spin. A different rhythm from free spins, and a clear goal (fill the comb). Needs its max win fixed.
4. **Hi-Score.** The only 3×3, the only per-spin multiplier reel. Fast and very readable. Needs a ruling on the 3×3 hit-rate band before the build.
5. **Kiln.** The best "escalation inside one spin" on a fixed grid. The heat ladder is easy to show. Needs a re-theme to break the workshop cluster (see below).
6. **Whiteout.** The only variable board shape. It covers the heights board law. Needs a legal check on "Megaways" before work starts.
7. **Unfold.** The only mystery game; the reveal happens in the base game too. Needs its volatility and feature size brought in line.
8. **Noodle Cart.** Covers low volatility on lines, with a wild on every spin. Needs a smaller, more frequent feature to stay low.
9. **Grand Finale.** Covers medium volatility on scatter pays without tumbles. Its rocket must be the wild (that is how the pack works), which also makes it read differently from Midnight Zone's orbs.

**Reserve: Dark Sky.** Swap it in if Whiteout fails the legal check, or if any of the 9 fails the gate twice. It needs a re-theme off the night sky and a feature inside the pack's wild caps (see its section).

**What the 9 cover.**

- Evaluation law: payline ×3 (Noodle Cart, Hi-Score, Escapement), ways ×2 (Unfold, Honeycomb), Megaways ×1 (Whiteout), cluster ×1 (Kiln), scatter pays ×2 (Grand Finale, Midnight Zone). Every law is covered.
- Volatility: low ×2 (Noodle Cart, Unfold), medium ×3 (Hi-Score, Escapement, Grand Finale), high ×2 (Kiln, Honeycomb), extreme ×2 (Midnight Zone, Whiteout).
- Grids: 3×3, 5×3 (twice), 5×4, 5×5, 6×5, 7×5, 7×7 and 6×(2–7). Eight different shapes.
- Feature types: free spins ×8, hold-and-spin ×1. Base-game respin chain ×1 (Escapement).
- Modifiers: 10 of the 12 runtime modifiers. Not covered: `wild_injection` (only in Spin Cycle and Dark Sky) and `per_wild_sum` (only in Late Set).
- Themes after the required changes: deep sea, clockwork, apiary, arcade, a volcanic or other outdoor heat theme (Kiln re-themed), alpine, a paper landscape, a food market, fireworks. One workshop theme, not three.

## Batch-level findings

1. **The dry-streak claim is right.** The exact p95 of the longest losing run in 100 spins is 25 at a 20% hit rate, 20 at 25%, 18 at 28%, 17 at 30%, 16 at 32%, 15 at 33%, 15 at 34%, 14 at 35%, 13 at 38%, 12 at 40%. So any game below about 33% fails the dry-streak band. Targets at 33% sit exactly on the line; aim for 35% or more so measurement noise can't push it over.
2. **§3 contradicts itself for 3×3.** It gives classic 3×3 a hit-rate band of 10–25%, but at 25% the dry-streak p95 is 20, above the ≤ 15 limit. The gate checks both. So no 3×3 game can pass the gate as §3 is written. Hi-Score needs a ruling before it is built (see its section).
3. **Feature share is internally consistent for all 12.** Share ≈ (average feature win ÷ N) ÷ 0.96 matches each concept's stated share within one point: Noodle Cart 28.0%, Spin Cycle 28.4%, Unfold 29.8%, Hi-Score 28.9%, Escapement 32.6%, Grand Finale 34.7%, Kiln 46.9%, Honeycomb 42.6%, Late Set 47.3%, Midnight Zone 52.1%, Whiteout 50.0%, Dark Sky 47.7%.
4. **The low-volatility games pick features that are too big.** The feature alone adds SD² ≈ A × (A/N) × (1 + CV²). With the share fixed, a bigger, rarer feature means more volatility. At CV = 1: Noodle Cart's 35× at 1 in 130 gives 4.3; Unfold's 40× at 1 in 140 gives 4.8; Spin Cycle's 30× at 1 in 110 gives 4.0. The base game adds to that, and real free-spin wins usually have CV above 1. So all three would land at or above the SD 5 top of the low band. Fix: an average of 20–28× at about 1 in 80–100 (still inside the 1 in 80–300 free-spins band).
5. **Extreme volatility with a 34% hit rate is feasible.** SD above 20 comes from a thin tail, not from droughts. For example, a 1.2 × 10⁻⁶ chance of 20,000× adds about 480 to SD² while costing only 2.4% of RTP. The feature-only floor at CV 2.5 is about 22 for Midnight Zone, 20 for Whiteout and 19 for Dark Sky. So the targets are reachable. The measured SD will be noisy, because it rests on rare events; report it with its SE.
6. **Theme overlap.** Three workshop or craft themes: Unfold (folding paper on a wooden table), Escapement (clockmaker's bench), Kiln (pottery studio). Five night or dark-blue themes: Noodle Cart, Grand Finale, Late Set, Midnight Zone, Dark Sky; their background colours are all near-black navy (`#1B1A3A`, `#0D1B2A`, `#14213D`, `#03071E`, `#0B132B`). Dark Sky and Midnight Zone also make the same promise: rare wonder in the dark, extreme volatility.
7. **Three concepts share one player-facing idea.** Symbols carrying numbers that add up into a multiplier: Grand Finale (rocket wilds, 1 + sum, every spin), Late Set (wild badges summed along a line) and Midnight Zone (orbs summed at the end of a tumble). They are different modifier sets, so none is a reskin by the rule. But a player sees the same trick three times. Keep at most two.
8. **The pack's degeneracy caps.** The pack's composer runs a blocking check: at most 5% of spins may stamp 2 or more injected wilds (`wild_injection` `p_n_ge2 ≤ 0.05`), and at most 5% of spins may expand 2 or more wild columns at once (`expanding_wild` `p_multi_fire_ge2 ≤ 0.05`). See `docs/reference/mechanic-standard.md` and `reel_engine_catalog/docs/families/wild_injection.md`. `base.build` does not enforce it (my over-cap builds succeeded), and SLOTS.md doesn't require it. But it is the pack's norm for composed games. Spin Cycle's and Dark Sky's feature reel sets break it by design.
9. **Cluster tumbles in the runtime.** The pack's cluster evaluator always cascades. The adapter inserts the `tumble` plugin (the same refill law as `tape_continuation_refill`) on every cluster spec (`src/reelengine/adapter.py`). The TypeScript cluster port must do the same, or Kiln's ladder never climbs past the first rung.
10. **Names.** "Megaways" is Big Time Gaming's trademark, licensed to other studios. Don't use it in a game's UI, rules or name without a licence. The variable-height mechanic itself may need a legal check. "Hold and Spin" and "Avalanche" are used as branded feature names by some providers; use the game's own words for features. Also search every title against existing slot titles before launch. "Spin Cycle", "Grand Finale" and "Whiteout" are common phrases and may already be slot names; I did not check.
11. **Readability at 420 px.** With a 16 px gutter the reel window is about 388 px wide. 8 columns give 48.5 px cells with no room for gaps (Spin Cycle). 7 columns give 55 px (Kiln, Grand Finale). 6 columns give 64 px. A 7-row Megaways reel needs a window at least 340 px tall to keep 48 px cells.

## Per-concept screens

### 1. Midnight Zone (rank 1): BUILD WITH CHANGES (minor)

**Evidence checked.**
- `panel-scatterpay-tumble-orbsum` exists: scatter_pays|global_mixture, families `tape_continuation_refill` + `orb_sum_terminal`, tier `mc`, 6×5.
- Pair `orb_sum_terminal + tape_continuation_refill` is verified on `scatter_pays|global_mixture|ab`.
- Built at 6×5 with orb values up to ×100: it builds, `pair_verified`, and the orbs fire.
- Pack law (`orb_sum_terminal.py`): the final total is the tumble total × the sum of the orbs on the final board. Orbs never pay, are never removed, and add nothing if the sequence didn't win. The concept describes this correctly.

**Findings.**
- Fit 5. The dark board, the slow orb drop and the final multiply are the theme.
- Fun 5. Escalation inside one spin, and a big, uncertain ending.
- Feasibility. Feature share is consistent (52%). P(win ≥ 100×) of 1 in 1,500 is plausible: (1/280) × about 30% of features reaching 100×. A 15,000× cap is reachable with ×500 feature orbs.
- The hit-rate target of 33–36% starts on the dry-streak edge (33% gives p95 = 15 exactly).
- Distinct from Grand Finale only if Grand Finale's rockets are shown as wilds (see Grand Finale).
- Readability: 6×5 gives 64 px cells. Dark symbols "edged in luminous lines" can fade at 48 px on black. Give each creature a filled, bright body, not only an outline.

**Required changes.**
1. Target hit rate 35–38%.
2. Draw the symbols as filled glowing shapes with distinct silhouettes, not thin outlines.
3. The example spec has a wild role (symbol 2). Keep wilds off the strips, or remove the symbol, so the paytable matches "no wild".

### 2. Escapement (rank 2): BUILD WITH CHANGES (minor)

**Evidence checked.**
- `panel-payline-lockrespin-expandingwild-gapful` and `panel-payline-bothways-expandingwild-respin` exist: payline|global_mixture, `expanding_wild` + `sticky_respin`, tier `mc`, 5×3, 20 lines.
- Pair verified on `payline|global_mixture|ab`.
- Built with `expand_reels` [1, 2, 3] (reels 2–4): builds, `pair_verified`. The respin chain fired on every win.
- Pack law (`sticky_respin.py`): the base step's win is superseded, and only the final board pays. Every winning symbol, wild and scatter locks. The chain ends on the first respin that locks nothing. Matches the concept.

**Findings.**
- Fit 5, fun 4. Every win becomes a short build-up.
- Distinct from `reels` by the rule: same 5×3 / 20-line format but a different modifier set. But at first glance it looks like `reels`, and the designer's uniqueness call is noisy.
- Feasibility. Medium SD 6–9 is plausible: the feature-only floor at CV 1 is about 5.6. The 5,000× cap has no multiplier behind it. A full screen of the top symbol pays about the 5-of-a-kind line pay × stake (around 500–1,000×), so 5,000× needs several full screens in one feature. The sticky lock makes full screens more likely than usual, but P(cap) must be measured.
- Clarity: the first win "disappears" until the chain ends. A blind player may read that as a lost win.

**Required changes.**
1. Show the pending win during the chain ("Winding: 12.40") so the first win never seems to vanish.
2. Measure P(reaching the cap). If it is below 10⁻⁹, lower the cap to 2,500×.
3. Make the lock frames and the chain counter the dominant visual, so it doesn't look like `reels`.

### 3. Honeycomb (rank 3): BUILD WITH CHANGES

**Evidence checked.**
- `panel-ways-holdspin-respin-decorative` exists: ways|global_mixture, `hold_and_spin_lock_respin`, tier `mc`, 5×3, `entry_min` 3.
- `hold_and_spin_lock_respin` verified contexts include `ways|global_mixture`.
- Built at 5×5 with `entry_min` 6 and `full_grid_bonus` 1000: it builds. With coin-rich strips the respins entered and the full grid paid. So the mechanism and the full-comb bonus work at 5×5.

**Findings.**
- Fit 5, fun 4, distinct 5. The only hold-and-spin; a visible countdown and a clear goal.
- **The 5,000× cap can't be reached in practice.** The most the respins can pay is 25 cells × 100× + the 1,000× full-comb bonus = 3,500×, plus the trigger spin's ways win. Reaching even that needs 25 coins all at ×100. This breaks "never unreachable in practice: P > 1 in 10⁹".
- **High volatility may land in medium.** With coins of 1×–100× and an average of 45×, the respins' spread is modest. The feature-only floor is about 6 (CV 1) to 10 (CV 2), below the SD 11–16 target.
- The hold-and-spin at 1 in 110 fits both feature-frequency bands.
- The frame "drawn as hexagonal comb cells over the square grid" would mislead. Ways count adjacent reels, not hex neighbours, and a hex frame suggests the wrong neighbours.
- A 5×5 ways grid hits often (the untuned build hit 92%). Thinning the strips to 34–38% is a normal tuning job.

**Required changes.**
1. Fix the max win. Either add a rare top coin (for example a 500× "queen cell") so the cap is reachable, or set the cap at the measured reachable level (about 2,500×). Then measure P(cap) > 10⁻⁹.
2. Raise the feature's spread to reach high volatility: rarer and bigger respins (about 60× at 1 in 140, same share) or a heavier coin tail.
3. Keep square cells. Put the hexagon on the coin badge, not on the grid.
4. Name the feature in the game's own words ("Honey Harvest"), not "Hold and Spin".

### 4. Hi-Score (rank 4): BUILD WITH CHANGES (needs a ruling)

**Evidence checked.**
- `panel-global-iid-multiplier-reel` exists: payline|global_mixture, `global_iid`, tier `exact`, 5×3.
- Built at 3×3 with the 5 lines (3 rows + 2 diagonals) and a ×1–×10 marquee: it builds, `exact`. The feature marquee (×2–×25) also builds.

**Findings.**
- Fit 5, fun 4, distinct 5. The marquee stopping last is a real beat of suspense on every spin. The best fast format in the batch.
- **Gate conflict.** §3 says classic 3×3 hit rate is 10–25%. The dry-streak band needs about 33%. The concept targets 34–37% "on purpose", but the gate checks the measured hit rate against §3. As written, the game fails the hit-rate band if it passes the dry streak, and the other way round.
- Feasibility. 34–37% on a 3×3 with 5 lines needs few symbol types and stacked symbols. The untuned example strips gave 13%. It is doable: 7 symbols plus a wild with stacks. Max win: 2,500× needs a full screen of the top symbol at ×25 in the feature. Roughly (1/90) × P(×25) × P(full screen) ≈ 10⁻⁸ with stacked strips, so reachable but close; measure it.
- Medium SD 5–8: the feature-only floor is about 3.7. The ×10 base marquee adds the rest. Plausible.

**Required changes.**
1. Get an owner ruling before the build. Suggested: the 10–25% 3×3 band applies to classic fruit games with no feature. A 3×3 with a feature uses the general 20–45% band and must pass the dry streak. Update §3 to match.
2. Measure P(2,500×). If it is below 10⁻⁹, lower the cap or add a ×50 marquee value to the feature.
3. Keep the pixel art original (no likeness of famous arcade characters such as ghosts, invaders or plumbers).

### 5. Kiln (rank 5): BUILD WITH CHANGES (re-theme)

**Evidence checked.**
- `panel-cluster-tumble-generative-board` exists: cluster|global_mixture, `orb_sum_terminal`, tier `mc`, 7×7, 4-connected, 5+.
- `cascade_step_ladder` verified contexts include `cluster|global_mixture`.
- Built at 7×7 with the ladder [1, 2, 3, 5, 8, 12] in place of the orb: it builds and the ladder fires on cascades. The feature ladder [3, 5, 8, 12, 20, 30] builds too.
- Pack law (`cascade_step_ladder.py`): the base board takes `ladder[0]`, so a feature ladder that starts at ×3 multiplies every free-spin win by at least 3. That matches "the kiln is already at white heat".

**Findings.**
- Fit 5, fun 4. Heat rising on each cascade is easy to show (the brick mouth glowing).
- **Theme overlap.** Kiln, Escapement and Unfold are all craft or workshop themes. Kiln's mechanic (heat that climbs) fits many themes. Escapement's (a clock ticking) fits only clockwork.
- Feasibility. 34–38% on 7×7 needs a lean symbol mix. My iid simulation gives a base-board hit rate of 28% with 9 paying types (lows weighted ×3), 34% with 8 and 49% with 7. The concept lists 9 paying types plus a wild, so it sits at the low edge before wilds. High SD 12–18 is plausible: the feature-only floor is 9 at CV 1 and 14 at CV 2.
- Readability: 7×7 gives 55 px cells. The five glaze tiles told apart by shape (square, circle, triangle, hexagon, diamond) is good practice.

**Required changes.**
1. Re-theme to an outdoor heat theme that isn't a workshop. For example a volcanic caldera: mineral crystals in clusters, a pressure gauge that rises on each cascade, free spins as "Eruption". Keep the mechanic and the maths targets.
2. Use 8 paying types at most (for example 5 lows + 3 premiums), weighted toward the lows, plus the wild.
3. Builder: confirm that the TypeScript cluster port inserts the intrinsic tumble (finding 9).

### 6. Whiteout (rank 6): BUILD WITH CHANGES (needs a legal check)

**Evidence checked.**
- `panel-bg-megaways-cascade-roundbank` exists: ways|heights, `tape_continuation_refill`, tier `mc`. Its height law fixes **reel 1 at 4 rows**; reels 2–6 are 2–7. So it has at most 67,228 ways, not 117,649.
- `panel-mw-plainwild-standard-ways-tumble` exists, but its context is **ways|top_reel**, not the heights law.
- Pair `cascade_step_ladder + tape_continuation_refill` is verified on `ways|heights|ab`. (The ladder alone is "built, never fired" on ways|heights, which is expected: without a tumble it never climbs.)
- Built with the ladder [1, 2, 3, 5, 8], `beyond: increment`, cap 50: builds, `pair_verified`. Also built with all six reels at 2–7 rows: builds.

**Findings.**
- Fit 4, fun 4, distinct 5. The only game where the board shape changes. Snow depth as reel height is a good image.
- **IP.** "Megaways" is a trademark. The concept uses it as the mechanic's name. The mechanic may also need a legal check.
- Feasibility. Megaways hits often (the example hit 62%), so 34–38% is a normal tuning job. SD 22–35 is plausible from the feature tail. The ladder's cap of ×50 is never reached in practice: after ×8 it adds 1 per cascade, so ×50 needs 47 cascades. That's harmless, but don't show ×50 as a goal.
- Readability. Megaways + tumble + a ladder is the most to read in the batch. A blind player must follow changing heights, a ways count, slides and a rising multiplier.
- Taste: an avalanche is a real killer. Keep it about the mountain's power, with no victims or rescues. The summit cross is a religious symbol as top pay; a summit marker or flag avoids that.

**Required changes.**
1. Legal check on the variable-height mechanic before any work. Never use the word "Megaways" in the game. Call it what it is ("snow depth", "up to 117,649 ways"). If it is blocked, build Dark Sky instead.
2. Set every reel's height law to 2–7 rows (the start example fixes reel 1 at 4).
3. Show only three things during a sequence: the ways count, the current ladder rung, and the win. Show the ladder as the next rungs (×1, ×2, ×3, ×5, ×8, then +1), not as a ×50 target.
4. Replace the summit cross with a summit marker or flag.
5. Don't call the slides "Avalanche" as a feature name (another provider's branded term); "slide" or "snowslide" is fine.

### 7. Unfold (rank 7): BUILD WITH CHANGES

**Evidence checked.**
- `panel-ways-mystery-reveal-no-mult` exists: ways|global_mixture, `mystery_reveal`, tier `exact_mixture`, 5×3.
- Built at 5×4 (1,024 ways): builds, `exact_mixture`.
- Built the feature with 4-high stacked mysteries at 5×4: builds. 851 of 3,000 spins showed at least one whole column of one symbol after the reveal, so whole reels do unfold together.
- **The cited stacked-mystery evidence is wrong.** `panel-payline-mystery-fullreel-expansion` has no stacks: each reel has two single mystery cells. The stacked version works anyway (above), because stacking is only strip layout.

**Findings.**
- Fit 4, fun 4, distinct 4. The reveal is a small lottery on every spin, and the feature's whole-reel reveal is a real step up.
- **Volatility.** The target is SD 4–5. The feature alone gives about 4.8 at CV 1. Mystery reveals on 1,024 ways also make the base spiky. Expect SD 5.5–6.5 as specified, which is medium, not low.
- Theme overlap: "a sheet of paper on a low wooden table" makes it the third craft or workshop scene.

**Required changes.**
1. Bring volatility into the low band: an average feature of about 25× at 1 in 85–90 (same 30% share), or re-label the game medium and adjust its promise. Low is the better fit for "calm wonder".
2. Make the world a paper landscape (a pond, a forest, a paper sky), not a work table, so it doesn't read as a craft scene.
3. Fix the evidence citation (see the list at the end).

### 8. Noodle Cart (rank 8): BUILD WITH CHANGES

**Evidence checked.**
- `panel-walking-wild-guaranteed-iid-overlay` exists: payline|global_mixture, `walking_wild`, tier `exact_mixture`, 5×3, 20 lines, walker on reels 2–4 only.
- Built at 5×3 with 10 lines and the walker on all five reels (weights 1, 3, 3, 3, 1): builds, `exact_mixture`. The walker fired on every spin.
- Pair `expanding_wild + walking_wild` is verified on `payline|global_mixture` cells ab and ba. Built both orders for the feature: both build, `pair_verified`.
- Pack law (`walking_wild.py`): one iid reel per spin; it eats scatters; "walking" is presentation only, with no cross-spin state.

**Findings.**
- Fit 4. "The cook always shows up" is the low-volatility promise made literal.
- Fun 3. Constant hope, but a full wild reel every spin becomes wallpaper. The feature adds a second wild reel: more of the same rather than another room.
- **Volatility.** 35× at 1 in 130 gives a feature-only SD of about 4.3 at CV 1, before the base. Likely above 5.
- **Max win.** 10 lines with no multiplier: a full screen of the top symbol pays about the 5-of-a-kind line pay × stake. 1,500× needs a very large top pay or several full screens in one feature. Measure P(cap); 1,000× (the band's floor) may be the honest number.
- The walker covers a scatter when he lands on its reel. That costs the player a trigger in plain view. It needs to be shown and explained, or players will call it rigged.
- Don't animate the cook walking from last spin's reel to this one. The pack draws a fresh reel each spin, and a walk implies a path.

**Required changes.**
1. Feature: about 25× at 1 in 90–95 (same 28% share).
2. Measure P(1,500×). Lower the cap to 1,000× if it is below 10⁻⁹.
3. Make the free spins a different place: the dinner rush at full lantern light, a second cook, a different stall front. More than an extra wild.
4. Show the scatter being covered (the ticket in the cook's hand) and state it in the paytable.

### 9. Grand Finale (rank 9): BUILD WITH CHANGES

**Evidence checked.**
- `panel-scatterpay-notumble-globalwildmult` exists: scatter_pays|global_mixture, `global_additive`, tier `exact`, 6×5.
- Built at 7×5: builds, `exact`. Also built with `min_count` 10 at 7×5: builds.
- **Pack law contradicts the concept.** `global_additive` reads its values from the **visible wild symbols** (`legacy_hooks.py`: an affine factor over `view.wilds`). The scatter-pays evaluator adds wilds to **every** paying symbol's count (`evaluators/scatter_pays.py`). So the rocket must be the wild, and it joins every firework's count. "No wild: pay-anywhere doesn't need one" is not buildable as written.

**Findings.**
- Fit 4, fun 4. The visible add-up before the payout is a good finale beat.
- **Distinctness 3.** It is the same trick as Midnight Zone (numbered symbols that sum into a multiplier on a pay-anywhere grid) and Late Set (wild badges that add). The concept's line "adds its multipliers rather than summing them" isn't a real difference: both sum. Real differences: no tumble, the rocket substitutes, and it applies on every winning spin.
- **Hit rate runs hot at 7×5.** 35 cells with 8+ to win: my iid simulation gives 72% with 9 paying types (lows ×3) and 82% with 8. The tuner can thin it with strip layout, but a higher `min_count` (9 or 10, which builds) is a cleaner lever.
- Readability: 7×5 gives 55 px cells. Five low "burst" shapes (peony, willow, ring, crossette, palm) are all radial bursts and will blur at 48 px. They need very different silhouettes and colours.

**Required changes.**
1. The rocket is the wild: it counts toward every firework and adds its number to the multiplier. Paytable and art say so.
2. Present it as "wild rockets", so it reads differently from Midnight Zone's orbs, which never pay and only multiply at the end of a tumble.
3. Use `min_count` 9 or 10 on 7×5, or more paying types, to reach a 34–38% hit rate.
4. Give the low symbols clearly different silhouettes (not five round bursts).
5. Optional, if the batch wants more separation from Midnight Zone: swap `global_additive` for `mystery_reveal` ("unlit shells burst into one colour"). That is verified on `scatter_pays|global_mixture` and built at 7×5 (`exact_mixture`).

### 10. Dark Sky (rank 10): RESERVE

**Evidence checked.**
- `panel-plain-ways-substitution-no-overlay` (ways, no modifiers, `exact`), `panel-injected-deterministic-wild-overlay` and `panel-expanding-wild-deterministic` exist.
- Pair `expanding_wild + wild_injection` is verified on `ways|global_mixture` cells ab and ba.
- Built at 6×4 (4,096 ways) in both orders: both build, `pair_verified`, `exact_mixture`. **Order matters.** On the same untuned strips the RTP was 19.30 (inject, then expand) and 15.97 (expand, then inject). The concept's "landed or injected" wilds expanding needs `[wild_injection, expanding_wild]`.
- The every-spin feature (1–3 stars) builds, but breaks both pack degeneracy caps (finding 8).

**Findings.**
- Fit 4, fun 4. A star falling and a column lighting up is a clear, exciting moment.
- **Distinctness 3.** Same night-sky setting as Grand Finale. Same promise as Midnight Zone (rare wonder in the dark, extreme). Shares `wild_injection` with Spin Cycle and `expanding_wild` with Escapement and Noodle Cart's feature.
- "Two or three lit columns" as the jackpot sky is fine in the base game if it stays rare (≤ 5% of spins). In the feature it would be most spins.

**Changes if it is built.**
1. Re-theme away from the night sky (for example a daytime desert storm with lightning strikes as the wilds), or swap the setting with Grand Finale's.
2. Feature: one star every spin, with 2+ on at most 5% of spins. Keep multi-column expansions at most 5% of spins, or get a ruling that the pack's caps don't apply to feature reel sets.
3. Mechanics order `[wild_injection, expanding_wild]`.

### 11. Late Set (rank 11): DROP

**Evidence checked.**
- `panel-wild-mult-sum-doghouse` and `panel-payline-boosted-boardmult-wild` exist: payline|global_mixture, `per_wild_sum`, tier `exact`, 5×3.
- `per_wild_sum` is verified on payline contexts only (its kinds list is `payline`), so "per_wild_sum on ways refused" is right.
- Built at 5×4 with 40 lines: builds, `exact`.

**Findings.**
- Fit 4, fun 3, distinct 3, feasible 4. The maths is easy (exact tier) and the band is reachable.
- Why drop it: it is the third concept built on "numbers that add into a multiplier". It is the third high-volatility game. It is a fifth night-palette theme. And 40 lines on 5×4 is the hardest line game to read: a blind player can't see which line a badge sum belongs to.
- If it comes back: 20–25 lines, and make it the only "summed badge" game by changing Grand Finale (see Grand Finale's option 5).

### 12. Spin Cycle (rank 12): DROP

**Evidence checked.**
- `panel-cluster-tumble-generative-stack` exists: cluster|global_mixture, `wild_injection` + `vault_coinsum_x_wildcount`, tier `mc`, 7×7.
- `wild_injection` verified contexts include `cluster|global_mixture`.
- Built at 8×8 with only `wild_injection`: builds, `single_verified`. The every-spin feature also builds.

**Findings.**
- Fit 4, fun 3.
- **Feasibility 2.** Low volatility (SD 3–5) is the hardest promise in the batch for a cluster tumble. Chains are what make cluster games swing: the two cluster examples, untuned, ran SD 9.8 and 18.6 at about 90–100% RTP. A 38–44% hit rate needs fewer symbol types, which lengthens chains and raises volatility further.
- **Readability.** 8×8 at 420 px gives 48.5 px cells with no gap. Five socks share one silhouette family (all socks), against the "shape alone tells them apart" rule.
- **Pack norm.** The feature's 1–3 bubbles every spin breaks the `wild_injection` cap (2+ stamps on at most 5% of spins). The concept quotes the cap for the base only.
- Distinct only by volatility from Kiln (the other cluster game), and it shares `wild_injection` with Dark Sky.
- If it comes back: 7×7, mixed laundry items with different shapes (sock, mitten, shirt, button, peg), one bubble per feature spin, and a medium-volatility promise.

## Evidence claims in the concepts file that are wrong or misleading

1. **"Eleven different grids."** There are 10: 5×3 (Noodle Cart, Escapement) and 5×4 (Unfold, Late Set) each appear twice.
2. **Unfold: "stacked full-reel mysteries on `panel-payline-mystery-fullreel-expansion`".** That panel has no stacked mysteries; each reel has two single mystery cells. (A stacked 4-high version does build at 5×4, so the mechanism is fine.)
3. **Grand Finale: "Multiplier: rocket ... No wild".** In the pack, `global_additive` takes its values from visible wild symbols, and in scatter pays a wild adds to every symbol's count. The rocket has to be the wild.
4. **Grand Finale vs Midnight Zone: "adds its multipliers rather than summing them".** Both sum. Grand Finale applies 1 + the sum on every spin; Midnight Zone applies the sum of the orbs on the final board after a tumble.
5. **Whiteout: `panel-mw-plainwild-standard-ways-tumble` as Megaways evidence.** Its context is `ways|top_reel`, not the heights law. And the start example `panel-bg-megaways-cascade-roundbank` fixes reel 1 at 4 rows, so as given it has at most 67,228 ways, not 117,649.
6. **Honeycomb: max win 5,000×.** Not an evidence claim, but internally inconsistent: with coins up to 100× and a 1,000× full-comb bonus, the respins top out at 3,500×.
7. **Spin Cycle: "keep P(≥2 per episode) ≤ 5% as the pack's degeneracy cap asks".** Applied to the base only. The feature's 1–3 bubbles every spin breaks the same cap.
8. **Hi-Score: "above the classic 3×3 band of 10–25% on purpose".** Right about the dry streak, but it skips the consequence: the gate checks the measured hit rate against §3, so this needs a ruling, not just intent.

**Claims I checked and found right:**
- All 12 base-round mechanisms build through `base.build` at the stated grid.
- All named start examples exist with the stated families and tiers.
- Every verified-pair claim (walking + expanding wild on payline ab/ba; expanding wild + sticky respin on payline; tumble + orb sum on scatter pays; tumble + ladder on ways|heights ab; injection + expanding wild on ways ab/ba).
- Every row of the "refused or out of scope" table (continuation singleton, the height-law fences, `per_wild_sum` payline-only, the unverified ladder pairs).
- The dry-streak figures (20 / 17 / 15 / 14 at 25 / 30 / 33 / 35%).
- No two concepts share a modifier set.
- Every runtime modifier is used at least once.
- Every concept's feature share agrees with its frequency and average win.
