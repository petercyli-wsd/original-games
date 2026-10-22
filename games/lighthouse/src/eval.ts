import { defineEval, type Rng, type Volatility } from '@originals/game-sdk';
import {
  FAN,
  PRESETS,
  SHUTTERS,
  VOLATILITY,
  chanceAt,
  fireAngle,
  headlineChance,
  lands,
  prizeFor,
  shutter,
  shutterRisk,
  towerHeight,
  type Win,
  type Wedge,
} from './math';

/** How the simulated player decides at each checkpoint. */
export interface Strategy {
  /** Cash out at this checkpoint (1 = after the tower stops). */
  stopAt: number;
  /** Cash out when the next step's chance of losing the round outright exceeds this. */
  maxRisk: number;
  /** Cash out once the cash-out reaches this multiplier. */
  takeProfit: number;
  /** Cash out when the live win chance falls below this. */
  minChance: number;
}

export const PLAY_TO_END: Strategy = { stopAt: Infinity, maxRisk: 1, takeProfit: Infinity, minChance: 0 };

/**
 * One round of the real staged process under a strategy, exactly as the game
 * plays it: the tower, then each shutter, then the beam. Returns the payout
 * multiplier and the number of reveals.
 */
export function playLighthouse(win: Win, shutters: number, s: Strategy, rng: Rng) {
  const prize = prizeFor(win);
  const h = towerHeight(rng.next());
  let wedge: Wedge = FAN;
  let p = chanceAt(win, h, wedge);
  let steps = 1;
  let used = 0;
  for (let checkpoint = 1; ; checkpoint++) {
    // A live checkpoint: 0 < p < 1.
    const more = used < shutters;
    const cash = prize * p;
    const risk = more ? shutterRisk(win, h, wedge) : 1 - p;
    if (checkpoint >= s.stopAt || risk > s.maxRisk || cash >= s.takeProfit || p < s.minChance) return { multiplier: cash, steps };
    if (!more) break;
    wedge = shutter(wedge, rng.next());
    used++;
    steps++;
    p = chanceAt(win, h, wedge);
    // The shutter closed over the whole window: lost without firing.
    if (p === 0) return { multiplier: 0, steps };
    // The lit wedge lies inside the window: the beam fires on its own.
    if (p === 1) break;
  }
  const theta = fireAngle(wedge, rng.next());
  return { multiplier: lands(win, h, theta) ? prize : 0, steps: steps + 1 };
}

/** Samples a strategy: a random stop, a risk threshold, a profit target, a chance floor, or playing to the end. */
export function sampleStrategy(shutters: number, rng: Rng): Strategy {
  const style = rng.next();
  if (style < 0.22) return { ...PLAY_TO_END, stopAt: 1 + rng.int(shutters + 1) };
  if (style < 0.42) return { ...PLAY_TO_END, maxRisk: 0.3 + rng.next() * 0.69 };
  if (style < 0.58) return { ...PLAY_TO_END, takeProfit: 1 + rng.next() * 5 };
  if (style < 0.7) return { ...PLAY_TO_END, minChance: rng.next() * 0.3 };
  return PLAY_TO_END;
}

// Each round picks a random shutter count (the player's pace choice) and a
// random strategy, so the eval covers fixed stops, risk-averse stops, profit
// targets, chance floors and playing every round to the end.
export default defineEval<{ win: Win }>({
  configs: (Object.entries(VOLATILITY) as [Volatility, keyof typeof PRESETS][]).map(([level, id]) => {
    const { label, win } = PRESETS[id];
    return {
      label: `${level} (${label} ${win.a}..${win.b}, P₀ ${(headlineChance(win) * 100).toFixed(2)}%)`,
      params: { win },
    };
  }),
  playRound({ win }, rng) {
    const shutters = SHUTTERS[rng.int(SHUTTERS.length)];
    return playLighthouse(win, shutters, sampleStrategy(shutters, rng), rng);
  },
});
