import { defineEval, type Rng } from '@originals/game-sdk';
import {
  VOLATILITY,
  betDef,
  decided,
  drawInto,
  isOpen,
  nextSlot,
  place,
  emptyBoard,
  prizeFor,
  steps,
  tally,
  winChance,
  type BetId,
  type Placed,
  type Size,
} from './math';

type SlotPolicy = 'clockwise' | 'random' | 'safeFirst' | 'openFirst';

/** Which empty slot the simulated player fills next. Every policy is EV-neutral; they only move the risk around. */
function pickSlot(placed: Placed, policy: SlotPolicy, rng: Rng): number {
  const empty = placed.map((t, i) => (t === null ? i : -1)).filter((i) => i >= 0);
  if (policy === 'clockwise') return nextSlot(placed);
  if (policy === 'random') return empty[rng.int(empty.length)];
  const open = empty.filter((i) => isOpen(placed, i));
  const safe = empty.filter((i) => !isOpen(placed, i));
  const pool = policy === 'safeFirst' ? (safe.length ? safe : open) : open.length ? open : safe;
  return pool[rng.int(pool.length)];
}

// The simulated player makes the real moves (Bet draws into the first slot,
// then "Draw next", a clicked slot or "Draw to the end") and samples both a
// slot policy and a stopping rule each round:
//   slots: clockwise, random, empty "safe" slots first, or open slots first;
//   stop:  play to the end, stop after a random number of draws, stop-loss
//          when the win chance falls below a fraction of the start, lock in
//          once the cash-out reaches a random multiple, or stop before any
//          draw that could end the round on the spot.
// Each is a stopping rule on a martingale, so each returns RTP.
export default defineEval<{ n: Size; bet: BetId }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (${betDef(p.bet).name}, ${p.n} slots)`, params: p })),
  playRound({ n, bet: id }, rng) {
    const bet = betDef(id);
    const prize = prizeFor(n, bet);
    const p0 = winChance(bet, tally(emptyBoard(n)));

    const policies: SlotPolicy[] = ['clockwise', 'random', 'safeFirst', 'openFirst'];
    const policy = policies[rng.int(policies.length)];
    const s = rng.next();
    let maxDraws = Infinity;
    let stopLoss = 0;
    let lockIn = Infinity;
    let cautious = false;
    if (s < 0.3) {
      // play to the end
    } else if (s < 0.55) maxDraws = 1 + rng.int(n);
    else if (s < 0.7) stopLoss = p0 * (0.2 + 0.6 * rng.next());
    else if (s < 0.85) lockIn = 1.05 + 3 * rng.next();
    else cautious = true;

    let placed = emptyBoard(n);
    let draws = 0;
    for (;;) {
      const slot = draws === 0 ? 0 : pickSlot(placed, policy, rng);
      // A cautious player cashes out rather than make a draw that can lose the round outright.
      if (cautious && draws > 0) {
        const t = tally(placed);
        const risky = steps(t, isOpen(placed, slot)).some((x) => decided(bet, x.after) === 'lost');
        if (risky) return { multiplier: prize * winChance(bet, t), steps: draws };
      }
      const d = drawInto(placed, slot, rng);
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
