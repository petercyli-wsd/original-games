---
name: iterate-game
description: Improve existing Originals games against the evaluator's criteria - diagnose from the latest AI and team reviews, repair, re-review with a blind-player panel, and keep the change only if it passes the gate or clearly beats the old score. Use for "iterate on <game>", "improve these games", or after a review flags fixable problems.
---

# Iterate on existing games

Arguments: game ids, or `failing` for every game in Experimental that fails `npm run evaluator -- gate`. Requested: $ARGUMENTS

Don't iterate a game the team rated 3.5 or more: the team's rating is the truth, and the AI's lower score is the evaluator's error, not the game's.

Each game goes through: diagnose → (fork if team-reviewed) → repair → check → panel review → preview → accept or revert. Every judgement runs in a **fresh subagent**, following the isolation rules in `.claude/skills/review-game/SKILL.md`. The repair subagent never sees the evaluator's prompts, and no reviewer sees the repair notes. Run up to 5 games in parallel. Ask before starting more than 10.

## 1. Diagnose (you)

`npm run evaluator -- review <id>` prints the latest AI review (each facet's score and reasoning, pros, cons, gate result) and the team's reviews. From it, write `.evaluator/<id>/brief.md`, listing:

- every facet below 4, with its reasoning;
- every cap that fired (look for "[Capped" and the dead structure, reskin and misread cons);
- the blind player's confusions;
- the team's comments.

Then name the **one or two changes most likely to fix the biggest problems**, judged against `docs/DESIGN-RULES.md`. Prefer presentation fixes (make the draw visible, draw the odds as a quantity, remove or connect dead structure, cut extra settings, put the one-sentence rule under the board) over changing the maths.

If the problem is the concept itself (a result decided by a pattern or hidden state, a reskin), say so in the brief and stop: the game stays as it is, or goes to the Archive, rather than being patched.

## 2. Fork if the team has reviewed it

If the review output lists team reviews, run `node scripts/fork-game.mjs <id>`. This keeps the reviewed version in the Archive with its reviews and works on `<id>-v2`. Then run `npm install --package-lock-only --ignore-scripts`. Use the new id from here on. Games without team reviews are improved in place.

## 3. Repair (subagent)

> Improve the game in `games/<id>`. Read `docs/DESIGN-RULES.md`, `docs/BUILDING-GAMES.md` and `.evaluator/<id>/brief.md`, then make the changes the brief asks for. Keep the maths exact and the pricing fair (the contract in BUILDING-GAMES). Keep what already works. Don't add settings, bet types or decoration. Run every check in "Checking your game" and open every screenshot. Fix anything clipped, unreadable or confusing. Don't commit. Reply with what you changed and the check results.

Then add or update `revision` in the game's manifest: `{ kind: 'improved', date: '<today>', note: '<one line on what changed, for players>' }`. For a forked game, the kind is still 'improved'.

## 4. Review

1. `npm run evaluator -- prepare <id>`. The code changed, so it needs a new rules card: run the rules-card subagent from review-game.
2. `npm run evaluator -- player-prompt <id>`, then launch the blind-player subagent from review-game with only its alias.
3. `npm run evaluator -- judge-prompt <id>`, then launch the designer subagent.
4. `npm run evaluator -- preview <id>`. If the overall is between 3.25 and 3.75, one player's quirks can decide the gate, so widen to a panel: `player-prompt <id> --players 2 --more`, run the two new blind players, then repeat 3 and 4. Scores are then medians of the three plays.

All of this works with the API down (the CLI says so and uses its cache).

## 5. Accept or revert

`preview` scores the new review locally and checks the gate. Nothing is stored. A game the team has already rated passes or fails on the team's average, so the gate only matters for forks and unrated games.

- **Accept** if it passes the gate, or if the overall is at least 0.25 above the old one with no new cap. Then:
  - `npm run evaluator -- submit <id> --model claude-code` (queued if the API is down; `submit --pending` later);
  - `node scripts/commit-game.mjs <id> "Improve <Name>: <what changed>"`;
  - commit `package-lock.json` too if a fork changed it.
- **Second round** if it improved but still fails the gate: write a new brief from the new review, and run steps 3–5 once more.
- **Revert** otherwise:
  - `git checkout -- games/<id>`, or for a fork, delete `games/<id>-v2` and `git checkout -- games/<id> package-lock.json`;
  - record the attempt and its result in the brief.

A game that fails the gate after two rounds goes to the Archive (status `retired`), with the reason in `docs/CATALOGUE.md`.

## Report

A table: game, old overall, new overall, gate, decision (accepted / reverted / archived), what changed. Any new lesson that applies to more than one game goes into `docs/DESIGN-RULES.md`.
