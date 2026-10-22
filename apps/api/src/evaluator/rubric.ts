// Version 1 of the evaluator's rubric, written from the manager's brief.
// Refinement creates later versions in the database; this is only the seed.

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
      5: 'The board is the probability: chambers left, an area, a position, a count. Readable at a glance, no explanation needed.',
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
    question: 'Is the underlying maths and round dynamic distinct from mines-style and crash-style games and from every game in the catalogue?',
    weight: 2,
    descriptors: {
      1: 'A reskin: the same maths as an existing game under a new theme.',
      3: 'A known family (e.g. a mines-style survival ladder) with a genuinely different danger law, reveal or decision.',
      5: 'A dynamic not found in the catalogue or on the market, that still plays simply.',
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
      5: 'One natural knob (like the number of chambers) spanning low to high volatility; measured std-dev spread of 5× or more.',
    },
  },
  {
    key: 'checkpoints',
    name: 'Checkpoints and cash-out',
    question: 'Are there natural pauses where the player can stop and cash out, and is that a real decision?',
    weight: 1.5,
    descriptors: {
      1: 'A one-shot outcome with no pauses.',
      3: 'Pauses exist, but cashing out rarely matters (value barely changes, or is always below the stake).',
      5: 'A natural break after every step where cashing out is a real, tense decision.',
    },
  },
  {
    key: 'pace',
    name: 'Fast or slow play',
    question: 'Can the game be played both quickly and slowly?',
    weight: 1,
    descriptors: {
      1: 'One fixed pace, or rounds far too long or too short.',
      3: 'Works well at only one pace.',
      5: 'Instant play (turbo/auto) and deliberate step-by-step play both work; round length sits in a comfortable range.',
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

export const DEFAULT_GUIDANCE = `Calibrate against proven Originals. Mines, Crash, Dice, Limbo, Plinko and Russian roulette score 4–5 on most criteria; a game must earn a 5 by being at least as clear as those.
Common failure modes to score down:
- Reskins. AI-generated concepts often re-theme an existing mechanic (frozen lake, lava, broken digger, sticky custard). Same maths under a new theme is uniqueness 1 and usually geometry_first 1–2.
- Player-vs-House variants that add rules without adding gameplay. Extra rules cost simplicity.
- Games built from proven maths results whose win condition or odds are unintuitive to a player. Being mathematically elegant is not the same as being legible; judge odds_legibility from the player's seat.
Things that work well: one natural volatility knob (chamber count), a natural break after every step with a cash-out, random-walk "trading" dynamics, tug-of-war style duels where the board shows who is winning.
Mines-style or crash-style maths is acceptable; judge whether the danger law, reveal or decision is genuinely different. UI layout is not part of this evaluation.`;
