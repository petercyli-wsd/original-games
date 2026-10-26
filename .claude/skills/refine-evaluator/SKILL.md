---
name: refine-evaluator
description: Improve the Originals AI evaluator's prompt from the team's written reviews, then backtest the candidate against held-out reviews and benchmark games before anyone promotes it. Use for "refine the evaluator", "train the reviewer", or after the team has added a batch of reviews.
---

# Refine the evaluator's prompt from team reviews

This is a small, honest training loop: learn from **train** games, measure on **holdout** games the refiner never saw, and only promote if the holdout agreement improves without breaking the benchmarks (the core classics must score 4+, the classics must average 3.8+, and games the team rated low must score low). The team score is weighted: Pierre's reviews count 3×.

Requested: $ARGUMENTS

Follow the subagent isolation rules in `.claude/skills/review-game/SKILL.md`; you'll use its procedure for every review below.

1. **Refine prompt.** `npm run evaluator -- refine-prompt`.
   - If it says the team hasn't reviewed enough games, stop and tell the user how many more are needed.
   - If it lists train games to review first, review them with the `review-game` procedure (no flags), then run `refine-prompt` again.

2. **Proposal (subagent).** Launch a fresh general-purpose subagent:
   > Read `.evaluator/_refine/refine.md` and follow it: the SYSTEM section is your instructions, the USER section is the evidence. Write your proposal as a single JSON object matching `.evaluator/_refine/proposal.schema.json` to `.evaluator/_refine/proposal.json` using the Write tool. Don't open any other file. Reply "done" when written.

3. **Candidate.** `npm run evaluator -- submit-version`. Note the new version number N.

4. **Backtest.** `npm run evaluator -- calibration --version N`. It lists the games to review under the candidate (the team-reviewed games plus the core classics), and under the active version if any are missing. Review each list with the full `review-game` procedure (blind player and designer), passing `--version <that version> --pool train` to `player-prompt`, `judge-prompt` and `submit`. Run up to 5 in parallel.

5. **Score.** `npm run evaluator -- score N`. It prints, for the active and the candidate version, holdout agreement (Spearman ρ and average gap in stars), the same on all reviewed games, and benchmark passes.

6. **Recommend, don't promote.** Show the user both rows and the proposal's changelog, and recommend:
   - **Promote** if holdout ρ is higher (or equal with a smaller gap) and all benchmarks pass.
   - **Don't promote** if holdout agreement got worse or a benchmark fails, and say why.
   - With fewer than 3 holdout games, say the result is not yet meaningful and suggest more team reviews.

   Only run `npm run evaluator -- promote N` if the user explicitly agrees. They can also promote from the site's Evaluator page.
