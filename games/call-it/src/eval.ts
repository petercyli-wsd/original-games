import { defineEval } from '@originals/game-sdk';
import { VOLATILITY, cashOut, dealsRed, afterTurn, prizeFor, settled, share, type Deck } from './math';

// Each round samples the player: call at once, call after a random number of
// turns, cash out after a random number of turns, wait for the red share to
// drift past a target (up or down) and then call or cash, or never call and
// let the deck run out. Steps count cards turned over, plus one for a call.
export default defineEval<Deck>({
  configs: Object.entries(VOLATILITY).map(([level, d]) => ({
    label: `${level} (${d.red} red, ${d.black} black)`,
    params: d,
  })),
  playRound(deck, rng) {
    const prize = prizeFor(deck);
    const n0 = deck.red + deck.black;
    const style = rng.int(5);
    const stopAfter = rng.int(Math.ceil(n0 / 2)); // 0 … n/2 turns
    const p0 = share(deck.red, deck.black);
    const target = p0 * (rng.next() < 0.5 ? 1.2 + rng.next() : 0.4 + 0.5 * rng.next());
    const cashInstead = rng.next() < 0.5;

    let { red, black } = deck;
    let turned = 0;
    for (;;) {
      const done = settled(red, black);
      if (done) return { multiplier: done === 'won' ? prize : 0, steps: turned };
      const p = share(red, black);
      let stop = false;
      let cash = false;
      if (style === 0) stop = true; // call straight away
      else if (style === 1) stop = turned >= stopAfter; // call after a random number of turns
      else if (style === 2) (stop = turned >= Math.max(1, stopAfter)), (cash = true); // cash out after a random number of turns
      else if (style === 3) (stop = turned > 0 && (target > p0 ? p >= target : p <= target)), (cash = cashInstead); // drift threshold
      // style 4: never call, the deck decides
      if (stop && cash) return { multiplier: cashOut(prize, red, black), steps: turned };
      const isRed = dealsRed(red, black, rng.next());
      if (stop) return { multiplier: isRed ? prize : 0, steps: turned + 1 };
      ({ red, black } = afterTurn(red, black, isRed));
      turned++;
    }
  },
});
