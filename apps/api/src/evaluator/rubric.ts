// The evaluator's rubric. It seeds a fresh database; an existing one takes it
// as a new version via `npm run evaluator -- seed-version`. Refinement creates
// later versions.
//
// Version 3 (calibrated on the team's first reviews). The team's low scores all
// came from games a player couldn't read: win condition and odds rated 1-2 by
// people while the AI, reading the code, rated them 4. So:
// - win condition, simplicity and odds are judged by a blind "player" judge
//   that only plays the UI (no code, rules card or descriptions), and they
//   carry most of the weight;
// - pace, checkpoints and geometry are things every game can be built to do
//   well, so they barely move the score;
// - fun is subjective and follows the others, so it counts little;
// - uniqueness gates prototypes (see overallScore in shared.ts).
//
// Version 4. The v3 blind player still followed games built on a maths idea
// (a hidden coin inferred from flips, chords that must not cross, a grid that
// fills, a family tree that survives) and rated them clear; the team rated all
// of them 1-2. The player now answers factual checks (how a round is decided,
// whether it is a known casino game, where its sense of the odds came from) and
// code caps its scores from them (playerCaps in service.ts).
//
// Version 5. The blind player is fully blind: it plays under an alias (never
// the game id), its guidance leaves out the designer and benchmark paragraphs,
// its team references are unnamed, and no player-facing text names a game as
// the standard to meet. Known casino games are still exempt from the pattern
// cap, but in code only; the player is not told so.

import type { CriterionDef } from '../shared.js';

export const DEFAULT_CRITERIA: CriterionDef[] = [
  {
    key: 'win_clarity',
    name: 'Clear win condition',
    question: 'From the screen alone, after one round, is it obvious what wins and what loses?',
    weight: 3,
    judge: 'player',
    descriptors: {
      1: 'After a round you still could not say what you were trying to make happen, or you would need to read rules to know.',
      3: 'It clicks after a round or two, or only after studying the labels and numbers.',
      5: 'Obvious from the first look and confirmed by the first round: anyone could say "this wins, that loses" without reading anything.',
    },
  },
  {
    key: 'simplicity',
    name: 'Simple to understand',
    question: 'From one play and no reading, could a new player explain the whole game in one sentence?',
    weight: 3,
    judge: 'player',
    descriptors: {
      1: 'Several interacting rules, unexplained symbols, numbers or charts; it would need a tutorial.',
      3: 'One core idea, but extra rules, bet types or settings that take a few rounds to make sense of.',
      5: 'One rule and nothing extra: it explains itself at a glance.',
    },
  },
  {
    key: 'odds_legibility',
    name: 'Odds on screen',
    question: 'Can the player see on the board, without calculating, both their overall chance of winning and how each move changes it?',
    weight: 3,
    judge: 'player',
    descriptors: {
      1: 'No feel for the odds from the screen, or only numbers and charts whose meaning is not obvious.',
      3: 'The odds appear as a percentage or meter, or only for the next move, but the board itself does not make the overall chance obvious.',
      5: 'The board is the probability (the green share of a slider, the tiles left, a position, an area): the overall chance and the next-move risk read at a glance.',
    },
  },
  {
    key: 'volatility_control',
    name: 'Customisable volatility',
    question: 'How well do the controls let a player choose their risk: natural, understandable, and really spanning low to high volatility?',
    weight: 1.5,
    descriptors: {
      1: 'No real control, or one whose effect on risk is unclear or tiny (small measured spread).',
      3: 'A control exists, but it is one of several interacting knobs, its effect on risk is not obvious, or the range is narrow.',
      5: "One natural knob whose effect the player can see (Dice's chance slider, the mine count, Plinko's risk and rows), spanning low to high volatility; measured std-dev spread of 5× or more.",
    },
  },
  {
    key: 'uniqueness',
    name: 'Unique mechanic',
    question: 'Is it a distinct format rather than a reskin of an existing game?',
    weight: 1.5,
    descriptors: {
      1: 'A reskin: the same maths and decision as a catalogue or market game under a new look or theme.',
      3: 'A known family (a mines-style ladder, a crash curve, a random walk) with a genuinely different danger law, reveal or decision.',
      5: 'A distinct format: a proven classic that defines its own format (Dice, Crash, Plinko), or a new dynamic not found in the catalogue or on the market that still plays simply.',
    },
  },
  {
    key: 'fun',
    name: 'Tension and fun',
    question: 'Did playing build tension and make you want another round?',
    weight: 0.75,
    judge: 'player',
    descriptors: {
      1: 'Flat or confusing: outcomes felt arbitrary and nothing built up.',
      3: 'Some tension, but rounds feel samey or it is unclear what to root for.',
      5: 'Every step visibly changed the stakes; you wanted one more round.',
    },
  },
  {
    key: 'checkpoints',
    name: 'Checkpoints and cash-out',
    question: 'Where a round has several steps, is there a natural point to stop and cash out?',
    weight: 0.25,
    descriptors: {
      1: 'A multi-step round with no point to stop, or a slow outcome with no rhythm of pauses.',
      3: 'Pauses exist, but cashing out rarely matters.',
      5: 'A natural break after each step with a real cash-out decision (Mines, Crash), or an instant round (Dice, Limbo) where every bet is its own pause. Most games built on the kit reach 4-5.',
    },
  },
  {
    key: 'pace',
    name: 'Fast or slow play',
    question: 'Can the game be played both quickly and slowly?',
    weight: 0.25,
    descriptors: {
      1: 'One fixed pace, or rounds far too long or too short for the format.',
      3: 'Works at only one pace, or lacks turbo or auto-bet.',
      5: 'Turbo and auto-bet for fast play, step-by-step play for slow, and a round length that suits the format. Most games built on the kit reach 4-5.',
    },
  },
  {
    key: 'geometry_first',
    name: 'Geometry-first',
    question: 'Does the concept make sense as plain shapes, without relying on a theme?',
    weight: 0.25,
    descriptors: {
      1: 'Only makes sense with its theme (frozen lake, lava volcano, sticky custard).',
      3: 'The theme helps, but the mechanic stands on its own.',
      5: 'Pure shapes; any theme is optional.',
    },
  },
];

export const DEFAULT_GUIDANCE = `Games are for players, not mathematicians. The team's low scores came from games whose win condition and odds a player could not read from the screen, even when the maths was elegant and the code clear. Being clever is not the same as being legible.

Player judge (win condition, simplicity, odds, fun): judge only what one casual play of the UI teaches. Play as a typical online casino player who skims and does not study numbers. If you had to stop and think, read labels twice, or infer rules from a chart, score it down. Extra bet types, interacting settings and unexplained symbols cost simplicity. Odds count only when the player can see them: the overall chance of the bet as well as the risk of the next step. A next-step number alone is a 3 unless the board makes the whole bet obvious. The clearest games are decided by a draw the player watches (a roll, a card, a tile, where a ball lands, where a multiplier stops, who wins a race). Games decided by a pattern the player has to check (lines crossing, a grid filling, a population surviving) or by a hidden state they only see clues about were rated 1-2 by the team on win condition and odds, however elegant.

Designer judge (uniqueness, volatility, checkpoints, pace, geometry): use the rules card and the measured facts. Volatility is about how well the dial lets a player choose risk: one natural, visible knob beats several interacting ones, and the measured spread must be real. Pace, checkpoints and geometry are baseline expectations that most games meet (4-5); score them low only when the format truly fails them, or when timing is the point and the game gets it wrong. Uniqueness: same maths and decision as an existing game under a new look is a reskin (1); a known family with a genuinely different law, reveal or decision is 3; the original of a format or a new dynamic that still plays simply is 5.

Benchmarks: the classics (Dice, Limbo, Crash, Mines, Plinko, Keno, Wheel, Tower, HiLo, Roulette and the table games) are proven. Most should land around 4 or above, with the core Originals (Dice, Limbo, Crash, Mines, Plinko, Keno) at the top. Table games with many bet types can be legitimately less simple. A prototype should only out-score a comparable classic where it is clearly better.`;
