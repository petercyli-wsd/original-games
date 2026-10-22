import { defineEval } from '@originals/game-sdk';
import { VOLATILITY, advance, darkCount, headline, huntChance, prizeFor, winChance, type Draw, type Pace, type Segments } from './math';

// The simulated player plays the real moves (Bet makes the first draw, then
// "Hunt" or "Draw once" at every checkpoint) and samples both a pace and a
// stopping rule each round:
//   pace:   always hunt, always draw one at a time, or a random choice per move;
//   stop:   play to the end, stop after a random number of moves, stop when the
//           next hunt's failure chance is above a threshold, stop-loss when the
//           win chance falls below a fraction of the start, or lock in once the
//           cash-out reaches a random multiple.
// Every one of these is a stopping rule on a martingale, so each returns RTP.
export default defineEval<{ k: Segments; D: number }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (${p.k} segments, ${p.D} draws)`, params: p })),
  playRound({ k, D }, rng) {
    const prize = prizeFor(k, D);
    const p0 = headline(k, D);

    const u = rng.next();
    const pace: Pace | 'mixed' = u < 0.5 ? 'hunt' : u < 0.62 ? 'draw' : 'mixed';
    const s = rng.next();
    let maxMoves = Infinity;
    let maxRisk = 1;
    let stopLoss = 0;
    let lockIn = Infinity;
    if (s < 0.3) {
      // play to the end
    } else if (s < 0.55) maxMoves = 1 + rng.int(k + 2);
    else if (s < 0.72) maxRisk = 0.02 + 0.5 * rng.next();
    else if (s < 0.86) stopLoss = p0 * (0.2 + 0.6 * rng.next());
    else lockIn = 1.05 + 3 * rng.next();

    let lit = new Array<boolean>(k).fill(false);
    let used = 0;
    let moves = 0;
    for (;;) {
      const mode: Pace = moves === 0 ? 'draw' : pace === 'mixed' ? (rng.next() < 0.4 ? 'draw' : 'hunt') : pace;
      const draws: Draw[] = advance(k, lit, D - used, mode, rng);
      lit = lit.slice();
      for (const d of draws) lit[d.seg] = true;
      used += draws.length;
      moves++;

      const m = darkCount(lit);
      const d = D - used;
      if (m === 0) return { multiplier: prize, steps: moves };
      if (d < m) return { multiplier: 0, steps: moves };

      const p = winChance(k, m, d);
      const cash = prize * p;
      const risk = 1 - huntChance(k, m, d);
      if (moves >= maxMoves || risk > maxRisk || p < stopLoss || cash >= lockIn) return { multiplier: cash, steps: moves };
    }
  },
});
