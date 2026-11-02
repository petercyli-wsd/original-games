import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BOXES,
  MAX_WIN,
  RTP,
  closes,
  fullBox,
  nextRoll,
  oneDie,
  playableChance,
  relock,
  rollDice,
  startPrize,
  tileSum,
  tilesOf,
  totals,
  winChance,
  type Mask,
} from './math';

const rng = createRng(seededSource(11));

// An independent exact solver in rational arithmetic (BigInt), top-down with
// plain subset recursion, for the small boxes.
type Q = [bigint, bigint];
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));
const norm = ([n, d]: Q): Q => {
  const g = gcd(n, d) || 1n;
  return [n / g, d / g];
};
const add = (a: Q, b: Q): Q => norm([a[0] * b[1] + b[0] * a[1], a[1] * b[1]]);
const mul = (a: Q, b: Q): Q => norm([a[0] * b[0], a[1] * b[1]]);
const less = (a: Q, b: Q) => a[0] * b[1] < b[0] * a[1];
const memo = new Map<number, Q>();
function exact(open: number[]): Q {
  if (open.length === 0) return [1n, 1n];
  const key = open.reduce((m, t) => m | (1 << (t - 1)), 0);
  const hit = memo.get(key);
  if (hit) return hit;
  const total = open.reduce((a, b) => a + b, 0);
  const dist: [number, Q][] =
    total <= 6 ? [1, 2, 3, 4, 5, 6].map((t) => [t, [1n, 6n] as Q]) : Array.from({ length: 11 }, (_, i) => [i + 2, [BigInt(6 - Math.abs(i - 5)), 36n] as Q]);
  let v: Q = [0n, 1n];
  for (const [t, p] of dist) {
    let best: Q | null = null;
    const k = open.length;
    for (let s = 1; s < 1 << k; s++) {
      let sum = 0;
      const rest: number[] = [];
      for (let i = 0; i < k; i++) (s >> i) & 1 ? (sum += open[i]) : rest.push(open[i]);
      if (sum !== t) continue;
      const r = exact(rest);
      if (!best || less(best, r)) best = r;
    }
    if (best) v = add(v, mul(p, best));
  }
  memo.set(key, v);
  return v;
}

const randomOpen = (n: number): Mask => {
  let m = 0;
  while (m === 0) m = rng.int(1 << n);
  return m;
};

describe('Shut maths', () => {
  it('the best-play DP matches an independent exact rational solver', () => {
    for (let n = 1; n <= 8; n++) {
      const [num, den] = exact(Array.from({ length: n }, (_, i) => i + 1));
      expect(winChance(fullBox(n))).toBeCloseTo(Number(num) / Number(den), 12);
    }
    // And on random open sets of the 9-box.
    for (let i = 0; i < 40; i++) {
      const m = randomOpen(9);
      const [num, den] = exact(tilesOf(m));
      expect(winChance(m)).toBeCloseTo(Number(num) / Number(den), 12);
    }
  });

  it('known values: the classic 9-box under best play is 9.76%', () => {
    expect(winChance(fullBox(9))).toBeCloseTo(0.0976, 4);
    expect(winChance(fullBox(3))).toBeCloseTo(1 / 3, 12);
    expect(winChance(fullBox(12))).toBeCloseTo(0.00475, 5);
  });

  it('playing best to the end shuts the box as often as the DP says (raw dice simulation)', () => {
    for (const n of BOXES) {
      const rounds = 40_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        let mask = fullBox(n);
        for (;;) {
          // Raw process: real dice faces, the one-die rule read off the tiles.
          const open = tilesOf(mask).reduce((a, b) => a + b, 0);
          const d1 = 1 + Math.floor(rng.next() * 6);
          const t = open <= 6 ? d1 : d1 + 1 + Math.floor(rng.next() * 6);
          const opts = closes(mask, t);
          if (!opts.length) break;
          mask = opts[0].after;
          if (mask === 0) {
            wins++;
            break;
          }
        }
      }
      const p = winChance(fullBox(n));
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
    }
  });

  it('the martingale step: E[cash-out after the roll] = cash-out now, for any close chosen', () => {
    for (let trial = 0; trial < 300; trial++) {
      const mask = randomOpen(12);
      const prize = 1 + rng.next() * 50;
      const now = prize * winChance(mask);
      let expected = 0;
      for (const { total, p } of totals(mask)) {
        const opts = closes(mask, total);
        if (!opts.length) continue;
        // Any allowed choice keeps the value: prize' · V(after) = prize · V(best).
        const pick = opts[rng.int(opts.length)];
        const next = relock(prize, opts[0].win, pick);
        const value = next === null ? prize * opts[0].win : next * pick.win;
        expect(value).toBeCloseTo(prize * opts[0].win, 9);
        expect(next === null || next <= MAX_WIN).toBe(true);
        expect(relock(prize, opts[0].win, opts[0])).toBe(prize);
        expected += p * value;
      }
      expect(expected).toBeCloseTo(now, 9);
    }
  });

  it('odds on screen: the green share of the strip is the true chance the next roll can be played', () => {
    for (let trial = 0; trial < 60; trial++) {
      const mask = randomOpen(12);
      const strip = nextRoll(mask);
      expect(strip.reduce((a, x) => a + x.p, 0)).toBeCloseTo(1, 12);
      // Sweep every dice outcome: brute force subset-sum check on the faces.
      const tiles = tilesOf(mask);
      const canMake = (t: number) => {
        for (let s = 1; s < 1 << tiles.length; s++) {
          let sum = 0;
          for (let i = 0; i < tiles.length; i++) if ((s >> i) & 1) sum += tiles[i];
          if (sum === t) return true;
        }
        return false;
      };
      let ok = 0;
      let outcomes = 0;
      const faces = oneDie(mask) ? [[1], [2], [3], [4], [5], [6]] : [1, 2, 3, 4, 5, 6].flatMap((a) => [1, 2, 3, 4, 5, 6].map((b) => [a, b]));
      for (const f of faces) {
        outcomes++;
        if (canMake(f.reduce((a, b) => a + b, 0))) ok++;
      }
      expect(playableChance(mask)).toBeCloseTo(ok / outcomes, 12);
      // The columns: width × height summed is exactly the win chance now.
      expect(strip.reduce((a, x) => a + x.p * x.win, 0)).toBeCloseTo(winChance(mask), 12);
    }
  });

  it('one die exactly when the open tiles total 6 or less', () => {
    for (let trial = 0; trial < 200; trial++) {
      const mask = randomOpen(12);
      const { dice, total } = rollDice(mask, (k) => rng.int(k));
      expect(dice.length).toBe(tileSum(mask) <= 6 ? 1 : 2);
      expect(total).toBe(dice.reduce((a, b) => a + b, 0));
    }
  });

  it('box sizes span more than 25:1 and the start prize is fair', () => {
    const ps = BOXES.map((n) => winChance(fullBox(n)));
    expect(Math.max(...ps) / Math.min(...ps)).toBeGreaterThan(25);
    for (const n of BOXES) expect(startPrize(n) * winChance(fullBox(n))).toBeCloseTo(RTP, 12);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
