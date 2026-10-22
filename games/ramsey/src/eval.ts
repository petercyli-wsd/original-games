import { defineEval, type Rng } from '@originals/game-sdk';
import { BOARDS, RTP, VOLATILITY, afterSafePick, edgeOdds, emptyColouring, ending, isOffered, type BoardSpec, type EdgeOdds } from './math';

type Policy = 'random' | 'safest' | 'riskiest' | 'gentle';

/** How the simulated player chooses among the offered edges. */
function choose(offered: EdgeOdds[], policy: Policy, rng: Rng): EdgeOdds {
  let pool = offered;
  if (policy === 'safest' || policy === 'riskiest') {
    const target = (policy === 'safest' ? Math.min : Math.max)(...offered.map((o) => o.q));
    pool = offered.filter((o) => o.q === target);
  } else if (policy === 'gentle') {
    // Prefer the mildest risky edges (1/3 on three colours), else anything.
    const risky = offered.filter((o) => o.q > 0);
    if (risky.length) {
      const low = Math.min(...risky.map((o) => o.q));
      pool = risky.filter((o) => o.q === low);
    }
  }
  return pool[rng.int(pool.length)];
}

// Each round samples a player: how they pick edges (uniformly at random, the
// safest, the riskiest, or the mildest risky one), and when they stop (a
// random number of picks, as soon as the chosen edge is too risky, or never,
// playing on until the board locks or the cap ends it). The first edge is
// coloured for the player, as in the game.
export default defineEval<BoardSpec>({
  configs: Object.entries(VOLATILITY).map(([level, id]) => {
    const b = BOARDS[id];
    return { label: `${level} (K${b.n}, ${b.colours} colours)`, params: b };
  }),
  playRound(board, rng) {
    const policies: Policy[] = ['random', 'random', 'safest', 'riskiest', 'gentle'];
    const policy = policies[rng.int(policies.length)];
    const edges = (board.n * (board.n - 1)) / 2;
    const stopAfter = rng.next() < 0.3 ? Infinity : 1 + rng.int(edges);
    const riskCap = rng.next() < 0.25 ? 0.3 + rng.next() * 0.5 : 1;
    const col = emptyColouring(board.n);
    let cash = RTP;
    let picks = 0;
    while (picks < stopAfter) {
      const offered = edgeOdds(board, col, cash).filter(isOffered);
      const pick = picks === 0 ? offered[rng.int(offered.length)] : choose(offered, policy, rng);
      if (picks > 0 && pick.q > riskCap) break;
      const colour = rng.int(board.colours);
      picks++;
      if ((pick.mask >> colour) & 1) return { multiplier: 0, steps: picks };
      col[pick.edge] = colour;
      cash = afterSafePick(cash, pick.q);
      if (ending(board, col, cash)) break;
    }
    return { multiplier: cash, steps: picks };
  },
});
