import { defineEval, type Volatility } from '@originals/game-sdk';
import { RTP, VOLATILITY, afterSafeKey, emptyTable, insert, keysFor, redCount, type Settings } from './math';

// Plays the game exactly as the UI does: keys with no red slot (free keys)
// go in automatically, so the player only decides at checkpoints. Each round
// samples a strategy: play to the end, stop once the bust chance passes a
// random threshold, or stop at the first checkpoint after a random number of
// keys. Steps count every key hashed, including the one that overflows.
export default defineEval<Settings>({
  configs: (Object.entries(VOLATILITY) as [Volatility, Settings][]).map(([level, s]) => ({
    label: `${level} (${s.size} slots, probe ≤ ${s.limit}, ${keysFor(s.size, s.load)} keys)`,
    params: s,
  })),
  playRound({ size: m, limit, load }, rng) {
    const K = keysFor(m, load);
    const style = rng.next();
    const stopAt = style < 0.55 ? K : 1 + rng.int(K);
    const riskCap = style >= 0.3 && style < 0.55 ? 0.04 + rng.next() * 0.36 : 1;
    let table = emptyTable(m);
    let cash = RTP;
    let keys = 0;
    while (keys < K) {
      const red = redCount(table, limit);
      if (red > 0 && (keys >= stopAt || red / m > riskCap)) break;
      const res = insert(table, rng.int(m), limit);
      if (!res.safe) return { multiplier: 0, steps: keys + 1 };
      table = res.table;
      keys++;
      cash = afterSafeKey(cash, red, m);
    }
    return { multiplier: cash, steps: keys };
  },
});
