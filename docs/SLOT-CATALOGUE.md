# Slot catalogue

This is every original slot we have kept, dropped or retired, and why. The slot pipeline reads it:
- `/generate-slots` and `/search-slots` read it so they don't re-propose a concept;
- the `/review-slot` designer reads it to judge uniqueness and reskins.

How slots are made is in `docs/SLOTS.md`, and how the review works is in `docs/SLOT-EVALUATOR.md`.

**A reskin** is another slot here with the same evaluation law, the same modifier set (the feature included) and the same volatility band (SLOTS.md §5). It fails the gate whatever its theme.

## Roster

The kept slots, newest first. The signature is the evaluation law on its board law; the modifiers, feature included; and the volatility band. RTP is the game's total RTP with its tier. The scores come from `games/<id>/src/slot-review.json`.

| Date | Id | Name | Theme and promise | Signature | RTP | Hit rate | SD | Feature 1 in N | Max win | AI overall | Fun | Readability | Feature clarity | Team |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

## Dropped

Concepts that failed the screen, and builds that failed the gate after two repair rounds. Write one line each: the date, the name, the signature, why it was dropped (the failing gate reason or screen check), and the lesson.

- 2026-11-16 · **Hi-Score** (`hi-score`) · payline 3×3, 5 lines, global_iid multiplier reel, free spins with a per-spin level-up multiplier · medium. AI review 3.00, then 3.12 after one repair round (Peter allowed one): gate overall < 3.5. Readability 4 and feature clarity 4, but uniqueness 2 (base game reads as a classic multiplier-reel 3×3; a rising free-spin multiplier is already in the catalogue), fun 3, excitement 3. Lesson: a 3×3 classic needs a signature twist of its own; polish alone moves it from 3.00 to 3.12. Kept playable in the Archive (status `retired`) for team calibration, not deleted.

## Retired

Kept slots later moved to the Archive (status `retired`). Write the reason for each.

## Batches

One section per `/generate-slots` batch or `/search-slots` cycle. Each section has:
- the concept cards of the kept slots;
- a results table: overall, the gate, the five player scores, and the §3 facts.

## Patterns

Failure reasons that recur across builds (three or more times). These become rules for the concept and screen steps.
