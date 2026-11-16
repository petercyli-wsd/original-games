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

## Retired

Kept slots later moved to the Archive (status `retired`). Write the reason for each.

## Batches

One section per `/generate-slots` batch or `/search-slots` cycle. Each section has:
- the concept cards of the kept slots;
- a results table: overall, the gate, the five player scores, and the §3 facts.

## Patterns

Failure reasons that recur across builds (three or more times). These become rules for the concept and screen steps.
