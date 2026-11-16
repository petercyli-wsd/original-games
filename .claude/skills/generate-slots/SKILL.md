---
name: generate-slots
description: Generate a batch of original slot games end to end - concepts chosen from the engine pack's verified scope, screened, tuned to exact RTP and the measured targets, built on the @originals/slots/ui kit, reviewed by the slot evaluator, repaired up to twice, and kept only if they pass its gate. Use for "make new slots", "a slot batch", or "design N slots".
---

# Generate a batch of original slots

Arguments: how many slots to aim for (default 3), plus any theme, mechanism or volatility to explore. Requested: $ARGUMENTS

The loop is: brief → concepts → screen → maths → build → checks → review → repair (up to 2 rounds) → keep or drop → record. Every stage that judges runs in a **fresh subagent** that sees only what that stage allows, so no stage grades its own work. **Ask the user before building more than 6 slots,** or anything that fans out many Opus agents.

**Models.** Set `model` on every Agent call:

| Role | Model |
|---|---|
| Concepts, screen | `opus` |
| Maths, build, repair | `sonnet` |
| Rules card, blind players, designer | `opus` (as `/review-slot` says) |

Run at most 4 subagents at once.

## 1. Brief (you)

Read these, and pass the relevant parts on in the subagent tasks:

- **`docs/SLOTS.md`:** the maths contract (§2), the measured targets (§3), the theme and UI rules (§4, including **no trademarked mechanic names**), and the review (§5).
- **`docs/SLOT-STYLE.md`,** if it exists: the look.
- **`docs/SLOT-CATALOGUE.md`:** the roster with each slot's signature, dropped concepts, and patterns. A new slot must not reskin a roster slot.
- **`docs/slot-batches/`:** earlier concepts and screens. Don't re-propose a concept; reuse what the screens learnt (the refused pairs, the hit rate needed for a dry-streak limit).
- **The engine pack's verified scope** (`/Users/petercyli-wsd/Dev/slot-math-engine-pack`; read its `AGENTS.md` ground rules). Run it from the pack folder with `PYTHONPATH=src .venv/bin/python -c "…"`:
  - `from enginepack import base; base.examples()` lists the 133 example games. Each has `panel`, `context` (evaluation law | board law, e.g. `ways|heights`), `families`, `tier` and `spec`; `base.example(name)` returns the spec.
  - `from enginepack import composability as c; c.pair(a, b)` checks two families. They are verified in a context only if `verified_cells` lists it. A non-empty `blocked` means blocked everywhere. Three or more families need every pair verified, and the exact set held by an example game: `c.verified_sets()`.
  - `c.partners(family, context)` lists a family's verified partners in a context. `c.families()` lists the 96 shipped families.
- **The TypeScript runtime's modifiers:** `ls packages/slots/src/engine/mechanics/`. A concept may use only modifiers the runtime has ported. Anything else needs a port first: say so and don't build it.
- **The runtime's feature law** (`packages/slots/src/engine/analytics/config.ts`): free spins on a second pack-verified spec, with awards per scatter count, retriggers and a multiplier schedule by spin index or retrigger count. Nothing else carries from one free spin to the next.

## 2. Concepts (subagent, `opus`)

> Read `docs/SLOTS.md`, `docs/SLOT-CATALOGUE.md` (the roster with its signatures, dropped concepts and patterns) and every file in `docs/slot-batches/`. Then propose <2 × target> new original video slots for an online casino: as creative as the best market slots, fun for a real player, and fair. <the theme, mechanism or volatility asked for, if any>
>
> The hard rules:
> - **The mechanism comes from verified scope.** Run the pack from `/Users/petercyli-wsd/Dev/slot-math-engine-pack` with `PYTHONPATH=src .venv/bin/python`. Choose the evaluation law and board law from `enginepack.base.examples()` (name the example the maths will start from), and 0–2 modifiers from `ls packages/slots/src/engine/mechanics/`. Check every modifier pair with `enginepack.composability.pair(a, b)` and quote its verified cell for your context. For a feature reel set that changes the modifiers, check that set too.
> - **The theme's promise decides the maths.** Say what the theme promises (big rare eruptions, steady small catches, a heist that builds), then the target volatility band (low / medium / high / extreme) and the measured targets that deliver it: hit rate, feature 1 in N, the feature's share of the RTP and its average win, and the max win. They must sit inside the `SLOTS.md` §3 bands. The dry-streak limit follows from the hit rate (p95 ≈ 15 at a 33% hit rate, 20 at 25%), so check the hit rate against the band's limit: low 12, medium 20, high 26, extreme 32.
> - **The mechanic is the theme's action.** The modifier and the feature should be what the theme does (the tide washes symbols down as tumbles), not generic free spins in costume.
> - **Not a reskin.** No two slots may share all of: evaluation law and board size, the modifier set (feature included), and the volatility band. That applies against the roster and within this batch.
> - **No trademarked mechanic names** anywhere: not "Megaways" (call the variable-rows board something of your own), not "Hold & Win", not "Cash Collect".
> - **It must explain itself in short lines.** The blind reviewer can't see any text of 9 or more words. Each paytable rule and feature card line must be under 9 words ("3 chests = 8 free spins"), and symbols must have distinct silhouettes readable at 48 px.
>
> For each concept, write a card in the format of `docs/slot-batches/batch-1-concepts.md`:
> - hook;
> - theme promise;
> - mechanism (evaluation, board law, modifiers, feature, pack evidence, "start the maths from");
> - grid;
> - symbols with art direction;
> - feature story;
> - target maths table;
> - palette and reel window;
> - why it's not a reskin (its signature against the closest roster slot).
>
> Add a "Wanted but refused" table for anything the pack refused. Write everything to `docs/slot-batches/batch-<n>-concepts.md` (n = the next free number). Reply "done".

## 3. Screen (new subagent, `opus`)

A different subagent screens, so the proposer never grades itself:

> Read `docs/SLOTS.md`, `docs/SLOT-CATALOGUE.md` and `docs/slot-batches/batch-<n>-concepts.md`. Be a strict, independent reviewer. Check each concept against the engine pack directly (`/Users/petercyli-wsd/Dev/slot-math-engine-pack`, `PYTHONPATH=src .venv/bin/python`), not against the concepts file's own evidence:
> - **Scope.** Change the named start example to the concept's geometry and mechanics, and build it with `enginepack.base.build`. A refusal fails the concept. Check every modifier pair with `composability.pair`.
> - **Runtime.** Every modifier is in `packages/slots/src/engine/mechanics/`, and the feature fits the free-spins law in `packages/slots/src/engine/analytics/config.ts`.
> - **Feasibility.** Can it reach RTP 95.5–96.5% and every §3 band at once? In particular, does the hit rate meet the dry-streak limit of its volatility (compute the exact p95 of the longest losing run in 100 spins), and do the feature's frequency and average win fit its share of the RTP?
> - **Theme–maths fit.** Do the volatility, feature and max win deliver what the theme promises?
> - **Fun.** Is there anticipation, escalation and variety, and is the feature a different place from the base game?
> - **Readability.** Can it be read at 420 px wide? Do its rules fit in lines under 9 words?
> - **Distinct.** Is it a reskin of the roster or of another concept? Use the same signature rule.
> - **Trademarks.** Does it use a trademarked mechanic name anywhere?
>
> For each concept, give pass or fail with a one-line reason per check, and the changes it needs before a build. Then rank the concepts that pass, best first, by how much a real slot player would enjoy them. Write the result to `docs/slot-batches/batch-<n>-screen.md`. Reply "done".

Take the top <target> concepts that passed. If fewer passed, build only those and say so. Don't overrule a failed check yourself.

## 4. Maths (one subagent per slot, `sonnet`)

> Make the maths for the slot below in `games/<id>/src/`, following `docs/SLOTS.md` §2–§3 exactly and the engine pack's `AGENTS.md` ground rules (build only through `enginepack`; never edit the pack; every RTP carries its tier).
> 1. Start from the pack example named in the card (`base.example(name)`). Change the geometry, symbols, strips, paylines, pays and mechanics to the card, and write `slot.spec.json` (game_spec_v2), plus a `feature.spec.json` for the free-spin reel set if there is one.
> 2. Write `slot.config.json`: the feature, `maxWinStakes`, the declared `volatility`, and `targetRtp` 0.96.
> 3. Tune strips and pays with `npm run slots:tune -- <id>` until the exact RTP is in 95.5–96.5% and every §3 band holds for the declared volatility. The dry-streak limits are low ≤ 12, medium ≤ 20, high ≤ 26 and extreme ≤ 32.
> 4. Run `npm run slots:oracle -- <id>` (the pack must accept the spec; a refusal is a failed build, never something to route around), then `npm run slots:eval -- <id>` to write `slot-facts.json`.
> 5. Reply with the slot-facts table, every measure against its band, and the oracle's context, families and RTP tier. Don't commit.
>
> <the concept card, with the screen's required changes>

A slot whose maths can't meet the bands after a fix attempt is dropped here. Log it in `docs/SLOT-CATALOGUE.md` under "Dropped".

## 5. Build (one subagent per slot, `sonnet`)

> Build the slot below in `games/<id>` on the slot kit `@originals/slots/ui` (`SlotGame`; its types are in `packages/slots/src/ui/types.ts`; `packages/slots/src/ui/demo/` is a working example). The maths in `games/<id>/src/` is final: don't change `slot.spec.json`, `slot.config.json`, `oracle.json` or `slot-facts.json`.
> - **Manifest.** Set `collection: 'slots'`, `mechanic: 'slots'`, `status: 'prototype'`, the declared volatility as a single entry, and `revision: { kind: 'new', date: '<today>', note: '<one-line hook>' }`.
> - **Symbols.** Original flat SVG art for every symbol, readable at 48 px, each with a distinct silhouette. No emoji, copied art or real brands. Premiums must look worth more than lows.
> - **Theme.** The palette and reel window from the card. The feature must visibly change the screen.
> - **Text.** Name the feature in the theme's language. Keep every rule, paytable line and card line **under 9 words**: a blind reviewer can't see longer text. Never use a trademarked mechanic name ("Megaways", "Hold & Win", "Cash Collect").
> - **Fairness** (SLOTS.md §2): draw after `await ticket.place()`, guard Spin against double presses, use no fake near-misses, and slow the reels only when the trigger can still complete.
> - **Tests.** Oracle parity, exact RTP, the feature algebra vs Monte Carlo within 4 SE, draw after place, and no double spin. Copy the pattern from an existing slot game or the package tests.
> - **Checks.** Run `npx tsc --noEmit -p games/<id>`, `npx vitest run games/<id>` and `npm run slots:eval -- <id>`. Then take screenshots at 1280×800 and 420×900: `node scripts/play.mjs <id> --out <dir> --steps "shot:idle;text:Spin;wait:3500;shot:spin;text:How to play;wait:700;shot:paytable"` (add `--size 420x900` for the narrow one). Open every PNG and fix what you see.
>
> Don't commit. Reply with the check results.
>
> <the concept card>

After the builds, run `npm install --package-lock-only --ignore-scripts`. Each new game is a workspace, and the deploy's `npm ci` needs it in the lockfile.

## 6. Checks (you)

For each built slot:
- `npm run slots:review -- prepare <id>` must show no warnings. A missing oracle, missing facts or no declared volatility goes back to the maths subagent.
- Grep its `src` for the trademarked names: `grep -rniE "mega ?ways|hold ?(&|and|n) ?win|cash ?collect" games/<id>/src`. A match goes back to the build subagent. The review's code scan would fail the gate on it anyway.

## 7. Review and gate

Review each slot with `.claude/skills/review-slot/SKILL.md`, keeping its isolation rules exactly. The blind players never learn the id or name. One blind player first. If `score` says "panel needed", widen to 3. The gate (code, `docs/SLOTS.md` §5):
- overall ≥ 3.5;
- readability and feature clarity ≥ 3;
- the oracle is present and the RTP is 95.5–96.5%;
- the hit rate, dry streak and max-win reachability are in band;
- not a reskin;
- no trademarked name.

## 8. Repair (up to 2 rounds)

If a slot fails, the reason decides who repairs it:
- **A §3 band or the RTP:** the maths subagent (step 4), with the failing measures.
- **Anything else:** a repair subagent (`sonnet`, the step 5 task) with:

  > Fix these, and change nothing else: <the gate reasons, the designer's cons, the players' confusions and misread checks, verbatim from `.evaluator/slots/<id>/score.json` and the panel's `player.json` files>.

A repair changes the code, so review the slot again from scratch: `prepare` (a new card), then a new panel (no `--more`), the designer, and `score`. After two failed repair rounds, drop it. Don't overrule the gate.

## 9. Keep or drop, and record

- **Kept** (gate PASS):
  - check that `slot-review.json` is current: `npm run slots:review -- todo` must not list it;
  - commit the slot on its own: `node scripts/commit-game.mjs <id> "Add <Name>: <hook>"`, ending with the session's attribution line;
  - add a row to the Roster in `docs/SLOT-CATALOGUE.md`: date, id, name, theme and promise, signature, RTP and tier, hit rate, SD, feature 1 in N, max win, AI overall, fun, readability, feature clarity, team (blank).
- **Dropped:**
  - delete `games/<id>` (it never shipped) and run `npm install --package-lock-only --ignore-scripts`;
  - add a line under "Dropped" in `docs/SLOT-CATALOGUE.md`: date, name, signature, the failing gate reason or check, and the lesson.
- **Batch section:** add one to `docs/SLOT-CATALOGUE.md` with the kept slots' concept cards and a results table (overall, gate, the five player scores, the §3 facts).
- **Patterns:** if the same failure reason appears three or more times across the catalogue, add it under "Patterns" as a rule for the concept and screen steps.
- **Commit** `package-lock.json`, `docs/SLOT-CATALOGUE.md` and the batch files.

## Report

Write a table of every concept: screened out (and why), built, kept, or dropped (with the overall and the failing gate reason). For each kept slot, add one line on what it is like to play, from the blind players' best and dullest moments. Then tell the user that the kept slots are prototypes. The team's ratings are the real test: the slot evaluator is not calibrated on team ratings yet.
