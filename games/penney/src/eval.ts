import { defineEval, type Rng, type Volatility } from '@originals/game-sdk';
import { COINS, HOUSE, VOLATILITY, YOURS, allPairs, cashAt, onePointAway, race, volatilityOf } from './math';

interface Params {
  level: Volatility;
  /** The quick-pick pair for this level. */
  preset: { you: string; house: string };
  /** Every pair in the same volatility band that settles in ≤ 9 flips on average. */
  family: { you: string; house: string }[];
}

const families = new Map<Volatility, Params['family']>();
function familyOf(level: Volatility) {
  let f = families.get(level);
  if (!f) {
    f = allPairs().filter(({ you, house }) => {
      const r = race(you, house);
      return volatilityOf(r.p0) === level && r.flipsLeft('') <= 9;
    });
    families.set(level, f);
  }
  return f;
}

type Strategy = 'end' | 'fixed' | 'stopLoss' | 'takeProfit' | 'onePoint' | 'coin';

function pickStrategy(rng: Rng): Strategy {
  const u = rng.next();
  return u < 0.3 ? 'end' : u < 0.5 ? 'fixed' : u < 0.65 ? 'stopLoss' : u < 0.8 ? 'takeProfit' : u < 0.9 ? 'onePoint' : 'coin';
}

// Each round the simulated player picks a pattern pair (half the time the
// level's quick pick, otherwise any pair in the same band) and a cash-out
// habit: play to the end, stop after a random number of flips, a stop-loss or
// take-profit on the live win chance, cash out when the house is one coin
// away, or a coin-toss at every checkpoint. Flips stop as soon as the race is
// decided, as in the game.
export default defineEval<Params>({
  configs: (Object.keys(VOLATILITY) as Volatility[]).map((level) => {
    const preset = VOLATILITY[level];
    const p0 = race(preset.you, preset.house).p0;
    return {
      label: `${level} (${preset.you} vs ${preset.house}, ${(p0 * 100).toFixed(1)}%, + band)`,
      params: { level, preset, family: familyOf(level) },
    };
  }),
  playRound({ preset, family }, rng) {
    const pair = rng.next() < 0.5 ? preset : family[rng.int(family.length)];
    const r = race(pair.you, pair.house);
    const strategy = pickStrategy(rng);
    const stopAfter = 1 + rng.int(10);
    const lossLine = r.p0 * (0.2 + 0.7 * rng.next());
    const profitLine = r.p0 + (1 - r.p0) * (0.2 + 0.6 * rng.next());

    let node = '';
    let flips = 0;
    for (;;) {
      node = r.next(node, COINS[rng.int(2)]);
      flips++;
      if (node === YOURS) return { multiplier: r.prize, steps: flips };
      if (node === HOUSE || r.decided(node)) return { multiplier: cashAt(r, node), steps: flips };

      // A checkpoint: apply the habit.
      const p = r.chance(node);
      const houseClose = onePointAway(r, node) && p < r.p0;
      const stop =
        (strategy === 'fixed' && flips >= stopAfter) ||
        (strategy === 'stopLoss' && p < lossLine) ||
        (strategy === 'takeProfit' && p > profitLine) ||
        (strategy === 'onePoint' && houseClose) ||
        (strategy === 'coin' && rng.next() < 0.25);
      if (stop) return { multiplier: cashAt(r, node), steps: flips };
    }
  },
});
