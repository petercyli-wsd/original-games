---
name: search-slots
description: One cycle of the long-running, unattended search for strong original slots - a small batch of new concepts from the engine pack's verified scope, tuned, built, reviewed by the slot evaluator, kept only if they pass its gate, and logged for the team to rate. Built to run for days under `/loop /search-slots`.
---

# Search for strong original slots (one cycle)

Each run of this skill is **one cycle**. All state lives in files, so a cycle can start in a fresh or compacted session. Requested: $ARGUMENTS (optional: `cycles-per-day=N`, default 2; `builds=N` per cycle, default 2, at most 4).

**What this loop can and can't tell.** The slot evaluator has no team calibration yet (`docs/SLOT-EVALUATOR.md`). Its gate filters out slots that are unreadable, mis-tuned, reskinned or dull to a blind panel. It can't yet rank the slots that pass. So the loop's job is to **keep only slots that pass, and hand them to the team to rate.** Don't spend cycles pushing an AI score past the gate.

## Hard rules

- **Stay on the session's branch.** Never commit to `main` directly, never force-push, and don't push unless Peter has authorised pushing for this loop. There is no deploy step for slots: Peter merges.
- **Stay in your lane.** You may write only:
  - new `games/<id>` slot folders;
  - `package-lock.json`;
  - `docs/slot-batches/`;
  - appended sections in `docs/SLOT-CATALOGUE.md`;
  - files under `.evaluator/slots/`.

  Don't change `packages/`, `apps/`, `scripts/`, an existing game, or a doc's rules. A kept slot is improved only by a later cycle building a new id.
- **No production API writes.** The slot review is file-based (`games/<id>/src/slot-review.json`).
- **Models.** Set `model` on every Agent call:

  | Role | Model |
  |---|---|
  | Concepts, screen | `opus` |
  | Maths, build, repair | `sonnet` |
  | Rules card, blind players, designer | `opus` |

  The evaluator's model is fixed: don't change it without an A/B (`docs/SLOT-EVALUATOR.md`).
- **At most 4 subagents at once.** The org's monthly spend limit has been hit before. If a subagent fails with a rate-limit error, stop the cycle, log it, and resume after the reset (SendMessage to the stopped subagent, or rerun the cycle).

## 1. Start the cycle

1. `git status`. If the tree has uncommitted changes from an earlier cycle, finish recording them (step 6) or log them and stop.
2. Read `.evaluator/slots/_search/ledger.md`. If it's missing, create it with a one-line header. Count the cycles started in the last 24 hours. If that has reached cycles-per-day, write nothing and end the cycle; under `/loop`, wake in an hour.
3. Check the stop conditions (section 7).
4. Run `npm run slots:review -- todo`. A kept slot listed as stale had its code changed outside the loop: note it in the ledger, and don't review it again yourself.

## 2. Choose the source

Choose by the ledger's cycle number, modulo 4:

- **0, a gap in the roster.** An evaluation law, board law or volatility band that no slot in `docs/SLOT-CATALOGUE.md` uses yet.
- **1, a market favourite done our way.** A mechanic family players love, under a theme whose action it is. The list is in "What makes these fun" in `docs/slot-batches/batch-1-concepts.md`: pay-anywhere tumbles with multiplier orbs, coin respins, variable rows, cluster cascades, sticky respins, mystery reveals, wild multipliers.
- **2, a sibling of the best slot.** Start from the slot the team rates highest, or, with no team ratings yet, the best kept slot by AI fun. Give it a different mechanism or volatility, not a re-skin.
- **3, open.**

## 3. Concepts and screen

1. **Concepts** (`opus`, fresh): the step 2 task in `.claude/skills/generate-slots/SKILL.md`. Ask for 6 concepts from the chosen source.
   - It must also read `.evaluator/slots/_search/concepts-seen.md` and propose nothing already there.
   - It writes to `docs/slot-batches/search-<n>-concepts.md`.
2. **Screen** (`opus`, a different fresh subagent): the step 3 task in that skill. It writes `docs/slot-batches/search-<n>-screen.md`.
3. Append every concept to `.evaluator/slots/_search/concepts-seen.md`, one line each: name, the signature, the hook, and the verdict with the failed check.

## 4. Build

For the top `builds` concepts that passed the screen, follow `.claude/skills/generate-slots/SKILL.md` steps 4–6: maths (`sonnet`), build (`sonnet`) and your checks. A slot whose maths or build fails its own checks after one fix attempt is dropped. Then run `npm install --package-lock-only --ignore-scripts`.

## 5. Review, gate and repair

Review each build with `.claude/skills/review-slot/SKILL.md`, keeping its isolation rules exactly. **Set the manifest `revision` before the first `prepare`:** `{ kind: 'new', date, note: 'Sonnet-generated, not yet rated by the team. <hook>' }`.

Keep a slot if `npm run slots:review -- score <id>` prints PASS. If it fails on something fixable, repair it once (generate-slots step 8) and review it again from scratch. One repair round per cycle, not two: the loop favours breadth. If it still fails, drop it.

Don't overrule the gate or a failed check.

## 6. Record

For each kept slot:
1. Confirm `npm run slots:review -- todo` doesn't list it, so its `slot-review.json` matches its code.
2. Commit it on its own: `node scripts/commit-game.mjs <id> "Add <Name>: <hook>"`, ending with the attribution line from the session's instructions.
3. Add its row to the Roster in `docs/SLOT-CATALOGUE.md`.

For each dropped slot, delete `games/<id>`, run `npm install --package-lock-only --ignore-scripts`, and add its line under "Dropped".

Then:
- **Batch section.** Add the cycle's section to `docs/SLOT-CATALOGUE.md`: concept cards of the kept slots, and the results table.
- **Patterns.** If a failure reason appears three or more times in the ledger, add a rule under "Patterns" citing the slots.
- **Commit** `package-lock.json`, `docs/SLOT-CATALOGUE.md` and `docs/slot-batches/search-<n>-*`.
- **Ledger.** Append the cycle's line to `.evaluator/slots/_search/ledger.md`:
  - the cycle number, date and time, and source;
  - concepts proposed, passed the screen, built and kept;
  - each drop, with its reason;
  - the subagent count.

## 7. Stop conditions

Check these at the start of each cycle. If any holds, write the reason at the top of the "Batches" section of `docs/SLOT-CATALOGUE.md`, commit, and stop the loop (`ScheduleWakeup` with `stop: true`):

- **The gate is misleading.** The team has rated 3 or more kept slots, and their mean is below 3. The evaluator needs calibrating before more building (`docs/SLOT-EVALUATOR.md`, "Calibrating").
- **Stalled.** 3 cycles in a row kept nothing.
- **Scope exhausted.** 2 cycles in a row had fewer than 2 concepts pass the screen. The verified scope near the roster is used up, so stop and report which modifier ports or pack contexts would open it.
- **Backlog full.** 8 or more kept slots haven't been rated by the team. They can't rate faster than that, so wait.
- **Broken twice.** The build or the tests broke in two cycles. Run `npm run typecheck` and `npm test` before every commit.
- **Same failure three times.** The same gate reason dropped slots in 3 cycles in a row (for example "feature clarity 2 < 3"). The fix lies in the kit or the contract, not in more concepts.

## Brief Peter (end of every cycle that did work)

Write in plain language, short, for Peter. Include:
- **The concepts.** Every concept proposed this cycle, one line each: name, hook, signature, and whether it passed the screen or why not.
- **What was built.** Each kept slot with its AI overall, the five player scores, a line on what it is like to play, and the designer's main con. Each drop with its reason.
- **Where it is.** The commits on the branch; anything left uncommitted and why.
- **Counts and the next wake-up.** Proposed, passed the screen, built, kept; how many kept slots the team hasn't rated yet.

A tick that is skipped because the cycle cap is reached needs one line only.
