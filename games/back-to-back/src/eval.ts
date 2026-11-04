import { defineEval } from '@originals/game-sdk';
import { DECK, NO_TOP, startChances, startPrize, turn, valueAfter } from './math';

// One config per volatility level: which colour you back (the only choice, made
// before the bet). Each round samples the player's behaviour: turn cards until
// someone snaps, stop after a random number of cards, or cash out once the value
// reaches a random target. A round is at most 22 cards.
const LEVELS = ['low', 'medium', 'high', 'extreme'];
const NAMES = ['red', 'blue', 'green', 'yellow'];

export default defineEval<{ me: number }>({
  configs: DECK.map((_, me) => ({
    label: `${LEVELS[me]} (${NAMES[me]}, ${(startChances()[me] * 100).toFixed(1)}%)`,
    params: { me },
  })),
  playRound({ me }, rng) {
    const stopAfter = rng.next() < 0.4 ? Infinity : 1 + rng.int(8);
    const target = rng.next() < 0.3 ? 1.2 * Math.exp(rng.next() * Math.log(50)) : Infinity;
    const prize = startPrize(me);
    let counts = [...DECK];
    let top = NO_TOP;
    let cards = 0;
    for (;;) {
      const t = turn(counts, top, rng.next());
      cards++;
      const value = valueAfter(t, me, prize);
      if (t.snap) return { multiplier: value, steps: cards };
      counts = t.counts;
      top = t.top;
      if (value === 0) return { multiplier: 0, steps: cards };
      if (cards >= stopAfter || (target < Infinity && value >= target)) return { multiplier: value, steps: cards };
    }
  },
});
