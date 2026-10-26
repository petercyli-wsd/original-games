---
name: review-game
description: AI-review one or more Originals games against the team's evaluator rubric, on the Claude Code subscription, and store the result on the site. Use when asked to review, score or evaluate specific games (e.g. "/review-game drift slice").
---

# Review games with the Originals evaluator

Arguments: one or more game ids from `games/` (e.g. `drift slice`). Optional flags to pass through to every CLI call: `--version N` and `--pool train` (only when a backtest asks for them). If no ids were given, run `npm run evaluator -- todo` and ask which games to review.

Requested: $ARGUMENTS

The CLI (`npm run evaluator -- …`) does all the plumbing: building prompts from the active prompt version, team reviews and measured facts, then validating and storing results. You do three judgement steps, each in a **separate subagent** that sees only what that step allows:

- **Rules card** (reads the source): a factual card about the game.
- **Blind player** (UI only): plays the game in a sandbox with explanatory prose hidden, and scores what a real player can tell from one play: win condition, simplicity, odds, fun. It never sees the source, the rules card, docs or descriptions. This is the most important step: the team's reviews showed that an AI reading code rates games far clearer than people do.
- **Designer** (rules card + measured facts + what the player understood): scores uniqueness, volatility, checkpoints, pace and geometry, and grades whether the blind player understood the game correctly. A misread caps the player's clarity scores.

## Setup check

The CLI needs `ORIGINALS_API_URL` and `ORIGINALS_ADMIN_KEY` in `.env.local` at the repo root. If a command fails because one is missing or the key is wrong, stop and tell the user what to add. Never print the admin key.

## For each game

Run games one at a time, or several in parallel (one subagent per game per step).

1. **Prepare.** `npm run evaluator -- prepare <id>`. It builds the game's evidence and either restores a cached rules card (skip step 2) or writes `.evaluator/<id>/extract.md`.

2. **Rules card (subagent).** Launch a general-purpose subagent with exactly this task, filling in the id:
   > Read `.evaluator/<id>/extract.md` and follow it: the SYSTEM section is your instructions, the USER section holds the game's manifest and source. Write the rules card as a single JSON object matching `.evaluator/<id>/card.schema.json` to `.evaluator/<id>/card.json` using the Write tool. Don't open any other file. Reply "done" when the file is written.

3. **Blind player (subagent).** `npm run evaluator -- player-prompt <id> [--version N] [--pool train]`, then launch a fresh general-purpose subagent with exactly this task:
   > Read `.evaluator/<id>/player.md` and follow it: the SYSTEM section is your instructions, the USER section tells you how to play. The only command you may run is `npm run evaluator -- play <id> "<steps>"` (from the repo root), and the only files you may open are that file, the screenshots the command prints, and `.evaluator/<id>/player.schema.json`. Never open the game's source, docs, rules card, evidence or any other review. Write your review as a single JSON object matching the schema to `.evaluator/<id>/player.json` using the Write tool. Reply "done" when the file is written.

4. **Designer prompt.** `npm run evaluator -- judge-prompt <id> [--version N] [--pool train]`. It picks up `player.json` and writes `.evaluator/<id>/judge.md`.

5. **Designer (new subagent).** Launch a fresh general-purpose subagent with exactly this task:
   > Read `.evaluator/<id>/judge.md` and follow it: the SYSTEM section is your instructions, the USER section is the game to evaluate. Write your evaluation as a single JSON object matching `.evaluator/<id>/review.schema.json` to `.evaluator/<id>/review.json` using the Write tool. Do not open any other file, and in particular not the game's source code. Reply "done" when the file is written.

6. **Submit.** `npm run evaluator -- submit <id> --model "claude-code"`. It sends both reviews; the API merges them, applies the comprehension, clarity and uniqueness caps, and computes the overall. If it reports a validation error, give the failing subagent's output back to a new subagent of the same kind with the error and ask it to fix the JSON, then submit again. Don't edit scores yourself.

Before re-reviewing a game, delete its old `player.json` (`.evaluator/<id>/player.json`), so a stale player review is never reused.

## Report

Finish with a short table: game, overall score (1–5), recommendation, and the one-line verdict from each submit. Mention that results are live on the game pages and on the site's Evaluator page.
