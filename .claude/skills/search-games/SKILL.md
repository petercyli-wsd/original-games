---
name: search-games
description: One cycle of the long-running, unattended search for strong Originals - fixes for games the team commented on, or a batch of new concepts - built by cheaper models, reviewed by the calibrated evaluator, kept only if they pass the gate and the team-derived checks, and logged for the team to rate. Built to run for days under `/loop /search-games`.
---

# Search for strong Originals (one cycle)

Each run of this skill is **one cycle**. All state lives in files, so a cycle can start in a fresh or compacted session. Requested: $ARGUMENTS (optional: `cycles-per-day=N`, default 4; `builds=N` per batch, default 3).

What this loop can and can't tell: the AI gate is a good filter (games the team rated 2 all score ≤ 2.5 or get capped), but it can't rank among games that pass: 20 games sit at exactly 3.75, and the team rates those anywhere from 2.5 to 4.5. So the loop's job is to **keep only games that pass, and hand them to the team to rank**. Don't spend cycles pushing an AI score past the gate.

## Hard rules

- **Work on `search`; deploy by fast-forward.** Never commit directly to `main`, never force-push. Push `search` at the end of each cycle, then (section 5, "Publish") fast-forward `main` to it so kept games go live. Peter authorised that on 2026-11-12. If `main` can't be fast-forwarded, don't push it: say so in the brief.
- **Production writes: only the two in section 5 ("Publish").** The only API write is `submit <kept ids>` for the games kept this cycle, with `.evaluator/_local` moved aside for that one call and put back straight after. Everything else stays in local mode (prompts built from this checkout, `submit` queues to `.evaluator/_pending.json`). Never run `submit --pending`, `promote`, `seed-version`, `submit-version`, `refine`, or any other POST/PUT. Reading the API is fine.
- **Stay in your lane.** A UI restyle runs in parallel on another branch, and it owns every existing `games/<id>` folder, `packages/`, `apps/` and `scripts/`. You may only write:
  - new `games/<id>` folders;
  - `package-lock.json`;
  - `docs/SEARCH.md`;
  - appended sections in `docs/CATALOGUE.md` and `docs/DESIGN-RULES.md`;
  - files under `.evaluator/`.

  You improve an existing game only through a fork (`node scripts/fork-game.mjs <id> --keep`), which leaves the original untouched.
- **Models.** Set `model` on every Agent call:

  | Role | Model | Why |
  |---|---|---|
  | Concepts, screen, fix-check | `opus` | Few calls, and quality decides everything downstream |
  | Build, repair | `sonnet` | Most of the tokens; the checks catch its mistakes |
  | Rules card, blind player, designer | `opus` | The evaluator is calibrated on this model. Don't change it without an A/B |

- **At most 4 subagents at once.**
- **Follow `docs/STYLE.md`.** Every build and repair must follow it. Until it reaches `main`, read it with `git show origin/restyle:docs/STYLE.md`, and give it to each build subagent. Keep §6: the whole-bet chance picture stays.

## 1. Start the cycle

1. Switch to `search`: `git switch search`, or `git switch -c search` from `main` if it doesn't exist yet. Then `git fetch origin` and `git merge origin/main --no-edit`.
   - If the only conflict is `package-lock.json`, take `origin/main`'s copy and run `npm install --package-lock-only --ignore-scripts`.
   - For any other conflict, run `git merge --abort` and note it in the ledger.
   - If `package-lock.json` changed, run `npm install --ignore-scripts`.
2. Make sure `.evaluator/_local` exists (create an empty file if not).
3. Read `.evaluator/_search/ledger.md`. Create it with a one-line header if it's missing.
   - Count the cycles started in the last 24 hours. If that has reached cycles-per-day, write nothing and end the cycle; under `/loop`, wake in an hour.
4. Check the stop conditions (section 6).
5. Run `node .claude/skills/search-games/team-feed.mjs` for new team reviews since the last cycle.
6. Check the last deploy: `gh run list --branch main --limit 1`. If that CI run failed, don't fast-forward `main` this cycle (section 5, "Publish"), and say so in the brief.

## 2. Pick the work

Take the first that applies:

- **A. Fix from team feedback.** Use this for a new comment that names a concrete, fixable problem, when the game's team average is ≥ 3 and it has no fork yet. Handle at most 2 per cycle. Examples:
  - Crocodile Dentist: "the house component isn't necessary";
  - Cross: "not immediately clear that 'last card' was the one that passed… it all happens so quickly";
  - Derby: switching runners midway is confusing;
  - Drift: "for the longer tracks it can just go on forever even with turbo".

  Comments on games already in the Archive don't count.
- **B. New batch** otherwise.

## 3A. Fork and fix

1. Run `node scripts/fork-game.mjs <id> --keep`. That creates `<id>-v2`, or the next free `-vN`.
2. Run `npm install --package-lock-only --ignore-scripts`.
3. Repair subagent (`sonnet`): the build instructions from 3B step 4, applied to `games/<new-id>`, plus:
   > The team's comments, verbatim: <comments>. Fix exactly what they complain about and change nothing else.
4. Review and gate it (step 4).
5. Fix-check subagent (`opus`), fresh. Give it only the comments and the paths of the new game's screenshots from `node scripts/play.mjs` (it never sees the code):
   > Does this version fix each complaint? Answer yes or no for each, with one line of evidence from the screenshots.

   Keep the fork only if it passes the gate and the fix-check says yes to every complaint.

## 3B. New batch

1. **Source.** Choose by the ledger's cycle number, modulo 4:
   - 0: a maths family not yet used in `docs/CATALOGUE.md` ("The maths in one page" and the roster);
   - 1: a familiar casino or crash-market format with a new visible decision;
   - 2: a sibling of a team favourite (team average ≥ 4, from `team-feed.mjs --ratings`). It needs a different board or a different decision, not just a re-skin. Peter asked for a Slice where the player chooses the slice;
   - 3: open.
2. **Concepts** (`opus`, fresh): the step-2 task in `.claude/skills/generate-games/SKILL.md`, asking for 8 concepts from the chosen source.
   - It must also read `.evaluator/_search/concepts-seen.md` and propose nothing already there.
   - It writes to `.evaluator/_search/cycle-<n>/concepts.md`.
3. **Screen** (`opus`, a different fresh subagent): the step-3 task in that skill, plus the team-derived checks below. It writes `.evaluator/_search/cycle-<n>/screen.md`.
   - Append every concept to `concepts-seen.md` as one line: name, one-sentence rule, verdict, and the failed check.
4. **Build** the top `builds` concepts that passed, one `sonnet` subagent each:
   - the step-4 task in that skill;
   - plus "Meet every team-derived check below and report the `p99 steps` column from `npm run eval -- --game <id>`";
   - plus "Follow `docs/STYLE.md`" if it exists.

   A build that fails its own checks after one fix attempt is dropped.
5. Run `npm install --package-lock-only --ignore-scripts`.

## Team-derived checks

These come from the team's reviews of earlier builds. They are pre-build checks, not evaluator changes:

- **Rounds end.** `p99 steps` ≤ 30 in every config of `npm run eval -- --game <id>`.
  - The team's 4-rated games are all ≤ 24.
  - Drift reaches 960 and drew "it can just go on forever".
- **Each event can be followed.**
  - In Manual, every draw is animated slowly enough to follow.
  - The last result stays marked on the board until the next one.
  - Cross drew "it all happens so quickly hard to track".
- **Nothing removable.** If an element or mode could be taken out without changing the game, take it out. Crocodile Dentist drew "the house component isn't necessary".
- **One decision type.** No mid-round switching or second kind of bet unless it *is* the game's one decision. Derby drew "how u can just switch runners midway [is] confusing".

## 4. Review and gate

Review each build with `.claude/skills/review-game/SKILL.md`, keeping its isolation rules exactly. The blind player never learns the id or name.

This one review does two jobs: it decides keep or drop now, and it is the review that gets published for a kept game (section 5, "Publish"). It is never run twice for the same code.

**Set the manifest `revision` before the first `prepare`** (`{ kind: 'new', date, note: 'Sonnet-generated, not yet rated by the team. <one sentence>' }`; a fork is `improved` and its note names the complaint it fixes). A review is stored with the game's code hash, and the site flags it stale if the code changes afterwards, so any later edit to `games/<id>` (a repair, a label tweak) means the review must be redone.

1. Run one blind player, then `npm run evaluator -- preview <id>`.
2. If the overall is in 3.25–3.75, widen to a panel: `player-prompt <id> --players 2 --more`, run the two new blind players, redo the designer, and preview again. Scores of exactly 3.75 have been widened too.
3. For a game you keep, `submit <id> --model claude-code` (local mode, so it queues).

Keep a game if `preview` passes the gate **and** it meets the team-derived checks.

- If it fails on something fixable, give its review's cons and confusions to one repair subagent (`sonnet`), then review it again.
- If it still fails, delete `games/<id>`, run `npm install --package-lock-only --ignore-scripts`, and log the reason.

Don't overrule the gate or a failed check.

## 5. Record

For each kept game:

1. Confirm the manifest `revision` is set (it must have been set before the review, section 4).
2. Queue its review: `npm run evaluator -- submit <id> --model claude-code` (local mode, so it queues).
3. Commit it: `node scripts/commit-game.mjs <id> "Add <Name>: <one-line rule>"`, or `"Fork <Name>: fixes <complaint>"`. End every commit message with the attribution line from the session's instructions.

Then:

- Commit `package-lock.json`.
- **`docs/SEARCH.md`** (create it with a short intro if missing). Add a row per kept game to its table, newest first:
  - date, id, name, one-sentence rule;
  - AI overall, the three clarity facets, fun and uniqueness;
  - `p99 steps`;
  - closest game → difference;
  - one thing the team should judge ("does choosing the slice make it more fun than Slice?").

  Commit it.
- **Ledger** (`.evaluator/_search/ledger.md`): append the cycle's line:
  - n, date and time, mode, source;
  - concepts proposed, passed the screen, built, kept;
  - each drop with its reason.
- **Patterns.** If the ledger shows the same failure reason three or more times, append a rule to `docs/DESIGN-RULES.md` citing the games, and commit it.
- **Push:** `git push origin search`.
- **Publish** (only if at least one game was kept this cycle; make sure no subagent is running):
  1. **Deploy.** `git fetch origin`. If `origin/main` is an ancestor of `search` and the last CI run on `main` didn't fail (section 1, step 6), run `git push origin search:main`. Render builds from `main`, so the kept games then go live. Never force-push. If it isn't a fast-forward, don't push; say so in the brief.
  2. **Publish the reviews.** For the ids kept this cycle only, run this as one command so `.evaluator/_local` always goes back:
     `mv .evaluator/_local .evaluator/_local.off; npm run evaluator -- submit <kept ids> --model claude-code; mv .evaluator/_local.off .evaluator/_local`
     Each id should print `✓ <id>: <score>/5`. If it prints `Queued` instead, the API was unreachable: the reviews stay in `.evaluator/_pending.json`, so say so in the brief. Never pass `--pending`, and check `.evaluator/_local` exists again afterwards.

## 6. Stop conditions

Check these at the start of each cycle. If any holds, write the reason at the top of `docs/SEARCH.md`, commit, push, and stop the loop (`ScheduleWakeup` with `stop: true`):

- **The gate is misleading.** The team has rated 3 or more games from `docs/SEARCH.md`, and their mean is < 3. The evaluator needs `/refine-evaluator` before more building.
- **Stalled.** 3 cycles in a row kept nothing.
- **Backlog full.** 12 or more kept games in `docs/SEARCH.md` haven't been rated by the team yet. They can't review faster than that, so wait.
- **Broken twice.** The build or the tests broke on `search` in two cycles (run `npm run typecheck` and `npm test` before pushing).

## Brief Peter (end of every cycle that did work)

Plain language, short, written for Peter. Include:

- **The concepts.** Every concept proposed this cycle, one line each: name, the rule in plain words, and whether it passed the screen or why it failed.
- **What was built.** Each kept game with its AI overall, a line on what it is like to play, and any weakness the designer flagged. Each drop with its reason.
- **Where it is.** Pushed to `search`; deployed to `main` or why not; AI review published or still queued; the last CI result.
- **Counts and the next wake-up.** Proposed, passed the screen, built, kept; how many kept games the team hasn't rated yet.

A tick that is skipped because the cycle cap is reached needs one line only.
