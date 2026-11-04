// Fairness audit: can any way of playing Roots beat the RTP?
//
// A round backs "real roots" or "no real roots" of y = ax² + bx + c at a b
// range ±B (both fixed at the bet: the chips are disabled while live). Bet
// reveals a; then at each checkpoint the only decision is cash out or reveal
// the next coefficient (c, then b). A c that settles the bet ends the round
// (b is still drawn, for the picture). Each coefficient is drawn with the host
// rng the moment its reveal starts, and the ticket's fair value jumps to the
// post-reveal value at once; cash-out is disabled while a reveal animates.
//
// The cash-out V = prize · P(side | revealed) is a martingale iff every reveal
// averages P(side | ·) back to its current value. The next event is
// continuous, so each state is checked twice: by Monte Carlo with 100k draws
// of the next coefficient through the game's own draw() (4 SE), and by a
// closed form / fine quadrature to ~1e-9. States: the start of every
// (side, B) and random a / (a, c) states, including a states right at the
// α = B²/4 kink and (a, c) states whose miss band nearly fills the b-ruler.
//
// Strategies, per eval config:
//   (a) the tester's: reveal while the next reveal's chance of not losing
//       outright is ≥ 80%, else cash out;
//   (b) take any profit: cash out the moment V > bet;
//   (c) play to the end;
//   (d) Roots-specific ("disposition"): cash out on good news (the chance rose
//       at this reveal), ride bad news to the end. The only decision in Roots
//       is when to stop, so this and its mirror are the natural extremes.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  HIDDEN,
  RANGES,
  RTP,
  SIDES,
  cashOut,
  draw,
  isReal,
  pReal0,
  pReal1,
  pReal2,
  pWin,
  prize,
  stageOf,
  type Coeffs,
  type Side,
} from './math';

/** Rounds per strategy run; the heavy run sets FAIRNESS_ROUNDS (and FAIRNESS_TARGET_SE / FAIRNESS_MAX_ROUNDS). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);
const TARGET_SE = Number(import.meta.env.FAIRNESS_TARGET_SE ?? 0);
const MAX_ROUNDS = Number(import.meta.env.FAIRNESS_MAX_ROUNDS ?? ROUNDS);

/** Draws the next coefficient exactly as Game.tsx does (a, c on ±1; b on ±B). */
function reveal(k: Coeffs, B: number, rng: Rng): Coeffs {
  const stage = stageOf(k);
  if (stage === 0) return { ...k, a: draw(rng.next(), 1) };
  if (stage === 1) return { ...k, c: draw(rng.next(), 1) };
  return { ...k, b: draw(rng.next(), B) };
}

/** Value after a reveal: the cash-out, or the settled result once b is known. */
function valueAfter(side: Side, k: Coeffs, B: number): number {
  if (stageOf(k) === 3) return (side === 'real') === isReal(k.a!, k.b!, k.c!) ? prize(side, B) : 0;
  return cashOut(side, k, B);
}

/** Chance the next reveal loses the round outright (the side's chance drops to 0). */
function nextLoss(side: Side, k: Coeffs, B: number): number {
  const stage = stageOf(k);
  if (stage === 2) return 1 - pWin(side, k, B);
  if (stage === 1) {
    const alpha = Math.abs(k.a!);
    if (side === 'none') return alpha === 0 ? 1 : 0.5; // c on the other side of 0 from a: ac ≤ 0, real roots
    // Real roots lose at c when ac ≥ B²/4.
    return alpha === 0 ? 0 : Math.max(0, 1 - (B * B) / (4 * alpha)) / 2;
  }
  return 0; // a never settles the bet by itself
}

/** Composite Simpson on [lo, hi] with n (even) panels. */
function simpson(f: (x: number) => number, lo: number, hi: number, n = 4000): number {
  if (hi <= lo) return 0;
  const h = (hi - lo) / n;
  let s = f(lo) + f(hi);
  for (let i = 1; i < n; i++) s += f(lo + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

/** ∫ f(u) du on [lo, hi] ⊂ [0, ∞) via u = w² (the integrands here are smooth in √u). */
const integrateSqrt = (f: (u: number) => number, lo: number, hi: number) => simpson((w) => 2 * w * f(w * w), Math.sqrt(lo), Math.sqrt(hi));

/** Exact E[V after the next reveal] (closed form for a and b, quadrature split at the kink for c). */
function exactNext(side: Side, k: Coeffs, B: number): number {
  const stage = stageOf(k);
  const pz = prize(side, B);
  const toSide = (pReal: number) => pz * (side === 'real' ? pReal : 1 - pReal);
  if (stage === 0) {
    // ∫₀¹ pReal1(α) dα in closed form, with A = min(1, B²/4).
    const A = Math.min(1, (B * B) / 4);
    const pr = A - (4 / 9) * A ** 1.5 / B + (1 - A) / 2 - ((B * B) / 24) * Math.log(A);
    return toSide(pr);
  }
  if (stage === 1) {
    const a = k.a!;
    const alpha = Math.abs(a);
    // c on the opposite sign of a (half the mass): real roots for sure. Same sign: t = α|c|.
    const kink = alpha > 0 ? Math.min(1, (B * B) / (4 * alpha)) : 1;
    const same = integrateSqrt((u) => pReal2(alpha, u, B), 0, kink) + integrateSqrt((u) => pReal2(alpha, u, B), kink, 1);
    return toSide(0.5 + 0.5 * same);
  }
  // b uniform on ±B: real when |b| ≥ 2√(ac).
  const h = Math.min(1, (k.a! * k.c! > 0 ? 2 * Math.sqrt(k.a! * k.c!) : 0) / B);
  return toSide(1 - h);
}

type Stop = (side: Side, k: Coeffs, B: number, prev: number) => boolean;

/** One round as Game.tsx plays it. Returns the payout multiplier. */
function playRound(side: Side, B: number, stop: Stop, rng: Rng): number {
  let k = reveal({ ...HIDDEN }, B, rng); // Bet reveals a
  let prev = pWin(side, HIDDEN, B);
  for (;;) {
    const p = pWin(side, k, B);
    if (p === 0) return 0;
    if (p === 1) return prize(side, B);
    if (stop(side, k, B, prev)) return cashOut(side, k, B);
    prev = p;
    k = reveal(k, B, rng);
    if (stageOf(k) === 3) return valueAfter(side, k, B);
  }
}

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) reveal while ≥ 80% safe', stop: (side, k, B) => 1 - nextLoss(side, k, B) < 0.8 },
  { name: '(b) take any profit', stop: (side, k, B) => cashOut(side, k, B) > 1 },
  { name: '(c) play to the end', stop: () => false },
  { name: '(d) cash on good news, ride bad news', stop: (side, k, B, prev) => pWin(side, k, B) > prev },
];

function mc(play: (rng: Rng) => number, seed: number) {
  const rng = createRng(seededSource(seed));
  let n = 0;
  let s = 0;
  let s2 = 0;
  let max = 0;
  let se = Infinity;
  let mean = 0;
  while (n < ROUNDS || (se > TARGET_SE && n < MAX_ROUNDS)) {
    for (let i = 0; i < ROUNDS; i++) {
      const x = play(rng);
      s += x;
      s2 += x * x;
      if (x > max) max = x;
    }
    n += ROUNDS;
    mean = s / n;
    se = Math.sqrt(Math.max(0, s2 / n - mean * mean) / n);
  }
  return { mean, se, max, n };
}

describe('Roots fairness', () => {
  it('the per-reveal loss chance used by strategy (a) matches a direct simulation', () => {
    const rng = createRng(seededSource(801));
    for (const B of [0.5, 1, 4]) {
      for (const side of SIDES) {
        const k: Coeffs = { a: draw(rng.next(), 1), c: null, b: null };
        const q = nextLoss(side, k, B);
        let lost = 0;
        const n = 40_000;
        for (let i = 0; i < n; i++) if (pWin(side, reveal(k, B, rng), B) === 0) lost++;
        expect(Math.abs(lost / n - q)).toBeLessThan(4 * Math.sqrt((q * (1 - q)) / n) + 1e-9);
      }
    }
  });

  it('martingale: at ≥ 30 states, E[V after the next reveal] = V now (closed form / quadrature to 1e-7, and 100k real draws to 4 SE)', () => {
    const rng = createRng(seededSource(802));
    const states: { side: Side; B: number; k: Coeffs }[] = [];
    for (const B of RANGES) for (const side of SIDES) states.push({ side, B, k: { ...HIDDEN } });
    for (let i = 0; i < 12; i++) {
      const B = RANGES[rng.int(RANGES.length)];
      const side = SIDES[rng.int(2)];
      states.push({ side, B, k: { a: draw(rng.next(), 1), c: null, b: null } });
    }
    // a at the kink α = B²/4 (B ≤ 2), and a = ±1.
    for (const B of [0.5, 1, 2] as const) for (const side of SIDES) states.push({ side, B, k: { a: (B * B) / 4, c: null, b: null } });
    states.push({ side: 'none', B: 32, k: { a: -1, c: null, b: null } }, { side: 'real', B: 0.5, k: { a: 0.999, c: null, b: null } });
    let undecided = 0;
    while (undecided < 12) {
      const B = RANGES[rng.int(RANGES.length)];
      const side = SIDES[rng.int(2)];
      const k: Coeffs = { a: draw(rng.next(), 1), c: draw(rng.next(), 1), b: null };
      const p = pWin(side, k, B);
      if (p > 0 && p < 1) {
        states.push({ side, B, k });
        undecided++;
      }
    }
    // Miss band nearly filling the ruler: 2√(ac) just under B.
    states.push({ side: 'real', B: 1, k: { a: 0.5, c: 0.49, b: null } }, { side: 'none', B: 0.5, k: { a: -0.25, c: -0.249, b: null } });
    expect(states.length).toBeGreaterThanOrEqual(30);

    for (const { side, B, k } of states) {
      const v = cashOut(side, k, B);
      if (pWin(side, k, B) === 0 || pWin(side, k, B) === 1) continue;
      expect(Math.abs(exactNext(side, k, B) - v)).toBeLessThan(1e-7 * prize(side, B));
      const n = 100_000;
      let s = 0;
      let s2 = 0;
      for (let i = 0; i < n; i++) {
        const x = valueAfter(side, reveal(k, B, rng), B);
        s += x;
        s2 += x * x;
      }
      const mean = s / n;
      const se = Math.sqrt(Math.max(0, s2 / n - mean * mean) / n);
      expect(Math.abs(mean - v)).toBeLessThan(4 * se + 1e-12);
    }
  });

  it('the stage formulas agree with each other at the start: pReal0 = E[pReal1(a)] for every range', () => {
    for (const B of RANGES) {
      expect(Math.abs(exactNext('real', HIDDEN, B) / prize('real', B) - pReal0(B))).toBeLessThan(1e-12);
      const A = Math.min(1, (B * B) / 4);
      const pr = integrateSqrt((alpha) => pReal1(alpha, B), 0, A) + simpson((alpha) => pReal1(alpha, B), A, 1);
      expect(Math.abs(pr - pReal0(B))).toBeLessThan(1e-9);
    }
  });

  for (const cfg of evalSpec.configs) {
    describe(cfg.label, () => {
      STRATEGIES.forEach((s, si) => {
        it(`${s.name}: RTP within 4 SE of ${RTP}`, () => {
          const { side, range } = cfg.params;
          const r = mc((rng) => playRound(side, range, s.stop, rng), 8_000 + si * 31 + range);
          if (import.meta.env.FAIRNESS_ROUNDS)
            console.log(`roots | ${cfg.label} | ${s.name} | n ${r.n} | rtp ${r.mean.toFixed(5)} ± ${r.se.toFixed(5)} | max ${r.max.toFixed(2)}`);
          expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
          expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-12);
        });
      });
    });
  }
});
