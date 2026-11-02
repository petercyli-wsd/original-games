import { defineEval, type Volatility } from '@originals/game-sdk';
import { MAX_SLIDE, RTP, SLOTS, VOLATILITY, afterSafeBall, drop, emptyTable, redCount, type Settings } from './math';

// Plays the game exactly as the UI does: balls that can't bust (no red slot)
// are placed automatically, so the player only decides at checkpoints. Each
// round samples a strategy: play to the end, stop once the bust chance passes
// a random threshold, or stop at the first checkpoint after a random number
// of balls. Steps count every ball dropped, including the one that busts.
export default defineEval<Settings>({
  configs: (Object.entries(VOLATILITY) as [Volatility, Settings][]).map(([level, s]) => ({
    label: `${level} (${s.balls} balls into ${SLOTS} slots, max slide ${MAX_SLIDE})`,
    params: s,
  })),
  playRound({ balls: K }, rng) {
    const m = SLOTS;
    const style = rng.next();
    const stopAt = style < 0.55 ? K : 1 + rng.int(K);
    const riskCap = style >= 0.3 && style < 0.55 ? 0.04 + rng.next() * 0.36 : 1;
    let table = emptyTable(m);
    let cash = RTP;
    let placed = 0;
    while (placed < K) {
      const red = redCount(table, MAX_SLIDE);
      if (red > 0 && (placed >= stopAt || red / m > riskCap)) break;
      const res = drop(table, rng.int(m), MAX_SLIDE);
      if (!res.safe) return { multiplier: 0, steps: placed + 1 };
      table = res.table;
      placed++;
      cash = afterSafeBall(cash, red, m);
    }
    return { multiplier: cash, steps: placed };
  },
});
