import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  CARDS,
  MAX_MULTIPLIER,
  RTP,
  TURNS,
  bit,
  cashOutFor,
  chance,
  colOf,
  drawCard,
  nextCards,
  onCross,
  prizeFor,
  remaining,
  rowOf,
  safeShare,
  startChance,
  turnsLeft,
  winChance,
  type Turns,
} from './math';

const rng = createRng(seededSource(23));

/** A uniformly shuffled 12-card deck (Fisher–Yates on the test RNG). */
function shuffled(cards: number[]): number[] {
  const a = [...cards];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A random reachable mid-round state: the first card plus some safe turns, still undecided. */
function randomState(k: Turns): number[] | null {
  const order = [rng.int(CARDS)];
  const stopAt = rng.int(k);
  while (order.length - 1 < stopAt) {
    const mask = order.reduce((a, c) => a | bit(c), 0);
    const safe = remaining(mask).filter((x) => !onCross(order[order.length - 1], x));
    if (safe.length === 0) return null;
    order.push(safe[rng.int(safe.length)]);
  }
  return order;
}

describe('Cross maths', () => {
  it('the card figures: 54.5%, 27.3%, 13.9%, 3.9%, 0.67% for 1, 2, 3, 5, 8 turns', () => {
    expect(startChance(1)).toBeCloseTo(6 / 11, 14);
    expect(startChance(2)).toBeCloseTo(3 / 11, 14);
    const want = [0.5455, 0.2727, 0.1394, 0.0391, 0.00666];
    TURNS.forEach((k, i) => expect(Math.abs(startChance(k) - want[i])).toBeLessThan(5e-5));
    expect(startChance(1) / startChance(8)).toBeGreaterThan(25);
  });

  it('the grid is 3 colours by 4 shapes, and a cross is the 5 cards sharing a row or column', () => {
    for (let c = 0; c < CARDS; c++) {
      const cross = Array.from({ length: CARDS }, (_, x) => x).filter((x) => onCross(c, x));
      expect(cross.length).toBe(5);
      for (const x of cross) expect(rowOf(x) === rowOf(c) || colOf(x) === colOf(c)).toBe(true);
    }
  });

  it('the start chance is the same whichever card comes first (grid symmetry)', () => {
    for (const k of TURNS) for (let c = 0; c < CARDS; c++) expect(chance(k, bit(c), c)).toBeCloseTo(startChance(k), 14);
  });

  it('the exact win chance matches a direct simulation of a shuffled deck', () => {
    const all = Array.from({ length: CARDS }, (_, i) => i);
    for (const k of TURNS) {
      const rounds = 60_000;
      let wins = 0;
      for (let t = 0; t < rounds; t++) {
        const deck = shuffled(all);
        let ok = true;
        for (let i = 1; i <= k && ok; i++) ok = !onCross(deck[i - 1], deck[i]);
        if (ok) wins++;
      }
      const p = startChance(k);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
    }
  });

  it('mid-round win chances match a simulation of the rest of the deck', () => {
    let checked = 0;
    while (checked < 12) {
      const k: Turns = 5;
      const order = randomState(k);
      if (!order || order.length < 3) continue;
      checked++;
      const mask = order.reduce((a, c) => a | bit(c), 0);
      const rest = remaining(mask);
      const t = turnsLeft(k, order.length);
      const rounds = 20_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        const deck = [order[order.length - 1], ...shuffled(rest)];
        let ok = true;
        for (let i = 1; i <= t && ok; i++) ok = !onCross(deck[i - 1], deck[i]);
        if (ok) wins++;
      }
      const p = winChance(k, order);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
    }
  });

  it('martingale: averaged over the next card, the cash-out after equals the cash-out now', () => {
    for (const k of TURNS) {
      for (let n = 0; n < 300; n++) {
        const order = randomState(k);
        if (!order) continue;
        const now = cashOutFor(k, order);
        const opts = nextCards(k, order);
        const after = opts.reduce((a, o) => a + (o.killer ? 0 : cashOutFor(k, [...order, o.card])), 0) / opts.length;
        expect(Math.abs(after - now)).toBeLessThan(1e-12 * Math.max(1, now));
        // The tints on the board are these after-values; their average is the win chance now.
        expect(opts.reduce((a, o) => a + o.after, 0) / opts.length).toBeCloseTo(winChance(k, order), 14);
        // No draw is offered at certain loss: a live state always has a card that keeps a chance.
        if (winChance(k, order) > 0) expect(opts.some((o) => o.after > 0)).toBe(true);
      }
    }
  });

  it('the green count on the board is the true chance the next card is safe', () => {
    for (const k of TURNS) {
      for (let n = 0; n < 200; n++) {
        const order = randomState(k);
        if (!order) continue;
        const mask = order.reduce((a, c) => a | bit(c), 0);
        const { safe, left } = safeShare(order);
        const opts = nextCards(k, order);
        expect(opts.length).toBe(left);
        expect(opts.filter((o) => !o.killer).length).toBe(safe);
        // Sweep the draw's uniform input: the share landing off the cross is safe / left.
        const N = left * 50;
        let hits = 0;
        for (let i = 0; i < N; i++) if (!onCross(order[order.length - 1], drawCard((i + 0.5) / N, mask))) hits++;
        expect(hits / N).toBeCloseTo(safe / left, 14);
      }
    }
  });

  it('the draw is uniform over the cards left and never repeats a card', () => {
    const mask = bit(0) | bit(5) | bit(11);
    const left = remaining(mask);
    const counts = new Map<number, number>();
    const N = left.length * 1000;
    for (let i = 0; i < N; i++) {
      const c = drawCard((i + 0.5) / N, mask);
      expect(mask & bit(c)).toBe(0);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    for (const c of left) expect(counts.get(c)).toBe(1000);
    expect(drawCard(0.999999999, mask)).toBe(left[left.length - 1]);
  });

  it('the cash-out starts at the RTP, a full win pays the prize, and the bound holds', () => {
    for (const k of TURNS) {
      expect(cashOutFor(k, [4])).toBeCloseTo(RTP, 12);
      expect(prizeFor(k) * startChance(k)).toBeCloseTo(RTP, 14);
    }
    expect(MAX_MULTIPLIER).toBeCloseTo(prizeFor(8), 12);
    expect(manifest.maxMultiplier).toBeGreaterThanOrEqual(Math.max(...TURNS.map(prizeFor)) - 1e-12);
  });

  it('simulated RTP matches the manifest under mixed strategies, with enough spread in volatility', () => {
    const reports = runEval(evalSpec, { rounds: 60_000 });
    for (const r of reports) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
    }
    expect(reports[reports.length - 1].stdDev).toBeGreaterThan(5 * reports[0].stdDev);
  });
});
