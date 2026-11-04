// Fairness audit: can any way of playing Prime Time beat the RTP?
//
// N is drawn uniformly from the d-digit numbers when the bet is placed. Bet
// reveals a first digit (the player picks which one before betting); after
// that, at every checkpoint the player either cashes out at
// prize × hits/candidates or opens any hidden digit. Backing and digit count
// are locked while live. A reveal that leaves no winner pays 0, one that
// leaves only winners pays the prize at once. So the decisions are (1) which
// digit to open, at every step including the first, and (2) when to stop.
//
// The digits of a uniform d-digit number are independent and uniform (leading
// 1–9, others 0–9), so the candidates are a product set and every value of a
// hidden digit is equally likely. The martingale check therefore enumerates
// the next event exactly: for every hidden digit, the mean of the cash-out
// over its 9 or 10 values must equal the cash-out now. The winner counts are
// also checked against a brute-force count over every d-digit number.
//
// Strategies, per eval config: (a) the tester's: open the digit with the
// lowest bust share if its survival is ≥ 80%, else cash out; (b) cash out the
// moment the cash-out is above the stake (opening the safest digit until
// then); (c) open every digit, left to right and in random order; (d1) hunt
// instant wins (open the digit with the largest "only winners left" share,
// cash out at ≥ 1.5× or when every digit busts ≥ 50%); (d2) open the digit
// whose fan has the largest variance and stop once in profit; (d3) always open
// the riskiest digit and stop once in profit. Each rule is valued EXACTLY by
// recursion over every digit pattern (equivalent to playing all 9·10^(d−1)
// numbers), and also played as Monte Carlo rounds with the host RNG. On the
// square configs the prize is 400×+, so the Monte Carlo SE can't reach 0.3%;
// the exact value is the binding check there.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  BETS,
  DIGITS,
  MAX_MULTIPLIER,
  RTP,
  allHidden,
  candidates,
  cashOut,
  decided,
  digitAt,
  fanStat,
  hiddenPositions,
  highest,
  hits,
  lowest,
  matches,
  prize,
  rangeSize,
  reveal,
  startHits,
  valuesAt,
  wins,
  type Bet,
  type Digits,
  type Revealed,
} from './math';

/** Rounds per strategy run; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 4_000);

const keyOf = (r: Revealed) => r.map((v) => (v === null ? '*' : v)).join('');
const isStart = (r: Revealed) => r.every((v) => v === null);

/** What the player does at a state: cash out, or open one of these digits (uniformly at random among them). */
type Choice = 'cash' | number[];
type Strategy = (bet: Bet, r: Revealed) => Choice;

const fans = (bet: Bet, r: Revealed) => hiddenPositions(r).map((p) => fanStat(bet, r, p));
const argBy = (bet: Bet, r: Revealed, score: (f: ReturnType<typeof fanStat>) => number) => {
  const fs = fans(bet, r);
  let best = fs[0];
  for (const f of fs) if (score(f) > score(best)) best = f;
  return best;
};
const variance = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
};

const STRATEGIES: { name: string; s: Strategy }[] = [
  {
    name: '(a) tester: open safest digit if survival ≥ 80%, else cash',
    s: (bet, r) => {
      const f = argBy(bet, r, (x) => -x.bust);
      return isStart(r) || 1 - f.bust >= 0.8 ? [f.pos] : 'cash';
    },
  },
  {
    name: '(b) cash out the moment value > stake',
    s: (bet, r) => (!isStart(r) && cashOut(bet, r) > 1 ? 'cash' : [argBy(bet, r, (x) => -x.bust).pos]),
  },
  { name: '(c1) open every digit, left to right', s: (_b, r) => [hiddenPositions(r)[0]] },
  { name: '(c2) open every digit, random order', s: (_b, r) => hiddenPositions(r) },
  {
    name: '(d1) hunt instant wins, cash ≥ 1.5× or all busts ≥ 50%',
    s: (bet, r) => {
      if (!isStart(r) && (cashOut(bet, r) >= 1.5 || fans(bet, r).every((f) => f.bust >= 0.5))) return 'cash';
      return [argBy(bet, r, (x) => x.sure + 1e-6 * (1 - x.bust)).pos];
    },
  },
  {
    name: '(d2) max-variance digit, stop once in profit',
    s: (bet, r) => (!isStart(r) && cashOut(bet, r) > 1 ? 'cash' : [argBy(bet, r, (x) => variance(x.chances)).pos]),
  },
  {
    name: '(d3) riskiest digit, stop once in profit',
    s: (bet, r) => (!isStart(r) && cashOut(bet, r) > 1 ? 'cash' : [argBy(bet, r, (x) => x.bust).pos]),
  },
];

/** The value of a finished or continuing state, exactly as Game.tsx pays it. */
function terminal(bet: Bet, r: Revealed): number | null {
  const end = decided(bet, r);
  return end === 'won' ? prize(bet, r.length) : end === 'lost' ? 0 : null;
}

/** Exact expected payout of a strategy from state r (recursion over every digit value, memoised by pattern). */
function exactValue(bet: Bet, d: Digits, s: Strategy): number {
  const memo = new Map<string, number>();
  const go = (r: Revealed): number => {
    const t = terminal(bet, r);
    if (t !== null) return t;
    const key = keyOf(r);
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const c = s(bet, r);
    let v: number;
    if (c === 'cash') v = cashOut(bet, r);
    else {
      v = 0;
      for (const pos of c) {
        const vals = valuesAt(pos);
        let sum = 0;
        for (const x of vals) sum += go(reveal(r, pos, x));
        v += sum / vals.length / c.length;
      }
    }
    memo.set(key, v);
    return v;
  };
  return go(allHidden(d));
}

/** One round as Game.tsx plays it: N drawn at the bet, a first digit opened at once, then checkpoints. */
function playRound(bet: Bet, d: Digits, s: Strategy, rng: Rng): number {
  const n = lowest(d) + rng.int(rangeSize(d));
  let r = allHidden(d);
  for (;;) {
    const c = s(bet, r);
    if (c === 'cash') return cashOut(bet, r);
    const pos = c.length === 1 ? c[0] : c[rng.int(c.length)];
    r = reveal(r, pos, digitAt(n, d, pos));
    const t = terminal(bet, r);
    if (t !== null) return t;
  }
}

function mc(f: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = f(rng);
    s += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

/** Brute-force winner count among the numbers matching a pattern. */
function bruteHits(bet: Bet, r: Revealed) {
  let c = 0;
  for (let n = lowest(r.length); n <= highest(r.length); n++) if (matches(r, n) && wins(bet, n)) c++;
  return c;
}

describe('Prime Time fairness', () => {
  it('martingale (exact): for every hidden digit, the mean cash-out over its values equals the cash-out now', () => {
    const rng = createRng(seededSource(4401));
    const states: { bet: Bet; r: Revealed }[] = [];
    for (const bet of BETS)
      for (const d of DIGITS)
        for (let g = 0; g < 4; g++) {
          // A random round: random digit order, play until decided, recording every live state.
          const n = lowest(d) + rng.int(rangeSize(d));
          let r = allHidden(d);
          while (decided(bet, r) === null) {
            states.push({ bet, r });
            const h = hiddenPositions(r);
            const pos = h[rng.int(h.length)];
            r = reveal(r, pos, digitAt(n, d, pos));
          }
        }
    expect(states.length).toBeGreaterThanOrEqual(30);
    let nearEnd = 0;
    for (const { bet, r } of states) {
      const v = cashOut(bet, r);
      const h = hiddenPositions(r);
      if (h.length === 1) nearEnd++;
      for (const pos of h) {
        const vals = valuesAt(pos);
        // Integer identity: the winners split exactly across the values.
        expect(vals.reduce((a, x) => a + hits(bet, reveal(r, pos, x)), 0)).toBe(hits(bet, r));
        // The post-step value as the game pays it (prize / 0 when decided, else the cash-out).
        const after = vals.reduce((a, x) => {
          const r2 = reveal(r, pos, x);
          return a + (terminal(bet, r2) ?? cashOut(bet, r2));
        }, 0) / vals.length;
        expect(Math.abs(after - v)).toBeLessThan(1e-12 * Math.max(1, prize(bet, r.length)));
      }
    }
    expect(nearEnd).toBeGreaterThan(5);
  });

  it('winner counts are exact: table = brute force at sampled states, and the start count = the closed form', () => {
    const rng = createRng(seededSource(4402));
    for (const bet of BETS)
      for (const d of DIGITS) {
        expect(hits(bet, allHidden(d))).toBe(startHits(bet, d));
        expect(candidates(allHidden(d))).toBe(rangeSize(d));
        for (let g = 0; g < 3; g++) {
          const n = lowest(d) + rng.int(rangeSize(d));
          let r = allHidden(d);
          const h = hiddenPositions(r);
          for (let i = 0; i < 1 + rng.int(d); i++) {
            const pos = h.splice(rng.int(h.length), 1)[0];
            r = reveal(r, pos, digitAt(n, d, pos));
          }
          expect(hits(bet, r)).toBe(bruteHits(bet, r));
        }
      }
  });

  it('every strategy is worth exactly RTP (exact recursion over every digit pattern), for every setting', () => {
    for (const bet of BETS) for (const d of DIGITS) for (const { s } of STRATEGIES) expect(Math.abs(exactValue(bet, d, s) - RTP)).toBeLessThan(1e-11);
  });

  it('strategies (a)–(d) on every eval config return RTP within 4 SE with the host RNG, never above the max', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      STRATEGIES.forEach(({ name, s }, si) => {
        const res = mc((rng) => playRound(params.bet, params.digits, s, rng), ROUNDS, 7300 + 17 * ci + si);
        rows.push(`${label} | ${name} | ${(res.mean * 100).toFixed(3)}% ± ${(res.se * 100).toFixed(3)}% | max ${res.max.toFixed(2)}`);
        expect(Math.abs(res.mean - RTP)).toBeLessThan(4 * res.se + 1e-12);
        expect(res.max).toBeLessThanOrEqual(MAX_MULTIPLIER);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
