# Design rules from the team's reviews

What the team's reviews say makes an Original good or bad, written as rules a generator can check before building anything. Every rule cites the games behind it (team score, Pierre 3×). `/generate-games` screens concepts against these rules, and the evaluator checks the built game against the same ideas. Update this file when a new pattern shows up in two or more reviews.

## The rules

1. **The result is a draw the player watches land.** A roll, a spin, a cut, a flip, a match, a slice removed. Games decided by a pattern the player has to check or a hidden state they only see clues about scored 1–2 however elegant: Chords 2.25, Bootstrap 2.0, Branching 2.0, Spanning 2.0 (patterns); Bayes 2.0, Euclid 2.0 (hidden state).
2. **Everything on the board matters.** Every part that moves or is drawn must bear on the result or on a decision. Dead structure makes a clear game feel random and pointless. Halo 2.25 (the walk moves in two directions, but only one matters), Spanning 2.0 ("all of the game is irrelevant except the row the A is on"), Half-Life 1.25 (a lab clock and decay times that never change the odds).
3. **The presentation tells the truth about the maths.** If the board promises a richer game than the maths delivers, the team calls it out. Zigzag 2.5 looks like a pattern-building game, but it is a run of independent higher-or-lower draws ("basically a higher-or-lower reskin").
4. **The odds are a picture, not just a number.** The chance is a length, an area, an angle or a count the player can see change: Slice 4.0 (the circle's share of what is left), Last Slice 4.0 (slice angle = chance of being hit), Penney 4.0 (a tug-of-war bar), Dice 5.0 (the green share of the track). A printed percentage alone is taken on trust.
5. **Shared maths is fine; a shared board is not.** Last Slice (4.0) and Half-Life (1.25) have the same maths (exponential races). The team loved the wheel and rejected the atoms. Uniqueness is about what the player meets: the board, the draw and the decision.
6. **One sentence, one knob.** The rule fits in one sentence a new player could say after one round. Risk comes from one natural control whose effect you can see (circle size, slice size, which seed). Interacting settings, extra bet types and unexplained symbols cost simplicity on every low-rated game.
7. **Every step changes the stakes.** The good games have a visible approach or race where each event moves the odds, both ways, with a real cash-out decision between events: Slice, Penney, Bracket 4.0, Last Slice. Short rounds that settle the moment you bet (Spanning on Safe) have nothing to root for.
8. **Show what the next draw would do.** A chance the player can see but whose changes have no visible cause reads as random. The fixes that lifted games most in the November revamp drew the next draw's effect on the board: Crash Colours (each band as tall as its chance, 3.43 → 4.28), Convex (each dot lands in a green or red region, 2.80 → 3.72), Records (one ball per item into equal slots, green slot is the record, 3.00 → 3.75), Line Cut (the shadow's share of the ruler is the chance, 3.00 → 3.63).
9. **Cut to one knob before redrawing anything.** Removing settings did more than any redraw: Crocodile Dentist (bite bonus and teeth count removed, 3.43 → 3.65), Lighthouse (shutters removed, 2.83 → 3.59), Knight (fixed 5 hops, target is the only choice, 3.26 → 3.63), Hot Potato (2.85 → 3.75). A layout that only dresses a simpler draw doesn't survive the cut: Mediant without its Stern–Brocot tree is Plinko, Line of Sight is fixed-chance draws in a visibility costume, and both were archived.
10. **End the round when the bet is decided.** Flips or moves played out after the result is settled are motion that can't matter, and players read the board's tally as the result (Showdown's early-decided series confused its blind player until the round stopped at the deciding card).
11. **Don't draw the parts of the format that hurt.** Where a variable payout or a fee is the format itself (Leverage), drawing it more explicitly made players notice it more and scored no better; simplify the default round instead.

## Pre-build checklist

A concept goes to the build stage only if it passes all of these on paper:

| Check | Pass |
|---|---|
| Watched draw | One sentence names the draw the player watches, and the result follows from it directly |
| Board inventory | Every element drawn or animated is listed with what it does to the result or a decision; none is decoration (the deciding draw's animation counts as the draw) |
| Honest framing | The board's story is the maths' story; not a simpler game in a richer costume |
| Odds picture | P(win \| state) is a literal on-board quantity (length, area, angle, count), labelled |
| One sentence | The rule fits one sentence using only shapes |
| One knob | One visible control moves P(win) by at least 25:1 |
| Not a reskin | No existing game has the same board, draw and decision (`docs/CATALOGUE.md`, `games/`, market list) |
| Fair pricing | Exact P(win \| state) exists (closed form, DP or enumeration) for the martingale cash-out in `docs/BUILDING-GAMES.md` |

## Search-loop rule: the odds must be readable from the board (added 2026-11-09)

Four games built from concepts that passed the paper screen failed the blind-player gate on the same ground: the headline win chance moved after each draw, but the board gave no visible reason, so the player "trusted the number".

| Game | Gate | What the player could not see |
|---|---|---|
| `piggyback` | 3.00 twice, simplicity 2 | why a hop into a clear lead cut the chance; why stacks carried riders |
| `truel` | 3.13, then 2.85 after repair | why the most accurate shooter was the worst bet and why a miss raised your chance |
| `fault` | 2.52 twice | why a ball that added a block lowered the chance; what "ends it" meant |
| `rope` | 2.61, then 2.54 after repair | why the start chance was 44.6%; why a round ended early on a computed "no way to hold" |

Before building, a concept must show on paper:
- the chance after a draw changes by an amount you can read off a literal board quantity (a count, a length, a share of a bar), not off a hidden cascade or combinatorial count;
- the option that looks strongest is not the worst bet;
- no round ends on a computation instead of a draw the player watched.

Cascade and merge maths (collisions, stacking, connected runs) is the likeliest to break this. Repair rounds that only add labels did not move the score.
