import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  ALL_BETS,
  DECKS,
  MAX_MULTIPLIER,
  RTP,
  cashValue,
  columnsFor,
  decided,
  ended,
  factorial,
  finalCounts,
  forecast,
  ghosts,
  newDeal,
  newPileCards,
  place,
  prizeFor,
  risingRun,
  shelfOf,
  startChance,
  topsOf,
  winChance,
  winCount,
  winsAt,
  type Bet,
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
function randomDeal(n: number, dealt: number): Deal {
  let d = newDeal(n);
  for (let i = 0; i < dealt; i++) d = place(d, d.remaining[rng.int(d.remaining.length)]);
  return d;
}

describe('Patience maths', () => {
  it('patience sorting makes exactly as many piles as the longest increasing subsequence', () => {
    for (let t = 0; t < 400; t++) {
      const seq = rng.shuffle(Array.from({ length: 12 }, (_, i) => i + 1));
      expect(piles(seq)).toBe(lis(seq));
      // The drawn rising run is a real increasing subsequence of that length.
      let d = newDeal(12);
      const cut = 1 + rng.int(12);
      for (const c of seq.slice(0, cut)) d = place(d, c);
      const run = risingRun(d);
      expect(run.length).toBe(d.piles.length);
      expect(run.length).toBe(lis(seq.slice(0, cut)));
      run.forEach((c, i) => {
        expect(d.piles[i]).toContain(c);
        if (i > 0) {
          expect(c).toBeGreaterThan(run[i - 1]);
          expect(seq.indexOf(c)).toBeGreaterThan(seq.indexOf(run[i - 1]));
        }
      });
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
    for (const n of [9, 10, 12]) {
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
    const bets: Bet[] = [
      { n: 8, mode: 'fit', k: 3 },
      { n: 10, mode: 'fit', k: 4 },
      { n: 10, mode: 'reach', k: 6 },
      { n: 12, mode: 'fit', k: 3 },
      { n: 12, mode: 'reach', k: 7 },
    ];
    for (const bet of bets) {
      const rounds = 30_000;
      let wins = 0;
      const deck = Array.from({ length: bet.n }, (_, i) => i + 1);
      for (let r = 0; r < rounds; r++) if (winsAt(bet, piles(rng.shuffle(deck)))) wins++;
      const p = startChance(bet);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
    }
  });

  it('live odds from any state match brute force over every order of the cards left', () => {
    for (let t = 0; t < 30; t++) {
      const n = DECKS[t % 3];
      const d = randomDeal(n, n - 6 - (t % 2));
      const order = d.piles.flat().length;
      expect(order).toBe(n - d.remaining.length);
      const counts = new Array<number>(n + 1).fill(0);
      for (const p of permutations(d.remaining.length)) {
        let s = d;
        for (const i of p) s = place(s, d.remaining[i - 1]);
        counts[s.piles.length]++;
      }
      const exact = finalCounts(d);
      for (let f = 0; f <= n; f++) expect(exact[f] ?? 0).toBe(counts[f]);
    }
  });

  it('martingale: the counts split exactly over the next card, and E[cash-out after] = cash-out now', () => {
    for (const bet of ALL_BETS) {
      for (let t = 0; t < 6; t++) {
        const d = randomDeal(bet.n, rng.int(bet.n - 1));
        if (ended(bet, d)) continue;
        const now = winCount(bet, d);
        let sumWin = 0;
        let sumTotal = 0;
        let sumCash = 0;
        for (const c of d.remaining) {
          const next = winCount(bet, place(d, c));
          sumWin += next.win;
          sumTotal += next.total;
          sumCash += cashValue(bet, place(d, c));
        }
        expect(sumWin).toBe(now.win);
        expect(sumTotal).toBe(now.total);
        expect(sumCash / d.remaining.length).toBeCloseTo(cashValue(bet, d), 9);
      }
      expect(cashValue(bet, newDeal(bet.n))).toBeCloseTo(RTP, 12);
    }
  });

  it('what is drawn is the true risk: lit deck cards, landing rings, forecast bars', () => {
    for (const bet of ALL_BETS) {
      for (let t = 0; t < 5; t++) {
        const d = randomDeal(bet.n, rng.int(bet.n - 1));
        if (ended(bet, d)) continue;
        const shelf = shelfOf(d);
        const lit = newPileCards(d);
        const g = ghosts(bet, d);
        // Sweep every card left by actually dealing it.
        let opened = 0;
        for (const ghost of g) {
          const after = place(d, ghost.card);
          const pile = after.piles.findIndex((p) => p[p.length - 1] === ghost.card);
          expect(pile).toBe(ghost.pile);
          const opens = after.piles.length > d.piles.length;
          expect(ghost.opens).toBe(opens);
          expect(opens).toBe(ghost.card > shelf);
          if (opens) opened++;
          expect(ghost.chance).toBe(winChance(bet, after));
        }
        // Lit cards in the deck are exactly the ones that open a pile.
        expect(lit.length).toBe(opened);
        // The rings average to the win chance now.
        expect(g.reduce((a, x) => a + x.chance, 0) / g.length).toBeCloseTo(winChance(bet, d), 12);
        // If any card left is above the top shelf, another pile is certain.
        if (lit.length > 0) {
          const counts = finalCounts(d);
          expect(counts[d.piles.length] ?? 0).toBe(0);
        }
        // Forecast bars: they sum to 1 and the win columns sum to the win chance.
        const bars = forecast(bet, d);
        expect(bars.length).toBe(columnsFor(bet));
        expect(bars.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        const green = bars.reduce((a, b, j) => a + (winsAt(bet, j + 1) ? b : 0), 0);
        expect(green).toBeCloseTo(winChance(bet, d), 12);
        expect(topsOf(d).every((x, i, a) => i === 0 || a[i - 1] < x)).toBe(true);
      }
    }
  });

  it('a decided round has exactly 0 or 1 to win, and the natural end is always decided', () => {
    for (const bet of ALL_BETS) {
      for (let t = 0; t < 8; t++) {
        let d = newDeal(bet.n);
        while (!ended(bet, d)) d = place(d, d.remaining[rng.int(d.remaining.length)]);
        const won = winsAt(bet, d.piles.length) && (bet.mode === 'reach' || d.remaining.length === 0);
        expect(decided(bet, d)).toBe(won ? 'won' : 'lost');
        expect(winChance(bet, d)).toBe(won ? 1 : 0);
      }
    }
  });

  it('no cash-out can exceed the largest prize on offer', () => {
    expect(Math.max(...ALL_BETS.map(prizeFor))).toBe(MAX_MULTIPLIER);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    for (const bet of ALL_BETS) {
      expect(startChance(bet)).toBeGreaterThan(0);
      const p = startChance(bet);
      expect(prizeFor(bet) * p).toBeCloseTo(RTP, 12);
    }
  });

  it('simulated RTP matches the manifest under mixed stopping rules', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
