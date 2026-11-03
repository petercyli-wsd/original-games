// Fairness audit: no strategy beats the RTP.
//
// Decisions in a Derby round, at each checkpoint (after every leg): cash out,
// run the next leg, or switch the whole value to another runner (the prize
// relocks at V / P(new)). The legs are drawn by the real `leg`/`tick` on the
// host rng; the win chances come from the exact crossing-time tables.
//
// 1. Martingale: at ≥ 30 reachable states (early, mid and near the line, on
//    every track), the real `tick` is driven through every joint stride of the
//    six runners (64–96 outcomes, each with its exact probability), and for
//    EVERY runner E[share of the win after the tick] = P(win now). Since a
//    switch relocks at V / P(j), the value after any action is prize_j ·
//    share_j, so this covers cashing, running on and every possible switch.
//    A leg is three ticks, so the tower property gives the leg checkpoint.
// 2. Strategies: (a) the tester's, (b) take any profit, (c) ride to the line,
//    (d1) hop to the longest shot each leg, (d2) hop to the favourite and bank
//    any profit — simulated with the game's own leg/winChances/switchPrize.
//    The test runs are light; <scratchpad>/fairness/derby-strategies.ts runs
//    200k+ rounds per strategy and config.
import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { FIELD, GAITS, LEG, MAX_WIN, RTP, TRACKS, chanceOf, dists, drawStride, indexTime, leg, payout, startPrize, switchPrize, tick, winChances, type Track } from './math';

const n = FIELD.length;

/** Reachable live positions on track L: checkpoints of random races, keeping some near the line. */
function reachable(L: Track, want: number, seed: number): number[][] {
  const rng = createRng(seededSource(seed));
  const out: number[][] = [];
  let near = 0;
  while (out.length < want) {
    let pos = FIELD.map(() => 0);
    const keepAt = rng.int(8);
    for (let legs = 0; ; legs++) {
      const ticks = leg(pos, L, rng.next);
      const last = ticks[ticks.length - 1];
      if (last.winners) break;
      pos = last.pos;
      const lead = Math.max(...pos);
      // Keep a mix: a random leg of the race, and the last checkpoints before the line.
      if (legs === keepAt || (lead >= L - 3 && near < want / 3)) {
        out.push(pos);
        if (lead >= L - 3) near++;
        break;
      }
    }
  }
  return out;
}

/** Drives the real `tick` through every joint stride: uniforms at the middle of each stride's cell. */
function everyTick(pos: readonly number[], L: Track, visit: (t: ReturnType<typeof tick>, prob: number) => void) {
  const laws = FIELD.map((r, i) => GAITS[r.gait].law(pos[i], L));
  const cells = laws.map((law) => {
    let acc = 0;
    return law.map(([s, p]) => {
      const u = acc + p / 2;
      acc += p;
      return { s, p, u };
    });
  });
  const pick = new Array<number>(n).fill(0);
  const walk = (i: number, prob: number) => {
    if (i === n) {
      let k = 0;
      const t = tick(pos, L, () => cells[k][pick[k++]].u);
      // The scripted uniforms really produced the intended strides.
      for (let j = 0; j < n; j++) expect(t.strides[j]).toBe(cells[j][pick[j]].s);
      visit(t, prob);
      return;
    }
    for (let c = 0; c < cells[i].length; c++) {
      pick[i] = c;
      walk(i + 1, prob * cells[i][c].p);
    }
  };
  walk(0, 1);
}

type Ctx = { L: Track; pos: number[]; me: number; prize: number; hops: number; rng: { next(): number; int(n: number): number } };
/** At a checkpoint: 'cash', 'run', or a runner index to switch to (then run). */
type Decide = (c: Ctx) => 'cash' | 'run' | number;

/** P(no other runner crosses within the next leg): the tester's "survive the next step". */
function survival(pos: readonly number[], L: Track, me: number): number {
  const D = dists(pos, L);
  let s = 1;
  for (let j = 0; j < n; j++) {
    if (j === me) continue;
    let q = 0;
    for (let i = 0; i < D[j].length && indexTime(i) <= LEG; i++) q += D[j][i];
    s *= 1 - q;
  }
  return s;
}

const STRATEGIES: Record<string, Decide> = {
  // (a) the tester: run on while the next leg is ≥ 80% safe from another runner finishing, else cash.
  tester: ({ L, pos, me }) => (survival(pos, L, me) >= 0.8 ? 'run' : 'cash'),
  // (b) take any profit.
  profit: ({ L, pos, me, prize }) => (prize * chanceOf(pos, L, me) > 1 ? 'cash' : 'run'),
  // (c) ride to the line.
  ride: () => 'run',
  // (d1) maximum variance: hop onto the longest shot the cap allows, then bank
  // the leg after (riding the longshot to the line is in the scratch run: at
  // test-sized samples it almost never pays, so its SE says nothing).
  longshot: ({ L, pos, me, prize, hops }) => {
    if (hops > 0) return 'cash';
    const P = winChances(pos, L);
    const v = prize * P[me];
    let best = -1;
    for (let j = 0; j < n; j++) if (j !== me && switchPrize(v, P[j]) !== null && (best < 0 || P[j] < P[best])) best = j;
    return best >= 0 && P[best] < P[me] ? best : 'run';
  },
  // (d2) hop to the favourite and bank as soon as the ticket shows a profit.
  favourite: ({ L, pos, me, prize }) => {
    const P = winChances(pos, L);
    if (prize * P[me] > 1.05) return 'cash';
    const fav = P.indexOf(Math.max(...P));
    return fav !== me ? fav : 'run';
  },
};

/** One round, mirroring Game.tsx runLeg / cashOut / switchTo. Returns the payout multiplier. */
function playDerby(L: Track, first: number, decide: Decide, rng: Ctx['rng']): number {
  let me = first;
  let prize = startPrize(L, me);
  let hops = 0;
  let pos = FIELD.map(() => 0);
  for (;;) {
    const ticks = leg(pos, L, rng.next);
    const end = ticks[ticks.length - 1];
    if (end.winners) return payout(prize, me, end.winners);
    pos = end.pos;
    const p = chanceOf(pos, L, me);
    if (p <= 0) return 0;
    if (p >= 1 - 1e-12) return prize * p;
    const d = decide({ L, pos, me, prize, hops, rng });
    if (d === 'cash') return prize * p;
    if (typeof d === 'number') {
      const P = winChances(pos, L);
      const next = switchPrize(prize * P[me], P[d]);
      if (next !== null) {
        me = d;
        prize = next;
        hops++;
      }
    }
  }
}

describe('Derby fairness', () => {
  it('draws each stride with its stated chance (drawStride cells have the law’s widths)', () => {
    for (const r of FIELD) {
      for (const x of [0, 9, 10, 19]) {
        const law = GAITS[r.gait].law(x, 20);
        let acc = 0;
        for (const [s, p] of law) {
          expect(drawStride(law, acc + 1e-12)).toBe(s);
          expect(drawStride(law, Math.min(acc + p, 1) - 1e-9)).toBe(s);
          acc += p;
        }
        expect(acc).toBeCloseTo(1, 15);
      }
    }
  });

  it('martingale over the real tick, for every runner (so for cash, run and every switch), at ≥ 30 states', () => {
    let states = 0;
    for (const L of TRACKS) {
      for (const pos of reachable(L, 11, L)) {
        const P = winChances(pos, L);
        const after = new Array<number>(n).fill(0);
        everyTick(pos, L, (t, prob) => {
          const share = t.winners ? FIELD.map((_, j) => payout(1, j, t.winners!)) : winChances(t.pos, L);
          for (let j = 0; j < n; j++) after[j] += prob * share[j];
        });
        for (let j = 0; j < n; j++) expect(Math.abs(after[j] - P[j]), `L=${L} pos=${pos} runner ${j}`).toBeLessThan(1e-10);
        // The relock keeps the value for every allowed switch, including right at the cap.
        for (const v of [0.4, RTP, 3, 0.999 * MAX_WIN * Math.min(...P.filter((q) => q > 0))]) {
          for (let j = 0; j < n; j++) {
            const np = switchPrize(v, P[j]);
            if (np === null) expect(P[j] <= 0 || v / P[j] > MAX_WIN).toBe(true);
            else expect(Math.abs(np * P[j] - v)).toBeLessThan(1e-12 * Math.max(1, v));
          }
        }
        states++;
      }
    }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  it('every strategy is within 4 SE of RTP for every eval config (light run)', () => {
    for (const { params } of evalSpec.configs) {
      for (const [name, decide] of Object.entries(STRATEGIES)) {
        // Every checkpoint prices the tote, so these runs are short; the plodder
        // (extreme) races are cheap and heavy-tailed, so they get more rounds.
        const heavy = name !== 'ride';
        const extreme = params.me === 5;
        const rounds = (heavy ? 150 : 3_000) * (extreme ? 20 : 1);
        const rng = createRng(seededSource(params.L * 31 + params.me * 7 + name.length));
        let sum = 0;
        let sq = 0;
        for (let i = 0; i < rounds; i++) {
          const m = playDerby(params.L, params.me, decide, rng);
          expect(m).toBeLessThanOrEqual(MAX_WIN);
          sum += m;
          sq += m * m;
        }
        const mean = sum / rounds;
        const se = Math.sqrt((sq / rounds - mean * mean) / rounds);
        expect(Math.abs(mean - RTP), `${name} L=${params.L} #${params.me + 1}: ${mean.toFixed(4)} ± ${se.toFixed(4)}`).toBeLessThan(4 * se + 1e-9);
      }
    }
  });
});
