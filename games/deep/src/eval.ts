import { defineEval } from '@originals/game-sdk';
import { VOLATILITY, bustChance, emptyTree, insert, prizeFor, sure, winChance, winChanceAtStart, type Limit } from './math';

// The simulated player mixes strategies round by round:
//   - play to the end,
//   - stop after a random number of keys,
//   - stop once the next key's red share is above a random threshold,
//   - stop once the chance to finish climbs above a lock-in level, or falls below a bail-out level.
// The game's own rules apply to all of them: a key in a red gap busts, and a
// tree that can no longer bust plays out to the full prize. There are no
// other choices.
// Because the cash-out (prize × chance to finish) is a martingale, every mix
// returns the same RTP.
export default defineEval<{ limit: Limit; keys: number }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (depth ≤ ${p.limit}, ${p.keys} keys)`, params: p })),
  playRound({ limit, keys }, rng) {
    const prize = prizeFor(keys, limit);
    const p0 = winChanceAtStart(keys, limit);
    const mode = rng.next();
    const stopAfter = mode >= 0.3 && mode < 0.55 ? 1 + rng.int(keys) : keys;
    const maxRisk = mode >= 0.55 && mode < 0.75 ? 0.02 + rng.next() * 0.38 : 1;
    const lockIn = mode >= 0.75 ? p0 + rng.next() * (1 - p0) : 2;
    const bailOut = mode >= 0.75 ? rng.next() * p0 : -1;

    let tree = emptyTree();
    while (tree.keys.length < keys) {
      const placed = tree.keys.length;
      const left = keys - placed;
      if (placed > 0) {
        // A checkpoint: the player may stop here.
        if (placed >= stopAfter || bustChance(tree.gaps, limit) > maxRisk) return { multiplier: prize * winChance(tree.gaps, left, limit), steps: placed };
        if (mode >= 0.75) {
          const p = winChance(tree.gaps, left, limit);
          if (p >= lockIn || p <= bailOut) return { multiplier: prize * p, steps: placed };
        }
      }
      const { tree: next, key } = insert(tree, rng.next());
      if (key.depth > limit) return { multiplier: 0, steps: placed + 1 };
      tree = next;
      const nowLeft = keys - tree.keys.length;
      if (sure(tree.gaps, nowLeft, limit)) return { multiplier: prize, steps: tree.keys.length };
    }
    return { multiplier: prize, steps: keys };
  },
});
