---
name: review-game
description: AI-review one or more Originals games against the team's evaluator rubric, on the Claude Code subscription, and store the result on the site. Use when asked to review, score or evaluate specific games (e.g. "/review-game drift slice").
---

# Review games with the Originals evaluator

Arguments: one or more game ids from `games/` (e.g. `drift slice`), or `anchor-*` ids during a backtest. Optional flags to pass through to every CLI call: `--version N` and `--pool train` (only when a backtest asks for them). If no ids were given, run `npm run evaluator -- todo` and ask which games to review.

Requested: $ARGUMENTS

The CLI (`npm run evaluator -- …`) does all the plumbing: building prompts from the active prompt version, team reviews and measured facts, then validating and storing results. You do the two judgement steps, each in a **separate subagent** that sees only its prompt file. That isolation is deliberate: the judge must score from the rules card and the facts, never from the code or from this conversation.

## Setup check

The CLI needs `ORIGINALS_API_URL` and `ORIGINALS_ADMIN_KEY` in `.env.local` at the repo root. If a command fails because one is missing or the key is wrong, stop and tell the user what to add. Never print the admin key.

## For each game

Run games one at a time, or several in parallel (one subagent per game per step).

1. **Prepare.** `npm run evaluator -- prepare <id>`. It builds the game's evidence and either restores a cached rules card (skip step 2) or writes `.evaluator/<id>/extract.md`.

2. **Rules card (subagent).** Launch a general-purpose subagent with exactly this task, filling in the id:
   > Read `.evaluator/<id>/extract.md` and follow it: the SYSTEM section is your instructions, the USER section holds the game's manifest and source. Write the rules card as a single JSON object matching `.evaluator/<id>/card.schema.json` to `.evaluator/<id>/card.json` using the Write tool. Don't open any other file. Reply "done" when the file is written.

3. **Judge prompt.** `npm run evaluator -- judge-prompt <id> [--version N] [--pool train]`. It writes `.evaluator/<id>/judge.md`.

4. **Judge (new subagent).** Launch a fresh general-purpose subagent with exactly this task:
   > Read `.evaluator/<id>/judge.md` and follow it: the SYSTEM section is your instructions, the USER section is the game to evaluate. Write your evaluation as a single JSON object matching `.evaluator/<id>/review.schema.json` to `.evaluator/<id>/review.json` using the Write tool. Do not open any other file, and in particular not the game's source code. Reply "done" when the file is written.

5. **Submit.** `npm run evaluator -- submit <id> --model "claude-code"`. If it reports a validation error, give the judge subagent's output back to a new judge subagent with the error and ask it to fix the JSON, then submit again. Don't edit scores yourself.

## Report

Finish with a short table: game, overall score (1–5), recommendation, and the one-line verdict from each submit. Mention that results are live on the game pages and on the site's Evaluator page.
