import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  CUTS,
  MAX_MULTIPLIER,
  NO_CLUES,
  RTP,
  SIZES,
  cashOut,
  cfValue,
  drawPair,
  euclid,
  nodeAt,
  odds,
  offered,
  prize,
  reveal,
  slopes,
  tree,
  winChance,
  wins,
  type Bet,
  type Clues,
  type Size,
} from './math';

const rng = createRng(seededSource(11));

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

const BETS: Bet[] = [{ kind: 'coprime', cuts: 3 }, { kind: 'square', cuts: 3 }, ...CUTS.map((cuts) => ({ kind: 'cuts' as const, cuts }))];

/** Every state a round can reach for this pair, in order. */
function path(p: ReturnType<typeof drawPair>): Clues[] {
  const out: Clues[] = [NO_CLUES];
  for (let c = reveal(p, NO_CLUES); c; c = reveal(p, c)) out.push(c);
  return out;
}

/** Brute force: does pair (a, b) give exactly these clues? */
function fitsClues(a: number, b: number, c: Clues): boolean {
  const { q, g } = euclid(a, b);
  const j = c.quotients.length;
  if (q.length < j) return false;
  for (let i = 0; i < j; i++) if (q[i] !== c.quotients[i]) return false;
  if (c.done !== (q.length === j)) return false;
  return c.scale === null || c.scale === g;
}

describe('Euclid maths', () => {
  it('Euclid: the quotients rebuild a/b and the last square is the gcd', () => {
    for (let a = 2; a <= 120; a++) {
      for (let b = 1; b < a; b++) {
        const { q, g } = euclid(a, b);
        const { num, den } = cfValue(q);
        expect(num * b).toBe(den * a);
        expect(gcd(num, den)).toBe(1);
        expect(g).toBe(gcd(a, b));
        if (q.length > 1 || a > b) expect(q[q.length - 1]).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('coprime pairs number Σ φ(a) for 2 ≤ a ≤ N', () => {
    // φ(n) by direct gcd counting.
    const phiCount = (n: number) => Array.from({ length: n }, (_, i) => i + 1).filter((k) => gcd(n, k) === 1).length;
    for (const size of SIZES) {
      let sum = 0;
      for (let a = 2; a <= size; a++) sum += phiCount(a);
      expect(odds(size, { kind: 'coprime', cuts: 3 }).wins).toBe(sum);
      expect(odds(size, { kind: 'coprime', cuts: 3 }).total).toBe((size * (size - 1)) / 2);
    }
  });

  it('the exact chances match a direct simulation of the raw draw', () => {
    for (const size of SIZES) {
      const rounds = 20_000;
      const hits = new Map<Bet, number>(BETS.map((b) => [b, 0]));
      for (let r = 0; r < rounds; r++) {
        let a = 0;
        let b = 0;
        while (!(b >= 1 && b < a)) [a, b] = [1 + rng.int(size), 1 + rng.int(size)];
        const g = gcd(a, b);
        const { q } = euclid(a, b);
        for (const bet of BETS) {
          const win = bet.kind === 'coprime' ? g === 1 : bet.kind === 'square' ? g >= 2 : q.length >= bet.cuts;
          if (win) hits.set(bet, hits.get(bet)! + 1);
        }
      }
      for (const bet of BETS) {
        const p = winChance(size, bet);
        expect(Math.abs(hits.get(bet)! / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
      }
    }
  });

  it('the lit dots are exactly the pairs that fit the clues, and the wedge holds exactly them', () => {
    for (const size of [30, 60] as Size[]) {
      for (let t = 0; t < 16; t++) {
        const pair = drawPair(size, (n) => rng.int(n));
        for (const clues of path(pair)) {
          const node = nodeAt(size, clues)!;
          const lit = new Set(node.pairs.map((p) => `${p.a},${p.b}`));
          const rays = slopes(clues);
          for (let a = 2; a <= size; a++) {
            for (let b = 1; b < a; b++) {
              const fits = fitsClues(a, b, clues);
              expect(lit.has(`${a},${b}`)).toBe(fits);
              if (rays.length === 2 && clues.scale === null) {
                // Integers compared exactly: a/b strictly between the two rays.
                const [r0, r1] = rays;
                const s0 = Math.sign(a * r0.den - b * r0.num);
                const s1 = Math.sign(a * r1.den - b * r1.num);
                expect(s0 * s1 < 0).toBe(fits);
              }
              if (rays.length === 1 && clues.scale === null) expect(a * rays[0].den === b * rays[0].num).toBe(fits);
            }
          }
          // What the board shows as the odds (green ÷ lit) is the win chance.
          for (const bet of BETS) {
            const green = node.pairs.filter((p) => wins(p, bet)).length;
            expect(odds(size, bet, clues).wins).toBe(green);
            expect(odds(size, bet, clues).p).toBe(green / node.pairs.length);
          }
        }
      }
    }
  });

  it('each reveal is a fair bet: E[cash-out after] = cash-out before', () => {
    for (const size of SIZES) {
      for (const bet of BETS.filter((b) => offered(size, b))) {
        for (let t = 0; t < 25; t++) {
          const pair = drawPair(size, (n) => rng.int(n));
          for (const clues of path(pair)) {
            const node = nodeAt(size, clues)!;
            if (node.children.size === 0) continue;
            const before = cashOut(size, bet, clues);
            let after = 0;
            for (const child of node.children.values()) {
              const w = child.pairs.filter((p) => wins(p, bet)).length;
              after += (child.pairs.length / node.pairs.length) * prize(size, bet) * (w / child.pairs.length);
            }
            expect(after).toBeCloseTo(before, 9);
            expect(before).toBeLessThanOrEqual(prize(size, bet) + 1e-9);
          }
        }
        expect(cashOut(size, bet, NO_CLUES)).toBeCloseTo(RTP, 12);
      }
    }
  });

  it('maxMultiplier is the largest offered prize', () => {
    let max = 0;
    for (const size of SIZES) for (const bet of BETS) if (offered(size, bet)) max = Math.max(max, prize(size, bet));
    expect(MAX_MULTIPLIER).toBe(max);
    expect(manifest.maxMultiplier).toBe(max);
    expect(tree(200).byLength.length - 1).toBe(10); // Lamé: (144, 89) needs 10 cuts
  });

  it('simulated RTP matches the manifest under mixed strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
