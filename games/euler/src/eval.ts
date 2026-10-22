import { defineEval } from '@originals/game-sdk';
import { BETS, RTP, VOLATILITY, cashOut, decided, drawPair, nextK, prize, type Settings } from './math';

// Plays the real loop: each edge is a uniformly random pair of distinct
// nodes, the degrees update, and the round ends when the edges run out or the
// bet is decided early (auto cash-out on a certain win, loss when no path wins).
//
// Each round samples one simulated player:
//   - play to the end (30%);
//   - stop after a random number of edges (25%);
//   - thresholds: take profit above a random multiple, or bail when the
//     cash-out falls below a random fraction of the stake (25%);
//   - an impulsive player who cashes at each checkpoint with some chance (20%).
// Steps count the edges drawn.
export default defineEval<Settings>({
  configs: Object.entries(VOLATILITY).map(([level, s]) => ({
    label: `${level} (${s.nodes} nodes, ${s.edges} edges, ${BETS.find((b) => b.id === s.bet)!.label})`,
    params: s,
  })),
  playRound(s, rng) {
    const mode = rng.next();
    const stopAt = mode >= 0.3 && mode < 0.55 ? 1 + rng.int(s.edges) : Infinity;
    const takeProfit = mode >= 0.55 && mode < 0.8 ? 1.2 + rng.next() * 4 : Infinity;
    const bail = mode >= 0.55 && mode < 0.8 ? rng.next() * 0.5 : 0;
    const impulse = mode >= 0.8 ? 0.1 + rng.next() * 0.3 : 0;

    const degrees = new Array<number>(s.nodes).fill(0);
    let k = 0;
    let cash = RTP;
    for (let r = s.edges; r > 0; ) {
      const [u, v] = drawPair(s.nodes, rng);
      k = nextK(k, degrees[u] % 2 === 1, degrees[v] % 2 === 1);
      degrees[u]++;
      degrees[v]++;
      r--;
      const steps = s.edges - r;
      const end = decided(s.nodes, s.bet, k, r);
      if (end === 'lost') return { multiplier: 0, steps };
      if (end === 'won') return { multiplier: prize(s), steps };
      cash = cashOut(s, k, r);
      if (steps >= stopAt || cash >= takeProfit || cash < bail || (impulse > 0 && rng.next() < impulse)) return { multiplier: cash, steps };
    }
    return { multiplier: cash, steps: s.edges };
  },
});
