// Fairness audit: no strategy beats the RTP.
//
// The only mid-round decision in Cross is "cash out or turn the next card"
// (the turn count is fixed before the bet; the board's tints are information,
// not choices). The cash-out V = prize · P(win | turned set, current card) is
// checked to be an exact martingale at reachable states, and every strategy
// below is evaluated twice: exactly, by recursion over the (turned set,
// current card) states the round can reach, and by simulation with the game's
// own draw (drawCard on the host rng).
import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { RTP, TURNS, bit, cashOutFor, drawCard, nextCards, onCross, prizeFor, remaining, safeShare, winChance, type Turns } from './math';

type Decide = (k: Turns, order: readonly number[]) => 'cash' | 'draw';

const maskOf = (order: readonly number[]) => order.reduce((a, c) => a | bit(c), 0);

/** What the round is worth once a card has landed safely: mirrors Game.tsx advance(). */
type Landed = { kind: 'won' | 'dead' | 'auto' | 'checkpoint'; value: number };
function landed(k: Turns, order: readonly number[]): Landed {
  const done = order.length - 1;
  if (done >= k) return { kind: 'won', value: prizeFor(k) };
  const p = winChance(k, order);
  if (p <= 0) return { kind: 'dead', value: 0 };
  if (done >= 1 && p < 1 - 1e-12) return { kind: 'checkpoint', value: cashOutFor(k, order) };
  return { kind: 'auto', value: cashOutFor(k, order) };
}

const STRATEGIES: Record<string, Decide> = {
  // (a) the tester's rule: turn only when the next card is safe with chance ≥ 0.8.
  tester: (_k, order) => {
    const { safe, left } = safeShare(order);
    return safe / left >= 0.8 ? 'draw' : 'cash';
  },
  // (b) take any profit.
  profit: (k, order) => (cashOutFor(k, order) > 1 ? 'cash' : 'draw'),
  // (c) play to the end.
  end: () => 'draw',
  // (d) read the tints: turn only when at least half the cards left would
  // raise the win chance (red cards count as falls), i.e. ride the "good"
  // draws and bank before the "bad" ones.
  tints: (k, order) => {
    const p = winChance(k, order);
    const next = nextCards(k, order);
    const up = next.filter((c) => !c.killer && c.after > p).length;
    return up / next.length >= 0.5 ? 'draw' : 'cash';
  },
};

/** Exact expected payout of drawing from `order` under a Markov strategy (memoised by turned set and current card). */
function exactRtp(k: Turns, decide: Decide): number {
  const memo = new Map<number, number>();
  const drawFrom = (order: number[]): number => {
    const mask = maskOf(order);
    const key = order.length === 0 ? -1 : mask * 16 + order[order.length - 1];
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const left = remaining(mask);
    let sum = 0;
    for (const x of left) {
      if (order.length > 0 && onCross(order[order.length - 1], x)) continue;
      const next = [...order, x];
      const l = landed(k, next);
      if (l.kind === 'won' || l.kind === 'dead') sum += l.value;
      else if (l.kind === 'checkpoint' && decide(k, next) === 'cash') sum += l.value;
      else sum += drawFrom(next);
    }
    const v = sum / left.length;
    memo.set(key, v);
    return v;
  };
  return drawFrom([]);
}

/** One simulated round with the game's draw; returns the payout multiplier. */
function playRound(k: Turns, decide: Decide, rng: { next(): number }): number {
  const order: number[] = [];
  for (;;) {
    const card = drawCard(rng.next(), maskOf(order));
    if (order.length > 0 && onCross(order[order.length - 1], card)) return 0;
    order.push(card);
    const l = landed(k, order);
    if (l.kind === 'won' || l.kind === 'dead') return l.value;
    if (l.kind === 'checkpoint' && decide(k, order) === 'cash') return l.value;
  }
}

describe('Cross fairness', () => {
  it('turns every card left with equal chance (drawCard splits [0, 1) into equal cells)', () => {
    const rng = createRng(seededSource(101));
    for (let s = 0; s < 40; s++) {
      const mask = rng.int(1 << 12) & ((1 << 12) - 2); // card 0 always left, so m ≥ 1
      const left = remaining(mask);
      const m = left.length;
      for (let j = 0; j < m; j++) {
        expect(drawCard(j / m, mask)).toBe(left[j]);
        expect(drawCard((j + 1) / m - 1e-12, mask)).toBe(left[j]);
      }
    }
  });

  it('the cash-out is an exact martingale over the next card, at ≥ 30 reachable states per setting', () => {
    const rng = createRng(seededSource(202));
    for (const k of TURNS) {
      // The start: averaging over the free first card gives RTP.
      const first = remaining(0).reduce((s, c) => s + landed(k, [c]).value, 0) / 12;
      expect(first).toBeCloseTo(RTP, 12);
      let states = 0;
      let nearEnd = 0;
      for (let round = 0; states < 40 || nearEnd < 5; round++) {
        expect(round).toBeLessThan(5000);
        const order = [drawCard(rng.next(), 0)];
        for (;;) {
          const l = landed(k, order);
          if (l.kind === 'won' || l.kind === 'dead') break;
          // Every live state (checkpoint or auto-played) must be a fair bet on the next card.
          const v = cashOutFor(k, order);
          const left = remaining(maskOf(order));
          const cur = order[order.length - 1];
          const after = left.reduce((s, x) => s + (onCross(cur, x) ? 0 : landed(k, [...order, x]).value), 0) / left.length;
          expect(Math.abs(after - v)).toBeLessThan(1e-12 * Math.max(1, v));
          states++;
          if (order.length - 1 === k - 1) nearEnd++;
          const card = drawCard(rng.next(), maskOf(order));
          if (onCross(cur, card)) break;
          order.push(card);
        }
      }
    }
  });

  it('every strategy returns exactly RTP (exact recursion over all reachable states)', () => {
    for (const k of TURNS) {
      for (const [name, decide] of Object.entries(STRATEGIES)) {
        const rtp = exactRtp(k, decide);
        expect(Math.abs(rtp - RTP), `${name} k=${k}: ${rtp}`).toBeLessThan(1e-12);
      }
    }
  });

  it('every strategy is within 4 SE of RTP in simulation, for every eval config', () => {
    for (const { params } of evalSpec.configs) {
      for (const [name, decide] of Object.entries(STRATEGIES)) {
        // A light run here (the exact recursion above is the proof); the scratch
        // run <scratchpad>/fairness/cross-strategies.ts plays 1M rounds per strategy and config.
        const rounds = 20_000;
        const rng = createRng(seededSource(params.k * 1000 + name.length));
        let sum = 0;
        let sq = 0;
        for (let i = 0; i < rounds; i++) {
          const m = playRound(params.k, decide, rng);
          sum += m;
          sq += m * m;
        }
        const mean = sum / rounds;
        const se = Math.sqrt((sq / rounds - mean * mean) / rounds);
        expect(Math.abs(mean - RTP), `${name} k=${params.k}: ${mean.toFixed(4)} ± ${se.toFixed(4)}`).toBeLessThan(4 * se + 1e-9);
      }
    }
  });
});
