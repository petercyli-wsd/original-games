import { defineEval } from '@originals/game-sdk';
import { PAYTABLES, PAYTABLE_IDS, playOptimal, type PaytableId } from './math';

// One config per paytable, each played with its own optimal holds (the same
// solver Auto and the hint use). When several holds are worth exactly the
// same, the simulated player picks one at random, so every optimal strategy
// is sampled; holding anything else is strictly worse, so the exact RTP of
// each table is the optimal-play value declared per config.
export default defineEval<{ table: PaytableId }>({
  configs: PAYTABLE_IDS.map((id) => {
    const pt = PAYTABLES[id];
    return { label: `${pt.volatility} (${pt.name}, ${pt.schedule})`, params: { table: id }, rtp: pt.rtp };
  }),
  playRound({ table }, rng) {
    const hand = playOptimal(PAYTABLES[table], rng, 'random');
    return { multiplier: hand.multiplier, steps: 2 };
  },
});
