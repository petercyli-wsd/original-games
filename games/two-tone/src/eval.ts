import { defineEval } from '@originals/game-sdk';
import { RTP, VOLATILITY, addEdge, afterSafeEdge, emptyGraph, hasEdge, isFatal, pairCount, risk, type Edges, type Nodes } from './math';

// Plays the real game loop: a uniformly random open pair becomes the next
// edge (sampled by rejection over all pairs, which is uniform over the open
// ones), free edges (q = 0) are placed without a checkpoint, and the round
// auto-cashes at the target or when every open pair is fatal.
//
// Each round samples one simulated player:
//   - play to the end (30%);
//   - stop at a random checkpoint (25%);
//   - a risk threshold: stop when the next edge's bust chance is above a random cap (25%);
//   - an impulsive player who cashes at each checkpoint with some chance (20%).
// Steps count the edges drawn, the fatal one included.
export default defineEval<{ nodes: Nodes; edges: Edges }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (${p.nodes} nodes, ${p.edges} edges)`, params: p })),
  playRound({ nodes, edges: target }, rng) {
    const mode = rng.next();
    const stopAt = mode >= 0.3 && mode < 0.55 ? 1 + rng.int(target) : Infinity;
    const cap = mode >= 0.55 && mode < 0.8 ? 0.05 + rng.next() * 0.4 : 1;
    const impulse = mode >= 0.8 ? 0.1 + rng.next() * 0.3 : 0;
    const N = pairCount(nodes);

    let g = emptyGraph(nodes);
    let cash = RTP;
    let checkpoints = 0;
    while (g.edges.length < target) {
      const { q } = risk(g);
      if (q >= 1) break; // saturated: auto cash-out
      if (q > 0) {
        checkpoints++;
        if (checkpoints >= stopAt || q > cap || (impulse > 0 && rng.next() < impulse)) break;
      }
      let u = 0;
      let v = 0;
      do {
        const k = rng.int(N);
        // Pair number k in the order (0,1), (0,2), …, (1,2), …
        let i = 0;
        let rest = k;
        while (rest >= nodes - 1 - i) rest -= nodes - 1 - i++;
        u = i;
        v = i + 1 + rest;
      } while (hasEdge(g, u, v));
      if (isFatal(g, u, v)) return { multiplier: 0, steps: g.edges.length + 1 };
      cash = afterSafeEdge(cash, q);
      g = addEdge(g, u, v);
    }
    return { multiplier: cash, steps: g.edges.length };
  },
});
