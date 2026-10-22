import { defineEval } from '@originals/game-sdk';
import { autoCallAt, cashAfter, flip, maxFlips, type AutoCall } from './math';

// One config per volatility level (coins × how many must match). Each round
// samples the player's behaviour: a random number of wins to stop at, a
// cash-out threshold, or playing to the config's deepest target, with a
// random call pattern (fixed side, random each flip, or alternating).
// Every setting is priced to the same 99%, so no per-config rtp is needed.
const LEVELS: { label: string; coins: number; need: number; deep: number }[] = [
  { label: 'low (5 coins, 2+ match, up to 8 wins)', coins: 5, need: 2, deep: 8 },
  { label: 'medium (1 coin, up to 6 wins)', coins: 1, need: 1, deep: 6 },
  { label: 'high (3 coins, all 3, up to 3 wins)', coins: 3, need: 3, deep: 3 },
  { label: 'extreme (5 coins, all 5, up to 2 wins)', coins: 5, need: 5, deep: 2 },
];

const PATTERNS: AutoCall[] = [0, 1, 'random', 'alternate'];

export default defineEval<{ coins: number; need: number; deep: number }>({
  configs: LEVELS.map(({ label, coins, need, deep }) => ({ label, params: { coins, need, deep } })),
  playRound({ coins, need, deep }, rng) {
    const top = Math.min(deep, maxFlips(coins, need));
    const stopAt = rng.next() < 0.3 ? top : 1 + rng.int(top);
    const cashAbove = rng.next() < 0.25 ? 1 + rng.next() * cashAfter(coins, need, top) : Infinity;
    const pattern = PATTERNS[rng.int(PATTERNS.length)];
    let s = 0;
    while (s < stopAt) {
      if (s > 0 && cashAfter(coins, need, s) >= cashAbove) break;
      const f = flip(coins, need, autoCallAt(pattern, s), rng);
      if (!f.win) return { multiplier: 0, steps: s + 1 };
      s++;
    }
    return { multiplier: cashAfter(coins, need, s), steps: s };
  },
});
