import { defineEval } from '@originals/game-sdk';
import { Q, TOPOLOGIES, TOPOLOGY_IDS, analysis, cashMultiplier, isLost, isWon, nextWire, prize, type TopologyId } from './math';

// The simulated player picks a random number of reveals to wait for, then cashes
// out (if the round hasn't already been decided), so the eval covers every
// stopping strategy from "cash out after one wire" to "play to the end".
export default defineEval<{ topo: TopologyId }>({
  configs: TOPOLOGY_IDS.map((topo) => ({ label: TOPOLOGIES[topo].name, params: { topo } })),
  playRound({ topo }, rng) {
    const t = TOPOLOGIES[topo];
    const order = rng.shuffle(t.edges.map((_, e) => e));
    const stopAfter = 1 + rng.int(t.edges.length);
    let live = 0;
    let dead = 0;
    for (let steps = 1; ; steps++) {
      const e = nextWire(t, live, dead, order)!;
      if (rng.next() < Q) live |= 1 << e;
      else dead |= 1 << e;
      if (isWon(t, live)) return { multiplier: prize(t), steps };
      if (isLost(t, dead)) return { multiplier: 0, steps };
      if (steps >= stopAfter) return { multiplier: cashMultiplier(t, analysis(t, live, dead).r), steps };
    }
  },
});
