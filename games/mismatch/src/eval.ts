import { defineEval } from '@originals/game-sdk';
import { N, VOLATILITY, betDef, decided, drawNext, emptyBoard, isOpen, nextSlot, place, prizeFor, steps, tally, winChance, type BetId } from './math';

// The simulated player makes the real moves (Bet draws into slot 1, then
// "Draw into slot k" or "Draw to the end", always in slot order) and samples
// a stopping rule each round: play to the end, stop after a random number of
// draws, stop-loss when the win chance falls below a fraction of the start,
// lock in once the cash-out reaches a random multiple, or stop before any draw
// that could end the round on the spot. Each is a stopping rule on a
// martingale, so each returns RTP.
export default defineEval<{ bet: BetId }>({
  configs: Object.entries(VOLATILITY).map(([level, bet]) => ({ label: `${level} (${betDef(bet).name}, ${N} slots)`, params: { bet } })),
  playRound({ bet: id }, rng) {
    const bet = betDef(id);
    const prize = prizeFor(bet);
    const p0 = winChance(bet, tally(emptyBoard()));

    const s = rng.next();
    let maxDraws = Infinity;
    let stopLoss = 0;
    let lockIn = Infinity;
    let cautious = false;
    if (s < 0.3) {
      // play to the end
    } else if (s < 0.55) maxDraws = 1 + rng.int(N);
    else if (s < 0.7) stopLoss = p0 * (0.2 + 0.6 * rng.next());
    else if (s < 0.85) lockIn = 1.05 + 3 * rng.next();
    else cautious = true;

    let placed = emptyBoard();
    let draws = 0;
    for (;;) {
      // A cautious player cashes out rather than make a draw that can lose the round outright.
      if (cautious && draws > 0) {
        const t = tally(placed);
        const risky = steps(t, isOpen(placed, nextSlot(placed))).some((x) => decided(bet, x.after) === 'lost');
        if (risky) return { multiplier: prize * winChance(bet, t), steps: draws };
      }
      const d = drawNext(placed, rng);
      placed = place(placed, d.slot, d.token);
      draws++;

      const t = tally(placed);
      const end = decided(bet, t);
      if (end === 'won') return { multiplier: prize, steps: draws };
      if (end === 'lost') return { multiplier: 0, steps: draws };

      const p = winChance(bet, t);
      const cash = prize * p;
      if (draws >= maxDraws || p < stopLoss || cash >= lockIn) return { multiplier: cash, steps: draws };
    }
  },
});
