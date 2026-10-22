import { defineEval, type Volatility } from '@originals/game-sdk';
import { RTP, VOLATILITY, afterSafeDraw, draw, hitsCap, newDeal, risk, type Settings } from './math';

// Plays the game exactly as the UI does: free draws (room on the table, or no
// untouched pair left) run by themselves, and the player decides only when the
// table is full. Each round samples a strategy: play to the end, stop once the
// bust chance passes a random threshold, or cash out after a random number of
// risky draws. The max-win cap auto-cashes as in the game. Steps count every
// token drawn, including the one that busts.
export default defineEval<Settings>({
  configs: (Object.entries(VOLATILITY) as [Volatility, Settings][]).map(([level, s]) => ({
    label: `${level} (${s.pairs} pairs, ${s.slots} slots)`,
    params: s,
  })),
  playRound({ pairs, slots }, rng) {
    const style = rng.next();
    const riskCap = style < 0.35 ? 1 : style < 0.65 ? 0.3 + rng.next() * 0.6 : 1;
    const riskyBudget = style >= 0.65 ? rng.int(4) : Infinity;
    let deal = newDeal(pairs, slots);
    let cash = RTP;
    let drawn = 0;
    let risky = 0;
    while (deal.pile.length > 0) {
      const q = risk(deal);
      if (q > 0) {
        if (hitsCap(cash, q) || q > riskCap || risky >= riskyBudget) break;
        risky++;
      }
      const res = draw(deal, rng.int(deal.pile.length));
      drawn++;
      if (res.kind === 'bust') return { multiplier: 0, steps: drawn };
      deal = res.deal;
      cash = afterSafeDraw(cash, q);
    }
    return { multiplier: cash, steps: drawn };
  },
});
