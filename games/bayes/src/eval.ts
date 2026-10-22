import { defineEval, type Volatility } from '@originals/game-sdk';
import { COIN_NAME, VOLATILITY, cashOut, likelihood, posteriorGold, priorOf, prize, winChance, type Coin, type Settings } from './math';

// Each round samples a player:
//   - play to the end: watch every flip, then reveal;
//   - random stop: cash out after a random number of flips;
//   - risk threshold: cash out once the win chance falls below a floor or
//     rises above a target (else reveal at the end);
//   - reveal early: stop flipping at a random point and reveal the coin.
// The side is fixed per config (it is the volatility knob); the mid-round
// choice between flip, cash out and reveal is what gets sampled.
export default defineEval<Settings>({
  configs: (Object.entries(VOLATILITY) as [Volatility, Settings][]).map(([level, s]) => ({
    label: `${level} (${COIN_NAME[s.side]} at ${Math.round(priorOf(s.side, s.prior) * 100)}%, ${s.sep}, ${s.flips} flips)`,
    params: s,
  })),
  playRound(s, rng) {
    const coin: Coin = rng.next() < s.prior ? 'gold' : 'silver';
    const full = prize(s.side, s.prior);
    const reveal = coin === s.side ? full : 0;
    const pHeads = likelihood('H', coin, s.sep);

    const u = rng.next();
    const strategy = u < 0.25 ? 'end' : u < 0.5 ? 'stop' : u < 0.75 ? 'threshold' : 'early';
    const stopAt = 1 + rng.int(s.flips);
    const floor = 0.01 + rng.next() * 0.3;
    const target = 0.5 + rng.next() * 0.49;

    // Bet flips the first coin straight away.
    let d = 0;
    for (let k = 1; k <= s.flips; k++) {
      d += rng.next() < pHeads ? 1 : -1;
      const pGold = posteriorGold(s.prior, s.sep, d);
      if (strategy === 'stop' && k === stopAt) return { multiplier: cashOut(s.side, s.prior, pGold), steps: k };
      if (strategy === 'early' && k === stopAt) return { multiplier: reveal, steps: k + 1 };
      if (strategy === 'threshold') {
        const p = winChance(s.side, pGold);
        if (p <= floor || p >= target) return { multiplier: cashOut(s.side, s.prior, pGold), steps: k };
      }
    }
    return { multiplier: reveal, steps: s.flips + 1 };
  },
});
