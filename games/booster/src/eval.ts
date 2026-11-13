import { defineEval } from '@originals/game-sdk';
import { CARDS, drawCard, valueOf } from './math';

// One fixed table and no settings, so one config. Each simulated player samples
// a behaviour per round (open all, sell at 1x, a random stopping card, sell
// after a Rare+ card), opening cards one at a time as Game.tsx does and selling
// at the same price valueOf() shows on the Sell button.
//
// Heavy tail: cards of 50x and up are under 0.005% of draws but carry about a
// quarter of the RTP, so a 100k-round sample is noisy and often reads a little
// low. The exact checks are in math.test.ts and fairness.test.ts.
export default defineEval<{ label: string }>({
  configs: [{ label: 'mixed behaviours', params: { label: 'mixed' } }],
  playRound(_params, rng) {
    const style = rng.int(4);
    const stopAt = style === 2 ? 1 + rng.int(CARDS) : CARDS;
    let cents = 0;
    let open = 0;
    while (open < CARDS) {
      const card = drawCard(rng);
      cents += card.cents;
      open++;
      if (open === CARDS) break;
      if (style === 1 && cents >= 100) break;
      if (style === 3 && card.rank >= 2) break;
      if (open >= stopAt) break;
    }
    return { multiplier: valueOf(cents, open), steps: open };
  },
});
