// Fairness audit: can any way of playing Serials beat the RTP?
//
// The hidden top serial N is drawn at the bet (Game.tsx: drawTop(rng.next()))
// and never rendered until the round is over; Bet then draws the first serial
// at once. At each checkpoint the player may (1) cash out, (2) draw the next
// serial, (3) reveal N now, or (4) move the cut, which keeps the cash-out V
// and re-locks the prize at V / P(N ≤ X' | draws), clamped to cuts whose prize
// stays ≤ MAX_PRIZE. The number of serials is fixed at the bet. Each draw and
// the reveal are decided when they start; the ticket's fair value jumps to the
// result at once, and every button and the slider are disabled while they
// animate. Space runs the same step() as the button.
//
// The cash-out V = prize · P(N ≤ X | draws) is a martingale iff, at every
// state, (i) the next draw keeps it on average:
//     Σ_s P(next = s | draws) · prize · P(N ≤ X | draws + s) = V,
// (ii) the reveal pays prize · 1[N ≤ X] with expectation V, and (iii) a re-cut
// leaves V unchanged. The next draw has at most 100 outcomes, so (i) is exact
// enumeration; the posterior and predictive law are also recomputed from
// scratch by Bayes over the explicit drawn set (not through math.ts), so a
// wrong sufficient-statistic shortcut would show up. States: random rounds at
// every draw count, cuts and prizes, including the last checkpoint before the
// reveal, cuts right at the largest serial, and large re-locked prizes. (An
// exhaustive scan over (draws, largest serial, opening cut) puts the largest
// single re-lock at ×90.09, so the ×1000 cap is a safeguard that never binds
// in practice; the re-cut check still covers every cut, refused ones included.)
//
// Strategies, per eval config:
//   (a) the tester's: draw while the next serial is ≥ 80% safe (≤ the cut),
//       else cash out; at the end reveal if P(N ≤ X) ≥ 80%, else cash out;
//   (b) take any profit: cash out the moment V > bet;
//   (c) play to the end: draw every serial, then reveal;
//   (d) cut-steering: at each checkpoint, if the posterior looks good
//       (P ≥ 50%) move the cut to 99 and reveal at once (lock it in); else
//       move the cut down to the lowest cut paying ≤ 20× the cash-out and
//       ride on;
//   (d') longest shot: after the first serial move the cut to the lowest
//       allowed (the biggest re-locked prize) and reveal at once.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  CUT_MAX,
  CUT_MIN,
  DRAWS,
  MAX_PRIZE,
  N_MAX,
  N_MIN,
  RTP,
  cashOut,
  cutAllowed,
  drawSerial,
  drawTop,
  minCut,
  nextBust,
  nextDrawChance,
  openingPrize,
  relockPrize,
  winChance,
  type Settings,
} from './math';

/** Rounds per strategy run; the heavy run sets FAIRNESS_ROUNDS (and FAIRNESS_TARGET_SE / FAIRNESS_MAX_ROUNDS). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 15_000);
const TARGET_SE = Number(import.meta.env.FAIRNESS_TARGET_SE ?? 0);
const MAX_ROUNDS = Number(import.meta.env.FAIRNESS_MAX_ROUNDS ?? ROUNDS);

interface State {
  total: number;
  drawn: number[];
  cut: number;
  prize: number;
}

const maxOf = (d: readonly number[]) => Math.max(0, ...d);
const value = (s: State) => cashOut(s.prize, s.drawn.length, maxOf(s.drawn), s.cut);

/** The clamp Game.tsx's moveCut applies at a checkpoint. */
function moveCut(s: State, x: number): State {
  const j = s.drawn.length;
  const m = maxOf(s.drawn);
  const cash = value(s);
  const to = Math.min(CUT_MAX, Math.max(minCut(cash, j, m), x));
  return { ...s, cut: to, prize: relockPrize(cash, j, m, to) };
}

/** Bayes from scratch over the explicit drawn set: P(N | drawn) ∝ 1[N ≥ max] / (N (N−1) ⋯ (N−j+1)). */
function directPosterior(drawn: readonly number[]): number[] {
  const m = maxOf(drawn);
  const w = Array<number>(N_MAX + 1).fill(0);
  let z = 0;
  for (let n = N_MIN; n <= N_MAX; n++) {
    if (n < m) continue;
    let like = 1;
    for (let i = 0; i < drawn.length; i++) like /= n - i;
    w[n] = like;
    z += like;
  }
  return w.map((x) => x / z);
}

type Move = 'cash' | 'draw' | 'reveal';
/** At a checkpoint: optionally a new cut, then the move. */
type Strategy = (s: State) => { cut?: number; move: Move };

/** One round as Game.tsx plays it. Returns the payout multiplier. */
function playRound(set: Settings, strategy: Strategy, rng: Rng): number {
  const n = drawTop(rng.next());
  let s: State = { total: set.draws, drawn: [], cut: set.cut, prize: openingPrize(set.cut) };
  let move: Move = 'draw'; // Bet draws the first serial
  for (;;) {
    if (move === 'cash') return value(s);
    if (move === 'reveal') return n <= s.cut ? s.prize : 0;
    const x = drawSerial(n, s.drawn, rng.next());
    s = { ...s, drawn: [...s.drawn, x] };
    if (x > s.cut) return 0;
    const d = strategy(s);
    if (d.cut !== undefined) s = moveCut(s, d.cut);
    move = d.move === 'draw' && s.drawn.length >= s.total ? 'reveal' : d.move;
  }
}

const pNow = (s: State) => winChance(s.drawn.length, maxOf(s.drawn), s.cut);
const left = (s: State) => s.total - s.drawn.length;

const STRATEGIES: { name: string; play: Strategy }[] = [
  {
    name: '(a) draw while ≥ 80% safe',
    play: (s) => {
      const safe = left(s) > 0 ? 1 - nextBust(s.drawn.length, maxOf(s.drawn), s.cut) : pNow(s);
      return { move: safe >= 0.8 ? 'draw' : 'cash' };
    },
  },
  { name: '(b) take any profit', play: (s) => ({ move: value(s) > 1 ? 'cash' : 'draw' }) },
  { name: '(c) play to the end', play: () => ({ move: 'draw' }) },
  {
    name: '(d) cut-steering: lock in good news at 99, chase bad news at ≤ 20×',
    play: (s) => {
      if (pNow(s) >= 0.5) return { cut: CUT_MAX, move: 'reveal' };
      const cash = value(s);
      const j = s.drawn.length;
      const m = maxOf(s.drawn);
      let x = minCut(cash, j, m);
      while (x < CUT_MAX && relockPrize(cash, j, m, x) > 20 * cash) x++;
      return { cut: Math.max(x, s.cut), move: 'draw' };
    },
  },
  { name: "(d') longest shot: lowest cut, reveal at once", play: () => ({ cut: CUT_MIN, move: 'reveal' }) },
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

/** Live checkpoint states from random rounds (random settings, random re-cuts). */
function reached(rng: Rng): State {
  for (;;) {
    const total = DRAWS[rng.int(DRAWS.length)];
    const cut = CUT_MIN + rng.int(CUT_MAX - CUT_MIN + 1);
    const n = drawTop(rng.next());
    let s: State = { total, drawn: [], cut, prize: openingPrize(cut) };
    const depth = 1 + rng.int(total);
    let bust = false;
    for (let j = 0; j < depth; j++) {
      const x = drawSerial(n, s.drawn, rng.next());
      s = { ...s, drawn: [...s.drawn, x] };
      if (x > s.cut) {
        bust = true;
        break;
      }
      if (rng.next() < 0.4) s = moveCut(s, CUT_MIN + rng.int(CUT_MAX - CUT_MIN + 1));
    }
    if (!bust) return s;
  }
}

describe('Serials fairness', () => {
  it('martingale (exact, ≤ 100 outcomes): the next draw, the reveal and a re-cut all keep E[V] = V, with Bayes recomputed from scratch', () => {
    const rng = createRng(seededSource(1001));
    const states: State[] = [];
    for (let i = 0; i < 40; i++) states.push(reached(rng));
    // Edge cases: cut right at the largest serial, the last checkpoint, prizes near the cap.
    states.push({ total: 6, drawn: [3, 7, 40, 12, 9], cut: 40, prize: openingPrize(40) });
    states.push({ total: 2, drawn: [9, 2], cut: 10, prize: openingPrize(10) });
    states.push(moveCut({ total: 5, drawn: [60, 2], cut: 99, prize: openingPrize(99) }, CUT_MIN));
    states.push(moveCut({ total: 3, drawn: [8], cut: 50, prize: openingPrize(50) }, CUT_MIN));
    states.push({ total: 6, drawn: [1, 2, 3, 4, 5], cut: 10, prize: openingPrize(10) }); // ×90 prize, 40% to win
    expect(states.length).toBeGreaterThanOrEqual(30);

    let nearCap = 0;
    for (const s of states) {
      const j = s.drawn.length;
      const m = maxOf(s.drawn);
      const v = value(s);
      expect(s.prize).toBeLessThanOrEqual(MAX_PRIZE + 1e-9);
      if (s.prize > MAX_PRIZE / 20) nearCap++;
      const post = directPosterior(s.drawn);
      // The win chance on screen is the exact posterior mass left of the cut.
      const pDirect = post.reduce((a, p, n) => a + (n <= s.cut ? p : 0), 0);
      expect(Math.abs(winChance(j, m, s.cut) - pDirect)).toBeLessThan(1e-12);
      // (ii) The reveal: E[prize · 1[N ≤ X]] = V.
      expect(Math.abs(s.prize * pDirect - v)).toBeLessThan(1e-12 * Math.max(1, s.prize));
      // (i) The next draw (when one is left): every undrawn serial, predictive law from scratch.
      if (left(s) > 0) {
        let total = 0;
        let after = 0;
        let bust = 0;
        for (let x = 1; x <= N_MAX; x++) {
          if (s.drawn.includes(x)) continue;
          const px = post.reduce((a, p, n) => a + (n >= x && p > 0 ? p / (n - j) : 0), 0);
          expect(Math.abs(nextDrawChance(j, m, x) - px)).toBeLessThan(1e-12);
          total += px;
          if (x > s.cut) bust += px;
          after += px * cashOut(s.prize, j + 1, Math.max(m, x), s.cut);
        }
        expect(Math.abs(total - 1)).toBeLessThan(1e-12);
        expect(Math.abs(after - v)).toBeLessThan(1e-12 * Math.max(1, s.prize));
        expect(Math.abs(nextBust(j, m, s.cut) - bust)).toBeLessThan(1e-12);
      }
      // (iii) Every allowed re-cut keeps V and caps the prize; every refused one would pass the cap.
      for (let x = CUT_MIN; x <= CUT_MAX; x++) {
        const moved = moveCut(s, x);
        expect(Math.abs(value(moved) - v)).toBeLessThan(1e-12 * Math.max(1, v));
        expect(moved.prize).toBeLessThanOrEqual(MAX_PRIZE + 1e-9);
        expect(moved.cut).toBeGreaterThanOrEqual(m);
        if (moved.cut !== x && x < CUT_MAX) expect(cutAllowed(v, j, m, x)).toBe(false);
      }
    }
    expect(nearCap).toBeGreaterThanOrEqual(1);
  });

  for (const cfg of evalSpec.configs) {
    describe(cfg.label, () => {
      STRATEGIES.forEach((st, si) => {
        it(`${st.name}: RTP within 4 SE of ${RTP}`, () => {
          const r = mc((rng) => playRound(cfg.params, st.play, rng), 10_100 + si * 41 + cfg.params.cut);
          if (import.meta.env.FAIRNESS_ROUNDS)
            console.log(`serials | ${cfg.label} | ${st.name} | n ${r.n} | rtp ${r.mean.toFixed(5)} ± ${r.se.toFixed(5)} | max ${r.max.toFixed(2)}`);
          // The payout bound: prizes are capped at MAX_PRIZE up to the 1e-9 comparison slack.
          expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
          expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-12);
        });
      });
    });
  }
});
