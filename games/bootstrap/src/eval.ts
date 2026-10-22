import { defineEval } from '@originals/game-sdk';
import { RTP, VOLATILITY, addSeed, cashOut, nextSeed, pWin, prizeFor, type Settings, type State } from './math';

// The simulated player samples a strategy each round: play every seed (30%),
// stop after a random number of seeds, and in some rounds also bail out as
// soon as the live win chance falls below a random threshold. The round
// settles by itself the moment the outcome is certain (P = 0 or 1).
export default defineEval<Settings>({
  configs: Object.entries(VOLATILITY).map(([level, s]) => ({
    label: `${level} (${s.n}×${s.n}, ${s.k} seeds, ${s.side === 'full' ? 'Full grid' : 'Not full'})`,
    params: s,
  })),
  playRound(s, rng) {
    const { n, k, side } = s;
    const stopAt = rng.next() < 0.3 ? k : 1 + rng.int(k);
    const floor = rng.next() < 0.3 ? rng.next() * 0.5 : 0;
    let st: State = { seeds: [], C: 0 };
    let cash = RTP;
    while (st.seeds.length < k) {
      st = addSeed(st, nextSeed(st, n, rng.next()), n);
      const p = pWin(side, st.C, st.seeds.length, n, k);
      cash = cashOut(s, st.C, st.seeds.length);
      if (p === 0) return { multiplier: 0, steps: st.seeds.length };
      if (p === 1) return { multiplier: prizeFor(s), steps: st.seeds.length };
      if (st.seeds.length >= stopAt || p < floor) break;
    }
    return { multiplier: cash, steps: st.seeds.length };
  },
});
