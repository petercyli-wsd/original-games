import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MAX_MULTIPLIER,
  MIN_CHANCE_INV,
  N,
  RTP,
  START,
  VOLATILITY,
  WIDTHS,
  allGates,
  cardsLeft,
  choose,
  downRightChance,
  headline,
  inGate,
  landings,
  mirror,
  placeGate,
  positions,
  prizeFor,
  rowOf,
  sealed,
  step,
  tally,
  validGate,
  volatilityOf,
  winChance,
  type Gate,
  type Pos,
} from './math';

const rng = createRng(seededSource(11));

/** A random state the game can reach: a random valid gate and some cards dealt, round unsealed. */
function reachable(): { gate: Gate; pos: Pos } {
  const gates = allGates();
  for (;;) {
    const gate = gates[rng.int(gates.length)];
    let pos = START;
    const k = rng.int(N);
    for (let i = 0; i < k && sealed(pos, gate) === null; i++) pos = step(pos, rng);
    if (sealed(pos, gate) === null) return { gate, pos };
  }
}

/** Every order of the whole deck (which of the 2N places hold the ↘ cards), as 0/1 arrays. */
function allDecks(): number[][] {
  const out: number[][] = [];
  const walk = (acc: number[], ones: number) => {
    if (acc.length === 2 * N) return void (ones === N && out.push(acc));
    if (ones < N) walk([...acc, 1], ones + 1);
    if (acc.length - ones < N) walk([...acc, 0], ones);
  };
  walk([], 0);
  return out;
}

describe('Pascal maths', () => {
  it('the landing counts add up to every deal left, and from the start they are C(N, a)²', () => {
    expect(choose(12, 6)).toBe(924);
    const start = landings(START);
    for (const l of start) expect(l.count).toBe(choose(N, l.a) ** 2);
    for (let trial = 0; trial < 200; trial++) {
      const { pos } = reachable();
      const { down } = cardsLeft(pos);
      const sum = landings(pos).reduce((s, l) => s + l.count, 0);
      expect(sum).toBe(choose(down, N - rowOf(pos)));
    }
  });

  it('exact enumeration of every deck order: the share that lands in the gate is the formula, from any state', () => {
    const decks = allDecks();
    expect(decks.length).toBe(choose(2 * N, N));
    const landOf = (d: number[]) => d.slice(0, N).reduce((s, x) => s + x, 0);
    for (const g of allGates()) {
      const through = decks.filter((d) => inGate(g, landOf(d))).length;
      expect(tally(START, g)).toEqual({ through, total: decks.length });
    }
    // From reachable states: condition on the cards dealt so far (any one order with those counts).
    for (let trial = 0; trial < 60; trial++) {
      const { gate, pos } = reachable();
      const r = rowOf(pos);
      const prefix = [...Array(pos.a).fill(1), ...Array(pos.b).fill(0)];
      const match = decks.filter((d) => d.slice(0, r).every((x, i) => x === prefix[i]));
      const through = match.filter((d) => inGate(gate, landOf(d))).length;
      // Each deal of the next N − r cards is shared by the same number of tails, so the ratio is exact.
      expect(through / match.length).toBe(winChance(pos, gate));
    }
  });

  it('closed form matches a direct simulation: shuffle the deck, deal N cards, and also the card-by-card rule', () => {
    const cases: Gate[] = [VOLATILITY.low, VOLATILITY.medium, VOLATILITY.high, { lo: 0, width: 3 }, { lo: 4, width: 2 }];
    const rounds = 20_000;
    const deck = [...Array(N).fill(1), ...Array(N).fill(0)];
    for (const gate of cases) {
      const p = headline(gate);
      const se = 4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-9;
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        const moves = rng.shuffle(deck);
        let a = 0;
        for (let i = 0; i < N; i++) a += moves[i];
        if (inGate(gate, a)) wins++;
      }
      expect(Math.abs(wins / rounds - p)).toBeLessThan(se);
      wins = 0;
      for (let r = 0; r < rounds; r++) {
        let pos = START;
        while (rowOf(pos) < N) pos = step(pos, rng);
        if (inGate(gate, pos.a)) wins++;
      }
      expect(Math.abs(wins / rounds - p)).toBeLessThan(se);
    }
  });

  it('the card rule makes every deck order equally likely: product of card chances = 1 / C(2N, N)', () => {
    for (let trial = 0; trial < 100; trial++) {
      let pos = START;
      let prob = 1;
      while (pos.a < N || pos.b < N) {
        const q = downRightChance(pos);
        const next = step(pos, rng);
        prob *= next.a > pos.a ? q : 1 - q;
        pos = next;
      }
      expect(prob * choose(2 * N, N)).toBeCloseTo(1, 10);
    }
  });

  it('martingale: at random reachable states, E[cash-out after one card] = cash-out now', () => {
    for (let trial = 0; trial < 1000; trial++) {
      const { gate, pos } = reachable();
      const prize = prizeFor(gate);
      const q = downRightChance(pos);
      const now = prize * winChance(pos, gate);
      const after = q * prize * winChance({ a: pos.a + 1, b: pos.b }, gate) + (1 - q) * prize * winChance({ a: pos.a, b: pos.b + 1 }, gate);
      expect(Math.abs(after - now)).toBeLessThan(1e-12 * Math.max(1, now));
      expect(now).toBeLessThanOrEqual(prize + 1e-12);
    }
  });

  it('what the board draws is the true risk: the bar’s green share and the cards left', () => {
    for (let trial = 0; trial < 300; trial++) {
      const { gate, pos } = reachable();
      const bar = landings(pos).filter((l) => l.count > 0);
      const total = bar.reduce((s, l) => s + l.count, 0);
      const green = bar.filter((l) => inGate(gate, l.a)).reduce((s, l) => s + l.count, 0);
      expect(green / total).toBe(winChance(pos, gate));
      // The next card's chance is literally the cards left: ↘ cards over all cards.
      const { right, left } = cardsLeft(pos);
      expect(right).toBe(N - pos.a);
      expect(left).toBe(N - pos.b);
      expect(downRightChance(pos)).toBe(right / (right + left));
      // Sealed exactly when the bar is all green or has no green.
      expect(sealed(pos, gate)).toBe(null);
      expect(green > 0 && green < total).toBe(true);
    }
    // The bar's pieces from the start are the bottom tiles' chances: 1, 36, 225, 400, 225, 36, 1 of 924.
    expect(landings(START).map((l) => l.count)).toEqual([1, 36, 225, 400, 225, 36, 1]);
  });

  it('gates: under half the row, at least 1 in 2,000, mirror-symmetric, width+position span ≥ 25:1, and the max prize is honest', () => {
    let maxPrize = 0;
    let lo = 1;
    let hi = 0;
    for (const w of WIDTHS) {
      const pos = positions(w);
      for (let i = 1; i < pos.length; i++) expect(pos[i]).toBe(pos[i - 1] + 1);
      expect(2 * w).toBeLessThan(N + 1);
    }
    for (const g of allGates()) {
      expect(validGate(g)).toBe(true);
      const p = headline(g);
      expect(p).toBeLessThan(1);
      expect(p * MIN_CHANCE_INV).toBeGreaterThanOrEqual(1 - 1e-12);
      expect(headline(mirror(g))).toBe(p);
      expect(placeGate(g.width, g.lo + (g.width - 1) / 2)).toEqual(g);
      maxPrize = Math.max(maxPrize, prizeFor(g));
      lo = Math.min(lo, p);
      hi = Math.max(hi, p);
    }
    expect(hi / lo).toBeGreaterThan(25);
    expect(maxPrize).toBe(MAX_MULTIPLIER);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP * 924, 9);
    expect(volatilityOf(headline(VOLATILITY.low))).toBe('low');
    expect(volatilityOf(headline(VOLATILITY.medium))).toBe('medium');
    expect(volatilityOf(headline(VOLATILITY.high))).toBe('high');
    expect(volatilityOf(headline(VOLATILITY.extreme))).toBe('extreme');
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
