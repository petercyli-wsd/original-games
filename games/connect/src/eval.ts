import { defineEval } from '@originals/game-sdk';
import {
  SPARES,
  VOLATILITY,
  budgetOf,
  decided,
  offered,
  openPairList,
  partsOf,
  prizeFor,
  winChance,
  type Edge,
  type Nodes,
  type Side,
  type Spare,
} from './math';

// Each round samples the player. The budget is sometimes nudged to a
// neighbouring option (the pre-bet choice). Then the player plays to the end,
// stops after a random number of edges, cashes out once the live chance falls
// below a threshold, or takes a profit once the cash-out passes a target.
// Edges are drawn from the real graph: a uniform pick among the open pairs.
export default defineEval<{ side: Side; n: Nodes; spare: Spare }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({
    label: `${level} (${p.side}, ${p.n} nodes, ${budgetOf(p.n, p.spare)} edges)`,
    params: p,
  })),
  playRound({ side, n, spare }, rng) {
    let x: Spare = spare;
    if (rng.next() < 0.3) {
      const i = SPARES.indexOf(spare) + (rng.next() < 0.5 ? -1 : 1);
      if (i >= 0 && i < SPARES.length && offered(n, SPARES[i])) x = SPARES[i];
    }
    const E = budgetOf(n, x);
    const prize = prizeFor(side, n, x);

    const style = rng.next();
    const stopAfter = style >= 0.3 && style < 0.55 ? 1 + rng.int(E) : Infinity;
    const riskFloor = style >= 0.55 && style < 0.8 ? 0.1 + rng.next() * 0.6 : 0;
    const profitAt = style >= 0.8 ? 0.99 * (1.1 + 2 * rng.next()) : Infinity;

    const edges: Edge[] = [];
    for (;;) {
      const open = openPairList(n, edges);
      const pick = open[rng.int(open.length)];
      edges.push([pick.a, pick.b]);
      const parts = partsOf(n, edges);
      const p = winChance(side, parts, edges.length, E);
      const cash = prize * p;
      if (decided(parts, edges.length, E)) return { multiplier: cash, steps: edges.length };
      if (edges.length >= stopAfter || p < riskFloor || cash >= profitAt) return { multiplier: cash, steps: edges.length };
    }
  },
});
