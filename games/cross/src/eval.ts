import { defineEval } from '@originals/game-sdk';
import { VOLATILITY, bit, cashOutFor, drawCard, onCross, prizeFor, safeShare, turnsLeft, winChance, type Turns } from './math';

// The simulated player mixes strategies round by round: play to the end, cash
// out after a random number of turns, cash out when the red cross covers too
// much of the cards left, or cash out once the win chance falls below (or
// rises above) a random threshold. The deck is drawn card by card.
export default defineEval<{ k: Turns }>({
  configs: Object.entries(VOLATILITY).map(([level, k]) => ({ label: `${level} (${k} ${k === 1 ? 'turn' : 'turns'})`, params: { k } })),
  playRound({ k }, rng) {
    const style = rng.next();
    const stopAfter = style < 0.3 ? k : style < 0.55 ? 1 + rng.int(k) : k;
    const minSafe = style >= 0.55 && style < 0.7 ? 0.3 + rng.next() * 0.4 : 0;
    const floor = style >= 0.7 && style < 0.85 ? rng.next() * 0.3 : 0;
    const ceiling = style >= 0.85 ? 0.1 + rng.next() * 0.7 : 1;

    const order = [drawCard(rng.next(), 0)];
    let mask = bit(order[0]);
    for (;;) {
      const turns = order.length - 1;
      if (turnsLeft(k, order.length) === 0) return { multiplier: prizeFor(k), steps: turns };
      const p = winChance(k, order);
      if (p === 0) return { multiplier: 0, steps: turns };
      // A checkpoint: after at least one survived turn, unless the rest is certain.
      if (turns >= 1 && p < 1) {
        const { safe, left } = safeShare(order);
        if (turns >= stopAfter || safe / left < minSafe || p < floor || p >= ceiling) return { multiplier: cashOutFor(k, order), steps: turns };
      }
      const card = drawCard(rng.next(), mask);
      if (onCross(order[order.length - 1], card)) return { multiplier: 0, steps: turns + 1 };
      order.push(card);
      mask |= bit(card);
    }
  },
});
