// Fairness audit: can any way of playing Overhang beat the RTP?
//
// The mode (drop spread, height cap, odds floor, max win) is fixed at the bet
// (its buttons are disabled while live) and the first drop plays at once.
// At each checkpoint the player may cash out or drop again; the auto cash-out
// target only automates the same choice. So the only decision is when to
// stop, and the tester's rule fails exactly when surviving a drop with safe
// share p multiplies the cash-out by 1/p and p is the true chance that a
// drop stands.
//
// The martingale check draws the next offset exactly as Game.tsx's dropNext
// does (drawOffset(s, rng.next()) → landsSafely), 100k times per state, and
// compares E[cash-out after] with the cash-out now; every sampled tower is
// also checked against the statics definition (failingLevel). The safe share
// is checked deterministically too, by sweeping 100k offsets through the
// statics. States come from random rounds in every mode, at every height up
// to the cap, plus the states right before an auto-cash (near the max win and
// the odds floor).
//
// Strategies, per eval config (mode):
//   (a) the tester's: drop while the next drop is ≥ 80% to stand, else cash out;
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) drop to the end (the height, odds-floor and max-win auto-cash apply);
//   (d) read the lean: cash out when the green zone sits far off-centre (the
//       tower leans) or the drop is < 50% to stand, but chase once past 20×.
// (c) and (d) chase towers that pay up to the cap (250–10,000×) about once in
// 10⁴ rounds, so plain Monte Carlo can't price them: its sample SE misses the
// tail and reads low. Every strategy is therefore also run with importance
// sampling (offsets from a mixture weighted towards the safe zone, payouts
// weighted by the exact likelihood ratio), an unbiased estimate of the same
// value with a usable SE; that run is asserted for all four.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { MODES, MODE_NAMES, RTP, drawOffset, isStable, landsSafely, maxMultiplier, nextOdds, simulate, stopReason, type Mode, type Odds } from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);
const SAMPLES = 100_000;

interface State {
  mode: Mode;
  xs: number[];
  mult: number;
}

/** Cash out at this checkpoint? Given the tower, the cash-out and the next drop's odds. */
type Stop = (st: State, next: Odds) => boolean;

/** One round exactly as Game.tsx plays it: drop, land or topple, auto-cash check, then the player's choice. */
function playRound(mode: Mode, stop: Stop, rng: Rng): number {
  return playWeighted(mode, stop, rng, 1).pay;
}

/**
 * The same round, with each offset drawn from the defensive mixture
 * λ·U[-s, s] + (1 − λ)·U(safe range) instead of U[-s, s] (λ = 1 is the game's
 * own draw, using the same rng stream). The result is the payout and its
 * likelihood ratio Π (1/2s) / q(d): E[pay · w] under the mixture equals the
 * strategy's true value under the game's draw for any λ > 0, whether or not
 * the pricing is right, with far less variance for strategies that chase rare
 * towers (plain Monte Carlo barely ever samples their 1,000×+ payouts).
 */
function playWeighted(mode: Mode, stop: Stop, rng: Rng, lambda: number): { pay: number; w: number } {
  const { s } = MODES[mode];
  const xs: number[] = [];
  let mult = RTP;
  let w = 1;
  for (;;) {
    const o = nextOdds(xs, s);
    let d: number;
    if (lambda >= 1 || !o.range || rng.next() < lambda) d = drawOffset(s, rng.next());
    else d = o.range[0] + (o.range[1] - o.range[0]) * rng.next();
    if (lambda < 1) {
      const inRange = !!o.range && d >= o.range[0] && d <= o.range[1];
      w *= 1 / (2 * s) / (lambda / (2 * s) + (inRange && o.range ? (1 - lambda) / (o.range[1] - o.range[0]) : 0));
    }
    if (!landsSafely(o, d)) return { pay: 0, w };
    xs.push((xs.length ? xs[xs.length - 1] : 0) + d);
    mult /= o.p;
    const after = nextOdds(xs, s);
    if (stopReason(mode, xs.length, mult, after.p)) return { pay: mult, w };
    if (stop({ mode, xs, mult }, after)) return { pay: mult, w };
  }
}

/** Mixture weight for the importance-sampled strategy runs. */
const LAMBDA = 0.2;

const STRATEGIES: { name: string; stop: Stop; longShot?: boolean }[] = [
  { name: '(a) drop while ≥ 80% to stand', stop: (_, o) => o.p < 0.8 },
  { name: '(b) take any profit', stop: (st) => st.mult > 1 },
  { name: '(c) drop to the end', stop: () => false, longShot: true },
  {
    name: '(d) cash on a lean or < 50%, chase past 20×',
    stop: (st, o) => st.mult <= 20 && (o.p < 0.5 || !o.range || Math.abs((o.range[0] + o.range[1]) / 2) > MODES[st.mode].s / 3),
    longShot: true,
  },
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

/** Checkpoints met while playing random rounds to the end, in every mode: every height, and the last state before each auto-cash. */
function reachedStates(perMode: number, rng: Rng): { offered: State[]; autoCashed: State[] } {
  const offered: State[] = [];
  const autoCashed: State[] = [];
  for (const mode of MODE_NAMES) {
    const { s } = MODES[mode];
    let got = 0;
    let deep = 0;
    while (got < perMode || deep < 3) {
      const xs: number[] = [];
      let mult = RTP;
      let prev: State | null = null;
      // Height 0 (the first drop) is a state too: its value is RTP.
      if (got < perMode && rng.next() < 0.1) offered.push({ mode, xs: [], mult });
      for (;;) {
        const o = nextOdds(xs, s);
        const d = drawOffset(s, rng.next());
        if (!landsSafely(o, d)) break;
        xs.push((xs.length ? xs[xs.length - 1] : 0) + d);
        mult /= o.p;
        const after = nextOdds(xs, s);
        if (stopReason(mode, xs.length, mult, after.p)) {
          if (deep < 3 || autoCashed.length < 4 * perMode) autoCashed.push({ mode, xs: [...xs], mult });
          // The checkpoint just before: the deepest state of this round where a drop was offered.
          if (prev && deep < 3) {
            offered.push(prev);
            deep++;
          }
          break;
        }
        prev = { mode, xs: [...xs], mult };
        if (got < perMode && rng.next() < 0.3) {
          offered.push(prev);
          got++;
        }
      }
    }
  }
  return { offered, autoCashed };
}

describe('Overhang fairness', () => {
  it('martingale: at 40+ reached states in every mode, E[cash-out after the next drop] = cash-out now (100k drops each, 4 SE), outcomes match the statics', () => {
    const rng = createRng(seededSource(1201));
    const { offered } = reachedStates(10, rng);
    expect(offered.length).toBeGreaterThanOrEqual(40);
    const heights = new Set(offered.map((st) => st.xs.length));
    expect(heights.size).toBeGreaterThanOrEqual(5);
    for (const st of offered) {
      const { s } = MODES[st.mode];
      const o = nextOdds(st.xs, s);
      // An offered drop is never a sure loss and never pays past the cap.
      expect(o.p).toBeGreaterThan(0);
      expect(st.mult / o.p).toBeLessThanOrEqual(maxMultiplier(st.mode) + 1e-9);
      const top = st.xs.length ? st.xs[st.xs.length - 1] : 0;
      let safe = 0;
      let mismatch = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const d = drawOffset(s, rng.next());
        const ok = landsSafely(o, d);
        if (ok) safe++;
        // The statics cross-check is O(height²) per drop: every 20th drop (5k per state) is plenty next to the 100k-offset sweep below.
        if (i % 20 === 0 && ok !== isStable([...st.xs, top + d])) mismatch++;
      }
      // Offsets within ~1e-12 of a zone edge may disagree on the tie; none should at random.
      expect(mismatch).toBe(0);
      const after = ((safe / SAMPLES) * (st.mult / o.p)) / st.mult;
      const se = Math.sqrt((o.p * (1 - o.p)) / SAMPLES) / o.p;
      expect(Math.abs(after - 1)).toBeLessThan(4 * se + 1e-12);
    }
  });

  it('the safe share p is the statics: sweeping 100k offsets across [-s, s] through failingLevel gives p to 1e-4', () => {
    const rng = createRng(seededSource(1202));
    const { offered, autoCashed } = reachedStates(5, rng);
    const N = 100_000;
    for (const st of [...offered.slice(0, 30), ...autoCashed.slice(0, 10)]) {
      const { s } = MODES[st.mode];
      const o = nextOdds(st.xs, s);
      const top = st.xs.length ? st.xs[st.xs.length - 1] : 0;
      let stand = 0;
      for (let i = 0; i < N; i++) if (isStable([...st.xs, top + drawOffset(s, (i + 0.5) / N)])) stand++;
      expect(Math.abs(stand / N - o.p)).toBeLessThan(2 / N + 1e-9);
    }
  });

  it('auto-cash fires exactly where a drop would be too long a shot or pay past the cap, and the game flow equals simulate()', () => {
    const rng = createRng(seededSource(1203));
    const { autoCashed } = reachedStates(5, rng);
    for (const st of autoCashed) {
      const o = nextOdds(st.xs, MODES[st.mode].s);
      const why = stopReason(st.mode, st.xs.length, st.mult, o.p);
      expect(why).not.toBeNull();
      expect(st.mult).toBeLessThanOrEqual(maxMultiplier(st.mode) + 1e-9);
    }
    // Same rng stream, same stop rule: this file's Game-flow loop and the shared simulate() agree round by round.
    for (const mode of MODE_NAMES) {
      const a = createRng(seededSource(77));
      const b = createRng(seededSource(77));
      for (let i = 0; i < 2000; i++) {
        const target = 1 + 30 * a.next();
        b.next();
        const x = playRound(mode, (st) => st.mult >= target, a);
        const y = simulate(mode, (_, m) => m >= target, b.next).multiplier;
        expect(x).toBe(y);
      }
    }
  });

  it('strategies (a)–(d) on every eval config return RTP within 4 SE (importance-sampled; plain Monte Carlo too where the payouts are sampled), never above the mode cap', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params: { mode } }, ci) => {
      STRATEGIES.forEach(({ name, stop, longShot }, si) => {
        const res = mc((r) => playRound(mode, stop, r), ROUNDS, 12100 + 13 * ci + si);
        const is = mc((r) => {
          const { pay, w } = playWeighted(mode, stop, r, LAMBDA);
          return pay * w;
        }, ROUNDS, 12500 + 13 * ci + si);
        rows.push(
          `${label.padEnd(18)} ${name.padEnd(44)} plain ${(res.mean * 100).toFixed(2)}% ± ${(res.se * 100).toFixed(2)}%${longShot ? ' (not asserted)' : ''}  ` +
            `IS ${(is.mean * 100).toFixed(2)}% ± ${(is.se * 100).toFixed(2)}%  max ${res.max.toFixed(1)}×`,
        );
        // Strategies that chase to the cap pay 1,000×+ on ~1 round in 10⁴: plain Monte Carlo's sample SE misses that tail, so only the weighted run decides them.
        if (!longShot) expect(Math.abs(res.mean - RTP)).toBeLessThan(4 * res.se + 1e-12);
        expect(Math.abs(is.mean - RTP)).toBeLessThan(4 * is.se + 1e-12);
        expect(res.max).toBeLessThanOrEqual(maxMultiplier(mode) + 1e-9);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
