---
name: review-slot
description: AI-review one or more original slot games (collection 'slots') with the slot evaluator - a rules card, a panel of blind players and a designer, each an isolated Opus subagent - and write the result to games/<id>/src/slot-review.json. Use when asked to review, score or gate a slot (e.g. "/review-slot midnight-zone").
---

# Review slots with the slot evaluator

Arguments: one or more slot game ids from `games/` (e.g. `midnight-zone kiln`). If none were given, run `npm run slots:review -- todo` and ask which to review.

Requested: $ARGUMENTS

Read `docs/SLOT-EVALUATOR.md` once if you haven't: it explains the scores, the caps and the gate. The contract is `docs/SLOTS.md` §3 and §5.

The slot review is **local and file-based**. There is no API and nothing to submit: `score` writes `games/<id>/src/slot-review.json`, which is committed with the game, and the site shows it on the game page. The CLI (`npm run slots:review -- …`) does all the plumbing. You run three kinds of judgement step, each in a **fresh `opus` subagent** that sees only what its step allows:

- **Rules card** (reads the spec, config and source): a factual card about the slot. Facts only.
- **Blind players** (screenshots only): each plays a whole session under an alias. That means 60+ spins, Turbo, Autoplay, one forced feature and the paytable. Each scores theme, readability, feature clarity, excitement and fun, and answers factual checks. A player never sees the id, the name, the source, the card, docs or reviews. This is the step that matters most: an AI that reads the code rates a game far clearer than a player does.
- **Designer** (card + measured facts + the panel's answers + screenshots + the slot catalogue): scores creativity, maths fit, uniqueness and polish. It grades whether each player understood the slot, names trademark uses, and names a reskin.

Code computes the overall, the caps and the gate. Never edit a score, a JSON file a subagent wrote, or `slot-review.json` yourself.

## Before you start

- The game must have `slot.spec.json`, `slot.config.json`, `oracle.json` (`npm run slots:oracle -- <id>`) and `slot-facts.json` (`npm run slots:eval -- <id>`), all current. `prepare` warns about anything missing, and the gate fails without them.
- **Set the manifest `revision` before the first `prepare`.** The review is tied to a hash of `games/<id>/src` (everything except `slot-review.json` and `slot-facts.json`). Any later change to a file in it, the manifest included, makes the review stale.

## For each game

Games can run in parallel: one subagent per game per step, at most 4 subagents at once.

1. **Prepare.** `npm run slots:review -- prepare <id>`. It writes `.evaluator/slots/<id>/evidence.json` and either keeps the cached rules card (the code is unchanged: skip step 2) or writes `.evaluator/slots/<id>/card.md`. Note its warnings: a missing facts field or a missing oracle is a build problem to fix first, not something to review around.

2. **Rules card** (subagent, `model: opus`). Give it exactly this task:
   > Read `.evaluator/slots/<id>/card.md` and follow it: the SYSTEM section is your instructions, the USER section holds the slot's manifest, spec, config and source. Write the rules card as a single JSON object matching `.evaluator/slots/<id>/card.schema.json` to `.evaluator/slots/<id>/card.json` using the Write tool. Don't open any other file. Reply "done" when the file is written.

3. **Blind player** (subagent, `model: opus`). Run `npm run slots:review -- player-prompt <id>` yourself. It prints an alias (e.g. `s-3fa9c1`). Never put the game's id or name in the subagent's task. Launch a fresh subagent with exactly this task, filling in the alias:
   > Read `.evaluator/slots/_blind/<alias>/player.md` and follow it: the SYSTEM section is your instructions, the USER section tells you how to play. The only command you may run is `npm run slots:review -- play <alias> "<steps>"` (from the repo root), and the only files you may open are that file, the screenshots and contact sheets the command prints, and `.evaluator/slots/_blind/<alias>/player.schema.json`. Do not list directories or open any other file. Play the whole session the instructions ask for (60+ spins, Turbo, Autoplay, the feature, the paytable) before you write. Write your review as a single JSON object matching the schema to `.evaluator/slots/_blind/<alias>/player.json` using the Write tool. Reply "done" when the file is written.

   If the player reports "the sandbox could not be set up" or "the play tool failed" twice, stop and report it. `.evaluator/slots/<id>/play-errors.log` has the details, and the player must not see them.

4. **Designer prompt.** `npm run slots:review -- judge-prompt <id>`. Run it only after every player has written `player.json`. It merges the panel (the median per score) and prints each player's session shortfalls from the play log (fewer than 60 spins, no Turbo, no Autoplay, no feature, no paytable). **If a player fell short, discard that player:** run `player-prompt <id>` again (a new panel, without `--more`) and repeat step 3. An under-tested player isn't a review.

5. **Designer** (new subagent, `model: opus`). Give it exactly this task:
   > Read `.evaluator/slots/<id>/judge.md` and follow it: the SYSTEM section is your instructions, the USER section is the slot to evaluate. You may open the screenshots it lists. Write your evaluation as a single JSON object matching `.evaluator/slots/<id>/review.schema.json` to `.evaluator/slots/<id>/review.json` using the Write tool. Do not open any other file, and in particular not the game's source code. Reply "done" when the file is written.

6. **Score.** `npm run slots:review -- score <id>`. It prints PASS or FAIL, the scores, the caps that applied and the gate reasons, and writes `games/<id>/src/slot-review.json`. Use `--dry-run` to see the result without writing the file.
   - **Panel.** If the overall is 3.25–3.75 (inclusive) with fewer than 3 players, the gate fails with "panel needed". Run `npm run slots:review -- player-prompt <id> --players 2 --more`, run the two new blind players (step 3), then steps 4–6 again with a fresh designer.
   - **A validation error** (a missing score, a bad grade) names the file. Give the error and the file to a fresh subagent of the same kind and ask it to fix only the JSON. Don't edit it yourself.

Every `player-prompt` makes fresh aliases, so a stale play is never reused. After a repair to the game, run `prepare` again (a new card) and start a new panel (no `--more`). `player-prompt --more` refuses a panel that played older code.

## What the gate checks (code, `docs/SLOTS.md` §5)

- overall ≥ 3.5;
- readability ≥ 3 and feature clarity ≥ 3;
- the oracle is present, and the RTP is 95.5–96.5%;
- the hit rate is in its §3 band, the dry-streak p95 is within the declared volatility's limit (low 12, medium 20, high 26, extreme 32), and the max win is reachable (P > 1 in 10⁹);
- not a reskin (code finds catalogue slots with the same law, modifiers and volatility band, and the designer can name one);
- no trademarked mechanic name ("Megaways", "Hold & Win", "Cash Collect"), from a code scan or the designer;
- the panel is complete when the overall is near the gate, and every player played the full session (by the play log).

## Report

Finish with a short table: game, overall, PASS/FAIL, the five player scores, the four designer scores, and the first gate reason or the designer's verdict. Say that `slot-review.json` is written and must be committed with the game (`node scripts/commit-game.mjs <id> "…"`).
