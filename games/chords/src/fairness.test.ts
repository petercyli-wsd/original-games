// Fairness audit: can any way of playing Chords beat the RTP?
//
// A round draws chords one at a time; the round is lost when a chord crosses
// an earlier one. With pace "every end" each chord has two checkpoints: after
// the first end lands in region r the cash-out becomes V·L_r/S (S = Σ L²),
// after a clear second end it becomes V/S. With pace "every chord" both ends
// are drawn together and only V/S (or 0) is shown. The pace is fixed at the
// bet and only adds or removes checkpoints. Both ends are drawn from the host
// rng when the step starts; the action buttons only exist at checkpoints.
//
// The martingale check is exact, not sampled. At each reached state the rim is
// cut at every chord end into gaps; inside a gap the side of every chord is
// constant, so for any first end x:
//   P(chord from x is clear) = total length of the gaps with x's signature,
// computed here independently of math.ts's region walk. Then
//   - second end: E[V after | x] = P(clear | x)·V/S must equal V·L(x)/S, i.e.
//     the L that Game.tsx reads via regions()/regionIndex() is that length;
//   - first end: E[V after] = Σ_gaps gap·V·L(mid)/S must equal V, i.e. Σ L² = S;
//   - whole chord: E[V after] = (Σ_gaps gap·P(clear | mid))·V/S = V.
// A 100k-sample Monte Carlo of isClear on the real rng is a second check.
//
// Strategies, per eval config (target chords), pace "every end" unless named:
//   (a) the tester's: take a step only when it is ≥ 80% safe (the first end
//       is always safe, the second end is safe with chance L, a whole chord
//       with chance S), else cash out; run for both paces;
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) play to the end (the board auto-cashes when full);
//   (d) exploit the mid-chord peek: drop the first end, and carry on only when
//       it landed in a region at least as big as average (L ≥ S, the value
//       went up), else bank the higher of the two by cashing out.
// Payouts are heavy-tailed for (c) on 6–8 chords (up to 0.99·8! ≈ 40,000×),
// so there the per-step exact check is the binding test.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  RTP,
  afterClearChord,
  afterFirstEnd,
  clearChance,
  isClear,
  maxMultiplier,
  mod1,
  regionIndex,
  regions,
  signature,
  type Chord,
  type Pace,
  type Target,
} from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 4_000);
const SAMPLES = 100_000;

/** Gaps between consecutive chord ends, each with its midpoint's side mask. */
function gaps(chords: readonly Chord[]) {
  const ends = chords.flatMap((c) => [mod1(c.a), mod1(c.b)]).sort((u, v) => u - v);
  return ends.map((p, i) => {
    const q = i + 1 < ends.length ? ends[i + 1] : ends[0] + 1;
    const len = q - p;
    return { len, sig: signature(chords, mod1(p + len / 2)), mid: mod1(p + len / 2) };
  });
}

/** Exact P(a chord from x is clear): the rim length sharing x's side mask, from the gaps. */
function exactClearFrom(chords: readonly Chord[], x: number): number {
  const s = signature(chords, x);
  return gaps(chords).reduce((acc, g) => (g.sig === s ? acc + g.len : acc), 0);
}

interface State {
  chords: Chord[];
  cash: number;
}

/** Clear checkpoints met while playing random rounds to 8 chords. */
function reachedStates(count: number, rng: Rng): State[] {
  const out: State[] = [];
  while (out.length < count) {
    let chords: Chord[] = [];
    let cash = RTP;
    while (chords.length < 8) {
      const S = clearChance(regions(chords));
      const x = rng.next();
      const y = rng.next();
      if (!isClear(chords, x, y)) break;
      cash = afterClearChord(cash, S);
      chords = [...chords, { a: x, b: y }];
      if (rng.next() < 0.6) out.push({ chords, cash });
    }
  }
  return out.slice(0, count);
}

type Peek = { stage: 'chord'; S: number } | { stage: 'second'; S: number; L: number };
/** At a checkpoint: cash out now? `V` is the cash-out, `peek` the next step's odds. */
type Stop = (V: number, peek: Peek) => boolean;

/**
 * One round as Game.tsx plays it: the first chord is drawn at once (S = 1),
 * then at each checkpoint the stop rule, else the next step with the game's
 * functions (regions → regionIndex → afterFirstEnd; isClear → afterClearChord).
 */
function playRound(target: Target, pace: Pace, stop: Stop, rng: Rng): number {
  let chords: Chord[] = [];
  let cash = RTP;
  for (;;) {
    const rs = regions(chords);
    const S = clearChance(rs);
    if (chords.length > 0 && stop(cash, { stage: 'chord', S })) return cash;
    const base = cash;
    const x = rng.next();
    if (pace === 'end' && chords.length > 0) {
      const L = rs[regionIndex(rs, chords, x)].length;
      cash = afterFirstEnd(base, S, L);
      if (stop(cash, { stage: 'second', S, L })) return cash;
    }
    const y = rng.next();
    if (!isClear(chords, x, y)) return 0;
    cash = afterClearChord(base, S);
    chords = [...chords, { a: x, b: y }];
    if (chords.length >= target) return cash;
  }
}

/** `tail`: the strategy can ride on to the full board, so its payouts are heavy-tailed. */
const STRATEGIES: { name: string; pace: Pace; stop: Stop; tail: boolean }[] = [
  { name: '(a) step only when ≥ 80% safe, every end', pace: 'end', stop: (_, k) => k.stage === 'second' && k.L < 0.8, tail: false },
  { name: '(a) step only when ≥ 80% safe, every chord', pace: 'chord', stop: (_, k) => k.S < 0.8, tail: false },
  { name: '(b) take any profit', pace: 'end', stop: (V) => V > 1, tail: false },
  { name: '(c) play to the end', pace: 'end', stop: () => false, tail: true },
  { name: '(d) continue only when the first end went up', pace: 'end', stop: (_, k) => k.stage === 'second' && k.L < k.S, tail: true },
];

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    s += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

describe('Chords fairness', () => {
  const rng = createRng(seededSource(77));
  const states = reachedStates(40, rng);

  it('reached states are varied (1–7 chords)', () => {
    const counts = new Set(states.map((s) => s.chords.length));
    expect(counts.size).toBeGreaterThanOrEqual(5);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(6);
  });

  it('martingale, exact: every stage is a fair bet at 40 reached states (rim cut at every chord end)', () => {
    for (const st of states) {
      const rs = regions(st.chords);
      const S = clearChance(rs);
      const V = st.cash;
      const gs = gaps(st.chords);
      expect(gs.reduce((a, g) => a + g.len, 0)).toBeCloseTo(1, 12);

      // Second end, for a first end in every gap: the L the game prices with is the true clear chance.
      for (const g of gs) {
        const L = rs[regionIndex(rs, st.chords, g.mid)].length;
        const truth = exactClearFrom(st.chords, g.mid);
        expect(Math.abs(L - truth)).toBeLessThan(1e-12);
        const mid = afterFirstEnd(V, S, L);
        expect(Math.abs(truth * afterClearChord(V, S) - mid)).toBeLessThan(1e-9 * Math.max(1, mid));
      }

      // First end: E[V·L(x)/S] over a uniform x = V.
      const afterFirst = gs.reduce((a, g) => a + g.len * afterFirstEnd(V, S, rs[regionIndex(rs, st.chords, g.mid)].length), 0);
      expect(Math.abs(afterFirst - V)).toBeLessThan(1e-9 * V);

      // Whole chord: P(clear) = Σ_gaps gap · P(clear | x in gap) = S.
      const pClear = gs.reduce((a, g) => a + g.len * exactClearFrom(st.chords, g.mid), 0);
      expect(Math.abs(pClear - S)).toBeLessThan(1e-12);
      expect(Math.abs(pClear * afterClearChord(V, S) - V)).toBeLessThan(1e-9 * V);
    }
  });

  it('martingale, sampled: E[cash-out after the next chord] = cash-out now at 30 states (100k draws on the real rng, 4 SE)', () => {
    for (const st of states.slice(0, 30)) {
      const S = clearChance(regions(st.chords));
      let clear = 0;
      for (let i = 0; i < SAMPLES; i++) if (isClear(st.chords, rng.next(), rng.next())) clear++;
      const after = (clear / SAMPLES) * afterClearChord(st.cash, S);
      const se = (Math.sqrt((S * (1 - S)) / SAMPLES) * st.cash) / S;
      expect(Math.abs(after - st.cash)).toBeLessThan(4 * se + 1e-12);
    }
  });

  it('every reachable value is within the manifest bound', () => {
    for (const st of states) expect(st.cash).toBeLessThanOrEqual(maxMultiplier(8) + 1e-9);
  });

  it.each(STRATEGIES.map((s) => [s.name, s] as const))('strategy %s: RTP within 4 SE on every eval config', (_, { name, pace, stop, tail }) => {
    evalSpec.configs.forEach((cfg, i) => {
      const t = cfg.params.target;
      const r = mc((g) => playRound(t, pace, stop, g), ROUNDS, 300 + i * 31 + name.length);
      const z = (r.mean - RTP) / r.se;
      if (import.meta.env.FAIRNESS_ROUNDS)
        console.log(`${name} | ${t} chords | RTP ${(r.mean * 100).toFixed(3)}% ± ${(r.se * 100).toFixed(3)}% | z ${z.toFixed(2)} | max ${r.max.toFixed(1)}`);
      // Heavy tails (strategies that ride on to 6–8 chords): a short sample
      // usually misses the rare huge wins, so its mean and its SE are both
      // biased low and a two-sided z is meaningless. An exploit would push the
      // mean UP, and a rare big win inflates the SE with it, so the one-sided
      // test stays valid there. The exact per-stage checks above are binding.
      if (tail && t >= 6) expect(z).toBeLessThan(4);
      else expect(Math.abs(z)).toBeLessThan(4);
      expect(r.max).toBeLessThanOrEqual(maxMultiplier(t) + 1e-9);
    });
  });
});
