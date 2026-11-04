// Fairness audit: no stopping rule, tooth choice or mid-round exit beats the RTP.
//
// Everything goes through the game's reducer and fairValue:
//  1. Traps are a uniform k-subset, so after any history the bad teeth are a
//     uniform k-subset of the teeth still free.
//  2. Martingale, exact: at ≥ 30 states reached by play (every board in the
//     panel, last presses included), cash out, leave, or press any free tooth:
//     E[value after] = value now. Exact over the posterior (k/n bite), each
//     outcome played through the reducer with a trap set consistent with the history.
//  3. Adversarial strategies on every eval config: (a) the tester's 80% rule,
//     (b) take any profit, (c) press every good tooth, (d) leave the page instead
//     of pressing whenever the bite risk is high. Exact over every trap placement,
//     plus Monte Carlo with random teeth.
import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { banked, fairValue, initialState, reducer, type GameState } from './game';
import { BAD_TEETH_OPTIONS, RTP, TEETH_OPTIONS } from './manifest';
import { pickTraps } from './math';

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const REPORT = !!ENV.FAIRNESS_REPORT;
const BOARDS = evalSpec.configs.map((c) => c.params as { N: number; k: number });

const start = (N: number, k: number, traps: number[]): GameState => reducer(initialState(), { type: 'start', bet: 1, N, k, rtp: RTP, traps });
const freeOf = (s: GameState) => s.round!.pressed.flatMap((p, i) => (p ? [] : [i]));
const live = (s: GameState) => s.phase === 'playing';
const valueOf = (s: GameState) => (live(s) ? fairValue(s) : s.history[0].mult);
const withTraps = (s: GameState, traps: number[]): GameState => ({ ...s, round: { ...s.round!, traps } });
const risk = (s: GameState) => s.round!.k / freeOf(s).length;

/** E[value after pressing tooth i | history]: bad with chance k/n, played through the reducer. */
function expectPress(s: GameState, i: number): number {
  const free = freeOf(s);
  const n = free.length;
  const k = s.round!.k;
  const others = free.filter((x) => x !== i);
  const bad = reducer(withTraps(s, [i, ...others.slice(0, k - 1)]), { type: 'press', i });
  const good = reducer(withTraps(s, others.slice(0, k)), { type: 'press', i });
  return (k / n) * valueOf(bad) + ((n - k) / n) * valueOf(good);
}

type Decide = (s: GameState) => 'press' | 'cash' | 'leave';
const STRATEGIES: [string, Decide][] = [
  // (a) the tester: press while the next press is ≥ 80% safe, else cash out (nothing to cash before the first press).
  ['(a) tester 80% rule', (s) => (s.round!.safe > 0 && 1 - risk(s) < 0.8 ? 'cash' : 'press')],
  // (b) take any profit: cash the moment the cash-out exceeds the stake.
  ['(b) any profit', (s) => (banked(s.round!) > 1 ? 'cash' : 'press')],
  // (c) press every good tooth.
  ['(c) play to the end', () => 'press'],
  // (d) close the game instead of pressing whenever the bite risk is 20% or more (settles at fairValue).
  ['(d) leave when risky', (s) => (risk(s) >= 0.2 ? 'leave' : 'press')],
];

function play(s: GameState, decide: Decide, pick: (f: number[]) => number): number {
  while (live(s)) {
    const d = decide(s);
    if (d === 'leave') return fairValue(s);
    s = d === 'cash' ? reducer(s, { type: 'cashOut' }) : reducer(s, { type: 'press', i: pick(freeOf(s)) });
  }
  return s.history[0].mult;
}

function* subsets(n: number, k: number): Generator<number[]> {
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    yield idx.slice();
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

/** Exact mean and standard deviation of the multiplier over every trap placement. */
function exact(N: number, k: number, decide: Decide) {
  let sum = 0;
  let sq = 0;
  let count = 0;
  for (const traps of subsets(N, k)) {
    const m = play(start(N, k, traps), decide, (f) => f[0]);
    sum += m;
    sq += m * m;
    count++;
  }
  const mean = sum / count;
  return { mean, sd: Math.sqrt(Math.max(0, sq / count - mean * mean)) };
}

/** Monte Carlo with random teeth. The SE uses the exact sd: a rare jackpot (20/5 to the end is 1 in 15,504) would otherwise show SE 0. */
function mcRtp(N: number, k: number, decide: Decide, rng: Rng, rounds: number, sd: number) {
  let sum = 0;
  const pick = (f: number[]) => f[rng.int(f.length)];
  for (let i = 0; i < rounds; i++) sum += play(start(N, k, pickTraps(N, k, rng)), decide, pick);
  return { mean: sum / rounds, se: sd / Math.sqrt(rounds), n: rounds };
}

describe('Croc Dentist (Solo) fairness', () => {
  it('traps are a uniform k-subset', () => {
    const rng = createRng(seededSource(5));
    const n = 60_000;
    const [N, k] = [12, 3];
    const hits = new Array(N).fill(0);
    for (let g = 0; g < n; g++) for (const x of pickTraps(N, k, rng)) hits[x]++;
    const p = k / N;
    for (const h of hits) expect(Math.abs(h / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
  });

  it('martingale: cash, leave or press any tooth keeps E[value] = value at ≥ 30 states (exact)', () => {
    const rng = createRng(seededSource(9));
    const states: GameState[] = [];
    for (const N of TEETH_OPTIONS)
      for (const k of BAD_TEETH_OPTIONS.filter((x) => x < N)) {
        // Walk the safe teeth so every rung up to the last press is visited.
        let s = start(N, k, pickTraps(N, k, rng));
        while (live(s)) {
          states.push(s);
          const safe = freeOf(s).filter((i) => !s.round!.traps.includes(i));
          s = reducer(s, { type: 'press', i: safe[rng.int(safe.length)] });
        }
        expect(s.history[0].mult).toBeCloseTo(s.round!.ladder[s.round!.ladder.length - 1].mult, 9); // auto cash at the end
      }
    expect(states.length).toBeGreaterThanOrEqual(30);
    for (const s of states) {
      const rd = s.round!;
      const V = fairValue(s);
      expect(V).toBeCloseTo(rd.safe > 0 ? banked(rd) : RTP, 12);
      if (rd.safe > 0) expect(reducer(s, { type: 'cashOut' }).history[0].mult).toBe(V);
      for (const i of freeOf(s)) expect(Math.abs(expectPress(s, i) - V) / V).toBeLessThan(1e-9);
    }
  });

  it('leaving before the first press refunds the fair value, not 0', () => {
    const s = start(12, 1, [3]);
    expect(fairValue(s)).toBe(RTP);
    expect(fairValue(initialState())).toBe(0);
  });

  it('adversarial strategies return exactly the RTP over every trap placement', () => {
    for (const { N, k } of BOARDS)
      for (const [name, decide] of STRATEGIES) {
        const r = exact(N, k, decide);
        if (REPORT) console.log(`${N}/${k} | ${name} | exact ${(r.mean * 100).toFixed(6)}% (sd ${r.sd.toFixed(2)})`);
        expect(Math.abs(r.mean - RTP)).toBeLessThan(1e-9);
      }
  });

  it('adversarial strategies, Monte Carlo with random teeth (4 SE)', () => {
    const rng = createRng(seededSource(31));
    for (const { N, k } of BOARDS)
      for (const [name, decide] of STRATEGIES) {
        const { sd } = exact(N, k, decide);
        // Report runs: enough rounds for SE ≤ 0.3% where that is feasible (≤ 4M rounds); the exact test covers the rest.
        const rounds = REPORT ? Math.min(4_000_000, Math.max(200_000, Math.ceil((sd / 0.0029) ** 2))) : 5_000;
        const r = mcRtp(N, k, decide, rng, rounds, sd);
        if (REPORT) console.log(`${N}/${k} | ${name} | MC ${(r.mean * 100).toFixed(3)}% ± ${(r.se * 100).toFixed(3)} (${r.n} rounds)`);
        expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-12);
      }
  });
});
