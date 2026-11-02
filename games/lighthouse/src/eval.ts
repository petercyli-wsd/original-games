import { defineEval, type Rng, type Volatility } from '@originals/game-sdk';
import { PRESETS, VOLATILITY, chanceAt, fireAngle, headlineChance, lands, prizeFor, towerHeight, windowAt, type Win } from './math';

/** How the simulated player decides at the checkpoint (after the tower stops). */
export interface Strategy {
  /** Cash out at the checkpoint whatever it shows. */
  cashOut: boolean;
  /** Cash out when the beam's chance of missing exceeds this. */
  maxRisk: number;
  /** Cash out once the cash-out reaches this multiplier. */
  takeProfit: number;
  /** Cash out when the live win chance falls below this. */
  minChance: number;
}

export const PLAY_TO_END: Strategy = { cashOut: false, maxRisk: 1, takeProfit: Infinity, minChance: 0 };

/**
 * One round of the real staged process under a strategy, exactly as the game
 * plays it: the tower, the checkpoint, then the beam. Returns the payout
 * multiplier and the number of reveals.
 */
export function playLighthouse(win: Win, s: Strategy, rng: Rng) {
  const prize = prizeFor(win);
  const h = towerHeight(rng.next());
  const p = chanceAt(win, h);
  const cash = prize * p;
  if (s.cashOut || 1 - p > s.maxRisk || cash >= s.takeProfit || p < s.minChance) return { multiplier: cash, steps: 1 };
  return { multiplier: lands(win, h, fireAngle(rng.next())) ? prize : 0, steps: 2 };
}

/** Samples a strategy: a random cash-out, a risk threshold, a profit target, a chance floor, or playing to the end. */
export function sampleStrategy(rng: Rng): Strategy {
  const style = rng.next();
  if (style < 0.2) return { ...PLAY_TO_END, cashOut: true };
  if (style < 0.4) return { ...PLAY_TO_END, maxRisk: 0.5 + rng.next() * 0.5 };
  if (style < 0.55) return { ...PLAY_TO_END, takeProfit: 0.5 + rng.next() * 2 };
  if (style < 0.7) return { ...PLAY_TO_END, minChance: rng.next() * 0.3 };
  return PLAY_TO_END;
}

// Each round picks a random strategy, so the eval covers cashing out at the
// checkpoint, risk-averse stops, profit targets, chance floors and playing to
// the end.
export default defineEval<{ win: Win }>({
  configs: (Object.entries(VOLATILITY) as [Volatility, keyof typeof PRESETS][]).map(([level, id]) => {
    const { label, dist } = PRESETS[id];
    const win = windowAt(dist);
    return {
      label: `${level} (${label}, distance ${dist}, P₀ ${(headlineChance(win) * 100).toFixed(2)}%)`,
      params: { win },
    };
  }),
  playRound({ win }, rng) {
    return playLighthouse(win, sampleStrategy(rng), rng);
  },
});
