---
name: generate-games
description: Generate a batch of new Originals end to end - concepts screened against the team's design rules, built on the kit, reviewed by the AI evaluator, and kept only if they pass its gates. Use for "generate new games", "make a new batch", or "design N games".
---

# Generate a batch of Originals

Arguments: how many games to aim for (default 4), plus any theme or maths area to explore. Requested: $ARGUMENTS

The loop is: brief → concepts → paper screen → build → evaluate → gate → record. Every stage that judges runs in a **fresh subagent** that sees only what that stage allows, so no stage grades its own work. Ask the user to confirm before building more than 6 games: each build plus review takes several subagent runs on the subscription.

## 1. Brief (you)

Read, and pass the relevant parts on in the subagent tasks below:

- `docs/DESIGN-RULES.md`: the rules from the team's reviews. This is the bar.
- `docs/BUILDING-GAMES.md`: the maths and UI contracts.
- `docs/CATALOGUE.md`: the roster and the rejected principles (don't re-propose them).
- `npm run evaluator -- results`: what scores well now, and why the low scorers fail.

## 2. Concepts (subagent)

Launch a general-purpose subagent:

> Read `docs/DESIGN-RULES.md`, `docs/BUILDING-GAMES.md` (the maths contract) and the roster and rejected principles in `docs/CATALOGUE.md`. Propose <2 × target> new single-player Originals that follow every design rule. For each concept, write a card with: id, name, one-sentence rule, the watched draw, a **board inventory** (every element drawn or animated, and what it does to the result or to a decision), the odds picture (the on-board quantity that equals P(win | state)), the one risk knob and its P(win) range, checkpoints, the exact pricing method, and the closest existing game with the difference in board, draw and decision. Prefer the simplest version of each idea. Write all cards to `.evaluator/_generate/concepts.md`. Reply "done".

## 3. Paper screen (new subagent)

A different subagent screens, so the proposer never grades itself:

> Read `docs/DESIGN-RULES.md` and `.evaluator/_generate/concepts.md`, and the roster in `docs/CATALOGUE.md`. Be a strict reviewer. For each concept, apply every check in the pre-build checklist and say pass or fail with a one-line reason. Watch hardest for: a result decided by a pattern or a hidden state rather than a watched draw; any board element that doesn't bear on the result or a decision (dead structure); a board that dresses a simpler game as a richer one; odds that exist only as a number; and a reskin (the same board, draw and decision as an existing game). Then rank the concepts that pass everything, best first, by how much a casual player would enjoy them. Write the result to `.evaluator/_generate/screen.md`. Reply "done".

Take the top <target> concepts that passed. If fewer passed, build only those and say so. Don't overrule a failed check yourself.

## 4. Build (one subagent per game, up to 5 in parallel)

> Build the Original described below in `games/<id>` following `docs/BUILDING-GAMES.md` exactly (copy `games/half-moon`'s structure; Manual + Auto + Turbo as in `games/dice`). Keep the board to the elements in the board inventory, and put the one-sentence rule under the board in idle. Run every check in "Checking your game", open every screenshot, and fix what you see. Don't commit. Reply with the check results.
>
> <the concept card>

A build that can't pass its own checks after a fix attempt is dropped here.

## 5. Evaluate

Review every built game with the full `review-game` procedure (rules card, blind player, designer, submit), following its isolation rules. The blind player must never learn the game's id or name.

## 6. Gate

Keep a game as a `prototype` only if all of these hold:

- overall ≥ 3.5;
- win condition, simplicity and odds each ≥ 3 (after caps);
- the designer found no dead structure and no duplicate.

Otherwise, give its review's cons and confusions to one repair subagent (same instructions as step 4, plus "fix these"), then review again. A game that fails twice isn't committed: delete `games/<id>` and add a line to the rejected principles in `docs/CATALOGUE.md` with the reason.

## 7. Record

- Commit each kept game on its own: `node scripts/commit-game.mjs <id> "Add <Name>: <one-line principle>"`.
- Add a batch section to `docs/CATALOGUE.md`: the concept cards of the kept games, plus a results table (overall, the three clarity scores, RTP, volatility spread).
- If two or more games failed for the same reason, add that pattern to `docs/DESIGN-RULES.md`.

## Report

A table of every concept: screened out (and why), built, kept or dropped (with overall and the failing gate). Then tell the user that the kept games are live as prototypes. The team's reviews of them are the real test, and `/refine-evaluator` should follow once they are in.
