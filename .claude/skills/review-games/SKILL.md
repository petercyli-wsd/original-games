---
name: review-games
description: Batch AI-review every Originals game that needs it (never reviewed, or code changed since its last review) on the Claude Code subscription, in parallel. Use for "review all games", "review what's new", or after many games changed.
---

# Batch-review games with the Originals evaluator

Arguments: `all` to re-review every game, otherwise only games that need it. Requested: $ARGUMENTS

This runs the same procedure as the `review-game` skill (read `.claude/skills/review-game/SKILL.md` first and follow its rules, especially the subagent isolation), but stage by stage across many games.

1. **What to review.** `npm run evaluator -- todo` (add `--all` if the user asked for all). If the list is empty, say so and stop. If it is longer than about 20 games, tell the user the count and that each game takes two subagent runs on their subscription's usage, and confirm before continuing.

2. **Prepare all.** `npm run evaluator -- prepare <every id>` (one command, many ids).

3. **Rules cards.** For every game whose prepare line says it needs a rules card, launch the step 2 subagent from `review-game`, up to 5 at a time in parallel. Wait for each batch to finish.

4. **Judge prompts.** `npm run evaluator -- judge-prompt <every id>`.

5. **Judging.** Launch the step 4 judge subagent from `review-game` for every game, up to 5 at a time in parallel, each a fresh subagent.

6. **Submit.** `npm run evaluator -- submit <every id> --model "claude-code"`. Retry any validation failures as `review-game` describes.

7. **Report.** A table of every game sorted by overall score (highest first) with recommendation and verdict, plus any failures. Point out games flagged as a likely reskin (`duplicate_of`) or failing measured checks.

If the session is interrupted, running this skill again picks up where it stopped: submitted games no longer appear in `todo`.
