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
