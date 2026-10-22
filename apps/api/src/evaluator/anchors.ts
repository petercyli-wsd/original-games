// Calibration anchors: games outside this repo whose quality is known.
// The manager's test for any scoring system is that proven games rank highly;
// deliberately weak concepts are included so the evaluator must also score low.
// Backtests check every prompt version against these.

import type { RulesCard } from '../shared.js';

export interface Anchor {
  id: string;
  name: string;
  expectation: 'high' | 'low';
  card: RulesCard;
  /** Stands in for Monte Carlo evals, which anchors don't have. */
  measured: string;
}

/** A high anchor passes at or above this overall score; a low one at or below LOW_MAX. */
export const HIGH_MIN = 3.6;
export const LOW_MAX = 2.6;

export const ANCHORS: Anchor[] = [
  {
    id: 'anchor-russian-roulette',
    name: 'Russian Roulette',
    expectation: 'high',
    card: {
      concept: 'A revolver with N chambers and one bullet; pull the trigger, survive to grow the multiplier.',
      win_condition: 'Survive each pull; cash out any time after a survived pull.',
      odds_display: 'The remaining chambers are drawn; the chance the next pull fires is 1 / chambers left.',
      volatility_controls: 'Number of chambers: Low 12, Medium 6, High 3, or a custom number up to 100.',
      checkpoints: 'After every survived pull the player chooses: pull again or cash out.',
      round_flow: 'Bet, pull, reveal, decide; repeats until a bust, a cash-out or the last chamber.',
      maths_family: 'Drawing without replacement (mines-style survival ladder).',
      dynamics: ['ladder'],
      theme_dependence: 'Works as pure geometry: a ring of N cells, one hidden hazard.',
      closest_known_games: ['Mines'],
    },
    measured: 'RTP 99% for every cash-out step. Std-dev spread across chamber settings well over 10×. Median round 1–4 pulls.',
  },
  {
    id: 'anchor-mines',
    name: 'Mines',
    expectation: 'high',
    card: {
      concept: 'A 5×5 grid hides M mines; reveal safe tiles to grow the multiplier.',
      win_condition: 'Reveal safe tiles; a mine loses the bet. Cash out any time.',
      odds_display: 'Unrevealed tiles and the mine count are on the board; the next-pick risk is mines / tiles left.',
      volatility_controls: 'Number of mines, 1 to 24.',
      checkpoints: 'After every safe tile.',
      round_flow: 'Bet, pick tiles one by one, cash out or bust.',
      maths_family: 'Hypergeometric survival ladder.',
      dynamics: ['ladder', 'choice'],
      theme_dependence: 'Pure grid geometry.',
      closest_known_games: ['Mines'],
    },
    measured: 'RTP 99% for every strategy. Volatility spread across mine counts above 20×. Rounds 1–24 picks.',
  },
  {
    id: 'anchor-crash',
    name: 'Crash',
    expectation: 'high',
    card: {
      concept: 'A multiplier climbs from 1× until it crashes at a random point; cash out before the crash.',
      win_condition: 'Cash out before the crash to win the current multiplier.',
      odds_display: 'The rising curve; P(reaching m) = RTP / m, so higher means riskier, implicitly.',
      volatility_controls: 'The player chooses their own cash-out target (auto cash-out).',
      checkpoints: 'Continuous: the player can cash out at any instant.',
      round_flow: 'Bet, watch the curve rise, cash out or crash. A few seconds.',
      maths_family: 'Continuous stopping on a heavy-tailed crash point.',
      dynamics: ['ladder'],
      theme_dependence: 'A line on a chart.',
      closest_known_games: ['Crash'],
    },
    measured: 'RTP 99% for any target. Volatility set by target multiplier, spread unbounded. Rounds of seconds.',
  },
  {
    id: 'anchor-dice',
    name: 'Dice',
    expectation: 'high',
    card: {
      concept: 'Roll a number from 0 to 100; win if it lands on your side of a slider.',
      win_condition: 'The roll lands in your chosen range.',
      odds_display: 'The slider shows the win range as a share of the bar; win chance equals that share.',
      volatility_controls: 'Drag the slider to set the win chance from 2% to 98%.',
      checkpoints: 'None within a round; each roll is instant, and auto-bet runs many.',
      round_flow: 'Set range, roll, instant result.',
      maths_family: 'Single uniform draw.',
      dynamics: ['other'],
      theme_dependence: 'A bar and a marker.',
      closest_known_games: ['Dice', 'Limbo'],
    },
    measured: 'RTP 99% at every setting. Volatility spread over 40×. One step per round.',
  },
  {
    id: 'anchor-frozen-lake',
    name: 'Frozen Lake',
    expectation: 'low',
    card: {
      concept: 'Cross a frozen lake; some ice tiles crack. Each safe tile grows the multiplier.',
      win_condition: 'Reach the far shore or cash out; a cracked tile loses.',
      odds_display: 'Tiles look identical; a small number shows how many cracked tiles remain.',
      volatility_controls: 'Number of thin-ice tiles.',
      checkpoints: 'After every safe tile.',
      round_flow: 'Pick tiles row by row like Mines, with ice and splash animations.',
      maths_family: 'Hypergeometric survival ladder, identical to Mines.',
      dynamics: ['ladder', 'choice'],
      theme_dependence: 'Relies on the ice theme; mechanically it is Mines.',
      closest_known_games: ['Mines', 'Chicken crossing'],
    },
    measured: 'RTP 99%. Volatility similar to Mines.',
  },
  {
    id: 'anchor-sticky-custard',
    name: 'Sticky Custard',
    expectation: 'low',
    card: {
      concept: 'Push a spoon through a bowl of custard; each push it may get stuck. Stuck at the bottom pays.',
      win_condition: 'Reach the bottom of the bowl without the spoon sticking three times, with stickiness that varies by custard type.',
      odds_display: 'A thickness gauge whose effect on the odds is not shown.',
      volatility_controls: 'Custard type: vanilla, chocolate, lumpy, each with hidden stickiness.',
      checkpoints: 'After each push.',
      round_flow: 'Push, animate, a sticky counter ticks, repeat.',
      maths_family: 'Survival ladder with hidden, theme-dependent probabilities.',
      dynamics: ['ladder'],
      theme_dependence: 'Only makes sense with the custard theme.',
      closest_known_games: ['Mines', 'Tower'],
    },
    measured: 'RTP 99%. Volatility spread about 2×.',
  },
  {
    id: 'anchor-four-colour-lottery',
    name: 'Four-Colour Lottery',
    expectation: 'low',
    card: {
      concept: 'A random planar map is coloured greedily with four colours; win if the greedy colouring needs no backtracking.',
      win_condition: 'The greedy algorithm finishes the map without a conflict.',
      odds_display: 'A percentage computed from the number of regions; nothing on the map shows it.',
      volatility_controls: 'Number of regions.',
      checkpoints: 'After each region is coloured.',
      round_flow: 'Regions fill one by one; a conflict ends the round.',
      maths_family: 'Graph colouring (four-colour theorem).',
      dynamics: ['ladder'],
      theme_dependence: 'Geometric.',
      closest_known_games: [],
    },
    measured: 'RTP 99%. Odds per step vary in ways the player cannot predict.',
  },
];
