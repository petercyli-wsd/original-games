import { defineEval } from '@originals/game-sdk';
import { MODE_NAMES, PRESETS, sellMultiplier, prizeMultiplier, type Setup } from './math';

// The SDK eval averages one multiplier per round at a fixed stake of 1, so it
// only covers fixed-stake play: the simulated player scratches and sells at a
// random checkpoint (after 1..goes−1 misses) or never sells. Strategies that
// buy extra scratches change the stake mid-round, so they are checked by exact
// enumeration in math.test.ts instead (E[payout] = RTP × E[total staked]).
export default defineEval<Setup>({
  configs: [
    ...MODE_NAMES.map((m) => ({ label: `${m} (${PRESETS[m].goes} of ${PRESETS[m].cards})`, params: PRESETS[m] })),
    { label: 'custom (1 of 100)', params: { cards: 100, goes: 1 } },
    { label: 'custom (10 of 100)', params: { cards: 100, goes: 10 } },
  ],
  playRound(setup, rng) {
    const { cards, goes } = setup;
    // 0 = play every go; k > 0 = sell at the checkpoint after k misses.
    const sellAfter = rng.int(goes);
    let r = cards;
    let g = goes;
    let steps = 0;
    while (g > 0) {
      if (sellAfter > 0 && steps === sellAfter) return { multiplier: sellMultiplier(setup, g, r), steps: steps + 1 };
      steps++;
      if (rng.int(r) === 0) return { multiplier: prizeMultiplier(setup), steps };
      r--;
      g--;
    }
    return { multiplier: 0, steps };
  },
});
