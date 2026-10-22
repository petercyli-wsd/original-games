// The evaluator's rubric, written from the manager's brief and calibrated so
// the proven casino classics land at the top of the scale. It seeds a fresh
// database; an existing one takes it as a new version via
// `npm run evaluator -- seed-version`. Refinement creates later versions.

import type { CriterionDef } from '../shared.js';

export const DEFAULT_CRITERIA: CriterionDef[] = [
  {
    key: 'odds_legibility',
    name: 'Odds on screen',
    question: 'Is the current win probability visually obvious and intuitive at every moment of a round?',
    weight: 3,
    descriptors: {
      1: 'The player cannot tell their chances, or must compute them; the maths result behind the game is unintuitive.',
      3: 'The odds are shown as a number or meter, but the board itself does not make them obvious.',
      5: "The board is the probability: chambers left, tiles left, the share of a dice slider, a position, an area. Readable at a glance, no explanation needed.",
    },
  },
  {
    key: 'win_clarity',
    name: 'Clear win condition',
    question: 'Is it immediately clear what wins and what loses?',
    weight: 2,
    descriptors: {
      1: 'Unclear what counts as a win, or several interacting rules decide it.',
      3: 'Clear once the rules are read.',
      5: 'Obvious from one look or one short sentence ("survive the shot", "cash out before it crashes").',
    },
  },
  {
    key: 'simplicity',
    name: 'Simple to understand',
    question: 'Is it purposefully simple: could a new player explain it in one sentence?',
    weight: 2,
    descriptors: {
      1: 'Several mechanics, jargon, or a tutorial needed.',
      3: 'One core idea with a few extra rules to learn.',
      5: 'One rule, nothing extra, like Russian roulette or Dice.',
    },
  },
  {
    key: 'uniqueness',
    name: 'Unique mechanic',
    question: 'Is it a distinct format rather than a reskin of mines-style, crash-style or any other game in the catalogue?',
    weight: 2,
    descriptors: {
      1: 'A reskin: the same maths and decision as an existing game under a new theme.',
      3: 'A known family (e.g. a mines-style survival ladder) with a genuinely different danger law, reveal or decision.',
      5: 'A distinct format: a proven classic that defines its own format (Dice, Crash, Plinko), or a new dynamic not found in the catalogue or on the market that still plays simply.',
    },
  },
  {
    key: 'volatility_control',
    name: 'Customisable volatility',
    question: 'Can the player customise volatility with a natural, understandable control, and does it really change the risk?',
    weight: 1.5,
    descriptors: {
      1: 'No control, or the control barely changes the risk (measured spread small).',
      3: 'A control exists but its range is narrow or its effect is hard to understand.',
      5: "One natural knob (chamber count, Dice's win-chance slider, Plinko's risk and rows) spanning low to high volatility; measured std-dev spread of 5× or more.",
    },
  },
  {
    key: 'checkpoints',
    name: 'Checkpoints and cash-out',
    question: 'Can the player pause or continue quickly, and, when a round has several steps, stop and cash out at a real decision point?',
    weight: 1.5,
    descriptors: {
      1: 'A multi-step round with no point to stop, or a slow outcome with no rhythm of pauses.',
      3: 'Pauses exist, but cashing out rarely matters (the value barely changes, or is always below the stake).',
      5: 'A natural break after every step where cashing out is a real, tense decision (Mines, Crash), or an instant round (Dice, Limbo) that resolves at once so every bet is its own pause.',
    },
  },
  {
    key: 'pace',
    name: 'Fast or slow play',
    question: 'Can the game be played both quickly and slowly?',
    weight: 1,
    descriptors: {
      1: 'One fixed pace, or rounds far too long or too short.',
      3: 'Works well at only one pace, or lacks turbo or auto-bet.',
      5: 'Instant play (turbo, auto-bet) and deliberate play both work, and round length suits the format (instant games resolve in one step).',
    },
  },
  {
    key: 'fun',
    name: 'Tension and fun',
    question: 'Does each step visibly change the stakes, creating tension, near misses and a pull to play again?',
    weight: 1.5,
    descriptors: {
      1: 'Flat: outcomes feel arbitrary and nothing builds.',
      3: 'Some tension, but steps feel samey.',
      5: 'Every step changes the stakes visibly; you want one more round.',
    },
  },
  {
    key: 'geometry_first',
    name: 'Geometry-first',
    question: 'Does the concept make sense as pure geometry, without relying on a theme?',
    weight: 0.5,
    descriptors: {
      1: 'Only makes sense with its theme (frozen lake, lava volcano, sticky custard).',
      3: 'The theme helps, but the mechanic stands on its own.',
      5: 'Pure shapes; any theme is optional and it would translate to a 3D or live show.',
    },
  },
];

export const DEFAULT_GUIDANCE = `Benchmark: the catalogue's classics (marked "classic": Dice, Limbo, Crash, Mines, Plinko, Keno, HiLo, Tower, Wheel, Roulette and the table games) are proven games the studio already runs. A well-made classic should land around 4 or above overall, and the core Originals (Dice, Limbo, Crash, Mines, Plinko, Keno) at the very top. They are the top of the scale for prototypes: a prototype should only out-score a comparable classic on a criterion where it is clearly better.
Instant one-shot games (Dice, Limbo, Coin Flip) are not penalised for lacking mid-round checkpoints: each bet resolves at once and the player pauses between bets. Table classics (Blackjack, Baccarat, Craps, Sic Bo) are proven but less Originals-shaped: familiarity makes their win condition clear, while their odds clarity and volatility control depend on how the implementation presents the bets and pay table.
Common failure modes to score down:
- Reskins. AI-generated concepts often re-theme an existing mechanic (frozen lake, lava, broken digger, sticky custard). Same maths under a new theme is uniqueness 1 and usually geometry_first 1–2.
- Player-vs-House variants that add rules without adding gameplay. Extra rules cost simplicity.
- Games built from proven maths results whose win condition or odds are unintuitive to a player. Being mathematically elegant is not the same as being legible; judge odds_legibility from the player's seat.
Things that work well: one natural volatility knob (chamber count), a natural break after every step with a cash-out, random-walk "trading" dynamics, tug-of-war style duels where the board shows who is winning.
Mines-style or crash-style maths is acceptable; judge whether the danger law, reveal or decision is genuinely different. UI layout is not part of this evaluation.`;
