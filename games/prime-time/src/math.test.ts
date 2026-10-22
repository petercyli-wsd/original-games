import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BETS,
  DIGITS,
  allHidden,
  candidates,
  cashOut,
  coreScale,
  decided,
  digitAt,
  factorize,
  describe as describeN,
  fan,
  fanStat,
  focusView,
  gridView,
  nextHidden,
  regrids,
  hiddenPositions,
  highest,
  hits,
  lowest,
  matches,
  rangeSize,
  reveal,
  startChance,
  startHits,
  valuesAt,
  winChance,
  type Bet,
  type Digits,
  type Revealed,
} from './math';

const rng = createRng(seededSource(11));

// Independent checks: plain trial division and an integer square root, no sieve, no tables.
function primeByTrial(n: number) {
  if (n < 2) return false;
  for (let p = 2; p * p <= n; p++) if (n % p === 0) return false;
  return true;
}
function winsByTrial(bet: Bet, n: number) {
  if (bet === 'prime') return primeByTrial(n);
  if (bet === 'composite') return !primeByTrial(n);
  let r = 0;
  while ((r + 1) * (r + 1) <= n) r++;
  return r * r === n;
}

/** A random reachable state: a random N with a random set of its digits shown. */
function randomState(d: Digits, shown = 1 + rng.int(d - 1)): { n: number; r: Revealed } {
  const n = lowest(d) + rng.int(rangeSize(d));
  let r = allHidden(d);
  for (const pos of rng.shuffle([...Array(d).keys()]).slice(0, shown)) r = reveal(r, pos, digitAt(n, d, pos));
  return { n, r };
}

/** Brute force: every d-digit number matching the pattern, and how many win. */
function enumerate(bet: Bet, r: Revealed) {
  const d = r.length;
  let total = 0;
  let win = 0;
  for (let n = lowest(d); n <= highest(d); n++) {
    if (!matches(r, n)) continue;
    total++;
    if (winsByTrial(bet, n)) win++;
  }
  return { total, win };
}

describe('Prime Time maths', () => {
  it('exact counts: π(10^d) differences and ⌊√hi⌋ − ⌈√lo⌉ + 1 squares', () => {
    const PI = [4, 25, 168, 1229, 9592]; // π(10^k), k = 1…5
    for (const d of DIGITS) {
      const primes = PI[d - 1] - PI[d - 2];
      expect(startHits('prime', d)).toBe(primes);
      expect(startHits('composite', d)).toBe(rangeSize(d) - primes);
      expect(startHits('square', d)).toBe(Math.floor(Math.sqrt(highest(d))) - Math.ceil(Math.sqrt(lowest(d))) + 1);
      for (const bet of BETS) {
        expect(hits(bet, allHidden(d))).toBe(startHits(bet, d));
        expect(enumerate(bet, allHidden(d)).win).toBe(startHits(bet, d));
      }
    }
    expect(startHits('square', 5)).toBe(217);
  });

  it('the headline chance matches a direct simulation of the hidden number', () => {
    for (const bet of BETS) {
      for (const d of DIGITS) {
        const rounds = 20_000;
        let w = 0;
        for (let i = 0; i < rounds; i++) if (winsByTrial(bet, lowest(d) + rng.int(rangeSize(d)))) w++;
        const p = startChance(bet, d);
        expect(Math.abs(w / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-9);
      }
    }
  });

  it('every reveal is a fair bet, whichever digit you pick: E[cash-out after] = cash-out now', () => {
    for (const bet of BETS) {
      for (const d of DIGITS) {
        for (let t = 0; t < 40; t++) {
          const { r } = randomState(d, rng.int(d - 1));
          if (decided(bet, r)) continue;
          const now = cashOut(bet, r);
          for (const pos of hiddenPositions(r)) {
            const vals = valuesAt(pos);
            // Each value is equally likely: every value keeps the same number of candidates.
            for (const v of vals) expect(candidates(reveal(r, pos, v)) * vals.length).toBe(candidates(r));
            // The winners split exactly, so the chance and the cash-out average back to now.
            expect(vals.reduce((s, v) => s + hits(bet, reveal(r, pos, v)), 0)).toBe(hits(bet, r));
            const after = vals.reduce((s, v) => s + cashOut(bet, reveal(r, pos, v)), 0) / vals.length;
            expect(Math.abs(after - now)).toBeLessThan(1e-9);
          }
        }
      }
    }
  });

  it('the lit share of the dot grid is the true chance, dot by dot', () => {
    for (const bet of BETS) {
      for (const d of DIGITS) {
        for (let t = 0; t < (d === 5 ? 3 : 8); t++) {
          const { n, r } = randomState(d, d === 2 ? rng.int(2) : 1 + rng.int(d - 1));
          const truth = enumerate(bet, r);
          expect(candidates(r)).toBe(truth.total);
          expect(hits(bet, r)).toBe(truth.win);
          expect(winChance(bet, r)).toBeCloseTo(truth.win / truth.total, 14);

          const view = gridView(bet, r);
          expect(view.cells.length * view.size).toBe(truth.total);
          expect(view.cells.length).toBeLessThanOrEqual(1000);
          // Every dot stands for the same number of candidates, and its lit core is
          // drawn with area ∝ its winning share, so lit area / total area = P.
          const lit = view.cells.reduce((s, c) => s + coreScale(c) ** 2, 0) / view.cells.length;
          expect(lit).toBeCloseTo(truth.win / truth.total, 12);
          // Spot-check dots against brute force, and the hidden number sits in exactly one dot.
          for (const c of rng.shuffle(view.cells).slice(0, 6)) {
            expect(c.size).toBe(view.size);
            const e = enumerate(bet, c.pattern);
            expect(e.total).toBe(c.size);
            expect(e.win).toBe(c.hits);
          }
          expect(view.cells.filter((c) => matches(c.pattern, n)).length).toBe(1);
          // The bars under each hidden digit average to the dashed "now" line.
          for (const pos of hiddenPositions(r)) {
            const bars = fan(bet, r, pos);
            expect(bars.reduce((s, x) => s + x, 0) / bars.length).toBeCloseTo(winChance(bet, r), 12);
          }
        }
      }
    }
  });

  it('mid-reveal, the surviving dots light up exactly the chance after the reveal', () => {
    for (const bet of BETS) {
      for (const d of DIGITS) {
        for (let t = 0; t < 6; t++) {
          const { n, r } = randomState(d, rng.int(d - 1));
          for (const pos of hiddenPositions(r)) {
            const v = digitAt(n, d, pos);
            const after = reveal(r, pos, v);
            const view = focusView(bet, r, pos, v);
            const alive = view.cells.filter((c) => !c.dead);
            // Same dots as before the reveal (same keys), so the board can animate them in place.
            expect(view.cells.map((c) => c.key)).toEqual(gridView(bet, r).cells.map((c) => c.key));
            expect(alive.reduce((s, c) => s + c.size, 0)).toBe(candidates(after));
            expect(alive.reduce((s, c) => s + c.hits, 0)).toBe(hits(bet, after));
            // Every surviving dot holds the same count, so their lit area share is the new chance.
            for (const c of alive) expect(c.size).toBe(alive[0].size);
            const lit = alive.reduce((s, c) => s + coreScale(c) ** 2, 0) / alive.length;
            expect(lit).toBeCloseTo(winChance(bet, after), 12);
            // A folded digit keeps every dot; an axis digit keeps one slice of them.
            expect(alive.length).toBe(view.folded.includes(pos) ? view.cells.length : view.cells.length / valuesAt(pos).length);
            // The grid is only replaced (rather than morphed) when a folded digit moves up to an axis.
            expect(regrids(r, pos)).toBe(hiddenPositions(r).length > 3 && !view.folded.includes(pos));
          }
        }
      }
    }
  });

  it('the red and green shares under each digit are its true bust and instant-win chances', () => {
    for (const bet of BETS) {
      for (const d of [2, 3, 4] as Digits[]) {
        for (let t = 0; t < 6; t++) {
          const { r } = randomState(d, rng.int(d - 1));
          if (decided(bet, r)) continue;
          for (const pos of hiddenPositions(r)) {
            // Brute force: group the candidates by the digit they show at pos, then count
            // the candidates whose group has no winner (bust) or only winners (sure win).
            const groups = new Map<number, { total: number; win: number }>();
            let total = 0;
            for (let n = lowest(d); n <= highest(d); n++) {
              if (!matches(r, n)) continue;
              total++;
              const g = groups.get(digitAt(n, d, pos)) ?? { total: 0, win: 0 };
              g.total++;
              if (winsByTrial(bet, n)) g.win++;
              groups.set(digitAt(n, d, pos), g);
            }
            let bust = 0;
            let sure = 0;
            for (const g of groups.values()) {
              if (g.win === 0) bust += g.total;
              if (g.win === g.total) sure += g.total;
            }
            const f = fanStat(bet, r, pos);
            expect(f.bust).toBeCloseTo(bust / total, 12);
            expect(f.sure).toBeCloseTo(sure / total, 12);
          }
        }
      }
    }
  });

  it('the next-digit marker walks right and wraps', () => {
    expect(nextHidden([1, null, 3, null], 1)).toBe(3);
    expect(nextHidden([1, null, 3, null], 3)).toBe(1);
    expect(nextHidden([1, 2, 3], 0)).toBe(null);
  });

  it('a round ends exactly when the outcome is certain', () => {
    // A 2-digit number ending in 4 is never prime and always "not prime".
    const r = reveal(allHidden(2), 1, 4);
    expect(decided('prime', r)).toBe('lost');
    expect(decided('composite', r)).toBe('won');
    expect(cashOut('composite', r)).toBeCloseTo(manifest.rtp / startChance('composite', 2), 12);
    // Once every digit is shown the verdict is the number itself.
    for (let t = 0; t < 200; t++) {
      const d = DIGITS[rng.int(4)];
      const { n, r: full } = randomState(d, d);
      for (const bet of BETS) expect(decided(bet, full)).toBe(winsByTrial(bet, n) ? 'won' : 'lost');
    }
  });

  it('factorisations multiply back, and the end-of-round verdict names the right kind of number', () => {
    for (let t = 0; t < 300; t++) {
      const n = 10 + rng.int(99_990);
      const f = factorize(n);
      expect(f.reduce((s, [p, e]) => s * p ** e, 1)).toBe(n);
      for (const [p] of f) expect(primeByTrial(p)).toBe(true);
    }
    expect(describeN(97)).toBe('97 is prime');
    expect(describeN(4761)).toBe('4761 = 69²');
    expect(describeN(520)).toBe('520 = 2³ × 5 × 13');
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
