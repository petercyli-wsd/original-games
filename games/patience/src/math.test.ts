import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  K_OPTIONS,
  MAX_MULTIPLIER,
  N,
  RTP,
  VOLATILITY,
  cashValue,
  catchBands,
  decided,
  ended,
  factorial,
  finalCounts,
  newDeal,
  newPileCards,
  place,
  prizeFor,
  shelfOf,
  startChance,
  topsOf,
  winChance,
  winCount,
  type Deal,
} from './math';

const rng = createRng(seededSource(11));

/** Raw patience sorting of a sequence: the number of piles. */
function piles(seq: readonly number[]): number {
  const tops: number[] = [];
  for (const c of seq) {
    const j = tops.findIndex((t) => t > c);
    if (j < 0) tops.push(c);
    else tops[j] = c;
  }
  return tops.length;
}

/** Longest increasing subsequence by the O(n²) definition. */
function lis(seq: readonly number[]): number {
  const best = seq.map(() => 1);
  for (let i = 0; i < seq.length; i++) for (let j = 0; j < i; j++) if (seq[j] < seq[i]) best[i] = Math.max(best[i], best[j] + 1);
  return Math.max(0, ...best);
}

function permutations(n: number): number[][] {
  if (n === 0) return [[]];
  const out: number[][] = [];
  for (const p of permutations(n - 1)) for (let i = 0; i <= p.length; i++) out.push([...p.slice(0, i), n, ...p.slice(i)]);
  return out;
}

/** Partitions of n, largest part first. */
function partitions(n: number, max = n): number[][] {
  if (n === 0) return [[]];
  const out: number[][] = [];
  for (let first = Math.min(n, max); first >= 1; first--) for (const rest of partitions(n - first, first)) out.push([first, ...rest]);
  return out;
}

/** Standard Young tableaux of shape λ, by the hook length formula. */
function hookCount(shape: number[]): number {
  const n = shape.reduce((a, b) => a + b, 0);
  const cols = shape[0];
  const colLen = Array.from({ length: cols }, (_, j) => shape.filter((r) => r > j).length);
  let hooks = 1;
  shape.forEach((row, i) => {
    for (let j = 0; j < row; j++) hooks *= row - j - 1 + (colLen[j] - i - 1) + 1;
  });
  return factorial(n) / hooks;
}

/** A random reachable state: a few cards dealt from a fresh shuffle. */
function randomDeal(dealt: number): Deal {
  let d = newDeal();
  for (let i = 0; i < dealt; i++) d = place(d, d.remaining[rng.int(d.remaining.length)]);
  return d;
}

describe('Patience maths', () => {
  it('patience sorting makes exactly as many piles as the longest increasing subsequence', () => {
    for (let t = 0; t < 400; t++) {
      const seq = rng.shuffle(Array.from({ length: N }, (_, i) => i + 1));
      expect(piles(seq)).toBe(lis(seq));
      let d = newDeal();
      for (const c of seq) d = place(d, c);
      expect(d.piles.length).toBe(lis(seq));
      expect(topsOf(d).every((x, i, a) => i === 0 || a[i - 1] < x)).toBe(true);
    }
  });

  it('exact counts match brute force over every shuffle (n ≤ 8)', () => {
    for (let n = 1; n <= 8; n++) {
      const brute = new Array<number>(n + 1).fill(0);
      for (const p of permutations(n)) brute[piles(p)]++;
      const counts = finalCounts(newDeal(n));
      for (let f = 0; f <= n; f++) expect(counts[f] ?? 0).toBe(brute[f]);
    }
  });

  it('exact counts match Robinson–Schensted: Σ f_λ² over shapes with first row ℓ', () => {
    for (const n of [9, N]) {
      const rsk = new Array<number>(n + 1).fill(0);
      for (const shape of partitions(n)) rsk[shape[0]] += hookCount(shape) ** 2;
      const counts = finalCounts(newDeal(n));
      for (let f = 0; f <= n; f++) expect(counts[f] ?? 0).toBe(rsk[f]);
      // At most two piles: Catalan(n).
      const catalan = factorial(2 * n) / (factorial(n) * factorial(n + 1));
      expect((counts[1] ?? 0) + (counts[2] ?? 0)).toBeCloseTo(catalan, 0);
    }
  });

  it('the headline win chance matches a direct simulation of shuffling and sorting', () => {
    const deck = Array.from({ length: N }, (_, i) => i + 1);
    for (const k of K_OPTIONS) {
      const rounds = 30_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) if (piles(rng.shuffle(deck)) <= k) wins++;
      const p = startChance(k);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
    }
  });

  it('live odds from any state match brute force over every order of the cards left', () => {
    for (let t = 0; t < 30; t++) {
      const d = randomDeal(N - 6 - (t % 2));
      const counts = new Array<number>(N + 1).fill(0);
      for (const p of permutations(d.remaining.length)) {
        let s = d;
        for (const i of p) s = place(s, d.remaining[i - 1]);
        counts[s.piles.length]++;
      }
      const exact = finalCounts(d);
      for (let f = 0; f <= N; f++) expect(exact[f] ?? 0).toBe(counts[f]);
    }
  });

  it('martingale: the counts split exactly over the next card, and E[cash-out after] = cash-out now', () => {
    for (const k of K_OPTIONS) {
      for (let t = 0; t < 25; t++) {
        const d = randomDeal(rng.int(N - 1));
        if (ended(k, d)) continue;
        const now = winCount(k, d);
        let sumWin = 0;
        let sumTotal = 0;
        let sumCash = 0;
        for (const c of d.remaining) {
          const next = place(d, c);
          const w = winCount(k, next);
          sumWin += w.win;
          sumTotal += w.total;
          sumCash += cashValue(k, next);
        }
        expect(sumWin).toBe(now.win);
        expect(sumTotal).toBe(now.total);
        expect(sumCash / d.remaining.length).toBeCloseTo(cashValue(k, d), 9);
      }
      expect(cashValue(k, newDeal())).toBeCloseTo(RTP, 12);
    }
  });

  it('what is drawn is the true risk: the marked deck cards are exactly the ones that open a pile', () => {
    for (const k of K_OPTIONS) {
      for (let t = 0; t < 25; t++) {
        const d = randomDeal(rng.int(N - 1));
        if (ended(k, d)) continue;
        const shelf = shelfOf(d);
        const marked = new Set(newPileCards(d));
        // Sweep every card left by actually dealing it.
        let opened = 0;
        for (const c of d.remaining) {
          const opens = place(d, c).piles.length > d.piles.length;
          expect(marked.has(c)).toBe(opens);
          expect(opens).toBe(c > shelf);
          if (opens) opened++;
        }
        // The count shown over the cards left is the chance the next card opens a pile.
        expect(marked.size / d.remaining.length).toBe(opened / d.remaining.length);
        // If any card left is above the shelf, another pile is certain.
        if (marked.size > 0) expect(finalCounts(d)[d.piles.length] ?? 0).toBe(0);
        // So with k piles open, a marked card means the round is already lost.
        if (d.piles.length === k && marked.size > 0) expect(decided(k, d)).toBe('lost');
      }
    }
  });

  it('the catch bands cut 1..n into one band per pile plus the red new-pile band, and every card lands on its band', () => {
    for (let t = 0; t < 300; t++) {
      const d = randomDeal(rng.int(N));
      const bands = catchBands(d);
      expect(bands.length).toBe(d.piles.length + 1);
      // The bands tile the values 1..n, bottom to top, with no gaps or overlaps.
      let next = 1;
      for (const b of bands) {
        expect(b.lo).toBe(next);
        next = b.hi + 1;
        // Band j stops just under pile j's top, so the tops fill the gaps.
        if (b.pile < d.piles.length) next++;
      }
      expect(next).toBe(N + 1);
      // Deal every card left: it lands on the pile whose band holds it.
      for (const c of d.remaining) {
        const b = bands.find((x) => x.lo <= c && c <= x.hi);
        expect(b).toBeDefined();
        const after = place(d, c);
        const j = after.piles.findIndex((p) => p[p.length - 1] === c);
        expect(j).toBe(b!.pile);
        // The red band is exactly the cards that open a pile.
        expect(b!.pile === d.piles.length).toBe(newPileCards(d).includes(c));
        // A card that lands on the last pile grows the red band down to just above it.
        if (j === d.piles.length - 1) expect(catchBands(after)[after.piles.length].lo).toBe(c + 1);
      }
    }
  });

  it('a decided round has exactly 0 or 1 to win, and the natural end is always decided', () => {
    for (const k of K_OPTIONS) {
      for (let t = 0; t < 20; t++) {
        let d = newDeal();
        while (!ended(k, d)) d = place(d, d.remaining[rng.int(d.remaining.length)]);
        const won = d.piles.length <= k;
        expect(decided(k, d)).toBe(won ? 'won' : 'lost');
        expect(winChance(k, d)).toBe(won ? 1 : 0);
        // A loss ends the moment pile k+1 opens, never later.
        if (!won) expect(d.piles.length).toBe(k + 1);
      }
    }
  });

  it('one knob: k moves the win chance by more than 25:1, and no cash-out exceeds the largest prize', () => {
    const chances = K_OPTIONS.map(startChance);
    expect(Math.max(...chances) / Math.min(...chances)).toBeGreaterThan(25);
    expect(Object.values(VOLATILITY).sort()).toEqual([...K_OPTIONS]);
    expect(Math.max(...K_OPTIONS.map(prizeFor))).toBe(MAX_MULTIPLIER);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    for (const k of K_OPTIONS) expect(prizeFor(k) * startChance(k)).toBeCloseTo(RTP, 12);
  });

  it('simulated RTP matches the manifest under mixed stopping rules', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
