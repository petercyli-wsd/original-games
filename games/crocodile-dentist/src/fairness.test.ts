// Fairness audit: no stopping rule, tooth choice, mid-round exit or setting beats the RTP.
//
// Everything goes through the game's own reducer and fairValue:
//  1. The maths can't be changed by the player (the ⚙ Customise drawer used to
//     edit the RTP up to 100%, saved in localStorage).
//  2. The traps are a uniform k-subset (pickTraps), so given any history the
//     bad teeth are a uniform k-subset of the teeth still free.
//  3. Martingale, exact: at ≥ 30 states reached by play (both turns, every
//     bad-teeth option, last rounds included), for every action — cash out, or
//     press any free tooth followed by the House's uniform press — the
//     expected value after the event equals fairValue now. The expectation is
//     an exact enumeration over the posterior (the hypergeometric weights of
//     "your tooth bad / House's tooth bad / both safe"), each outcome played
//     through the reducer with a trap set consistent with the history.
//  4. Adversarial strategies on every eval config: (a) the tester's 80% rule,
//     (b) take any profit, (c) play to the end, (d) the most aggressive mix of
//     pessimistic cash-outs and leaving on the House's turn. Exact over every
//     trap placement (all C(20, k) sets, fixed trap-independent press orders),
//     plus Monte Carlo with random teeth and a uniform House.
import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, loadConfig, withFixedMaths } from './config';
import evalSpec from './eval';
import { fairValue, initialState, reducer, type GameState } from './game';
import manifest from './manifest';
import { BITE, buildLadder, ladderStats, maxMultiplier, pickTraps, winChance } from './math';

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const REPORT = !!ENV.FAIRNESS_REPORT;
const RTP = DEFAULT_CONFIG.rtp;
const N = DEFAULT_CONFIG.teeth;
const KS = DEFAULT_CONFIG.badTeethOptions;
const EVAL_KS = evalSpec.configs.map((c) => (c.params as { k: number }).k);

const start = (k: number, traps: number[], rtp = RTP, n = N): GameState =>
  reducer(initialState(), { type: 'start', bet: 1, N: n, k, rtp, traps });
const freeOf = (s: GameState) => s.round!.pressed.flatMap((p, i) => (p ? [] : [i]));
const live = (s: GameState) => s.phase === 'you' || s.phase === 'house';
/** Value of a state: the settled multiplier once over, else what leaving now settles at. */
const valueOf = (s: GameState) => (live(s) ? fairValue(s, null) : s.history[0].mult);
const withTraps = (s: GameState, traps: number[]): GameState => ({ ...s, round: { ...s.round!, traps } });

/** A k-subset of the free teeth containing `bad` and avoiding `good` (null if impossible). */
function trapSet(free: number[], k: number, bad: number[], good: number[]): number[] | null {
  const rest = free.filter((i) => !bad.includes(i) && !good.includes(i));
  if (bad.length > k || rest.length < k - bad.length) return null;
  return [...bad, ...rest.slice(0, k - bad.length)];
}

/** E[value after the House's press | history], the House picking uniformly. */
function expectHouse(s: GameState): number {
  const free = freeOf(s);
  const n = free.length;
  const k = s.round!.k;
  let e = 0;
  for (const j of free) {
    for (const [bad, w] of [[true, k / n], [false, (n - k) / n]] as const) {
      if (w === 0) continue;
      const t = trapSet(free, k, bad ? [j] : [], bad ? [] : [j])!;
      e += (w / n) * valueOf(reducer(withTraps(s, t), { type: 'pressHouse', i: j }));
    }
  }
  return e;
}

/** E[value after you press tooth i and the House answers | history]. */
function expectPress(s: GameState, i: number): number {
  const free = freeOf(s);
  const n = free.length;
  const k = s.round!.k;
  let e = (k / n) * valueOf(reducer(withTraps(s, trapSet(free, k, [i], [])!), { type: 'pressYou', i }));
  if (n > k) {
    // Your tooth is safe: the House's turn, where the posterior is again uniform.
    const t = trapSet(free, k, [], [i])!;
    const s1 = reducer(withTraps(s, t), { type: 'pressYou', i });
    e += ((n - k) / n) * expectHouse(s1);
  }
  return e;
}

// ---------- strategies ----------
type Decide = (s: GameState) => 'press' | 'cash' | 'leave';
const ownRisk = (s: GameState) => s.round!.k / freeOf(s).length;
const STRATEGIES: [string, Decide][] = [
  // (a) the tester: press only while your press is ≥ 80% safe, else cash out (the first round has no cash-out).
  ['(a) tester 80% rule', (s) => (s.phase === 'you' && s.round!.r > 0 && 1 - ownRisk(s) < 0.8 ? 'cash' : 'press')],
  // (b) take any profit: cash the first time the cash-out exceeds the stake.
  ['(b) any profit', (s) => (s.phase === 'you' && s.round!.r > 0 && s.round!.cashMult > 1 ? 'cash' : 'press')],
  // (c) play to the end.
  ['(c) play to the end', () => 'press'],
  // (d) cash out whenever the chance of winning from here drops under 30%; leave the page on the House's
  //     turn whenever the House-bitten prize is over 3× (settles at the House's already-picked tooth).
  [
    '(d) pessimist + leave on House turn',
    (s) => {
      const rd = s.round!;
      if (s.phase === 'house') return rd.ladder[rd.r].bite > 3 ? 'leave' : 'press';
      if (rd.r > 0 && winChance(freeOf(s).length, rd.k, 'you') < 0.3) return 'cash';
      return 'press';
    },
  ],
];

/** One round through the reducer. `pickYou` / `pickHouse` choose teeth; the House's pick is fixed before a leave. */
function play(s: GameState, decide: Decide, pickYou: (f: number[]) => number, pickHouse: (f: number[]) => number): number {
  while (live(s)) {
    const d = decide(s);
    if (s.phase === 'you') {
      if (d === 'cash') s = reducer(s, { type: 'cashOut' });
      else if (d === 'leave') return fairValue(s, null);
      else s = reducer(s, { type: 'pressYou', i: pickYou(freeOf(s)) });
    } else {
      const j = pickHouse(freeOf(s)); // App: housePick is set the moment the House's turn starts
      if (d === 'leave') return fairValue(s, j);
      s = reducer(s, { type: 'pressHouse', i: j });
    }
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

/** Exact RTP over every trap placement (fixed press orders: you lowest free, House highest free). */
function exactRtp(k: number, decide: Decide): number {
  let sum = 0;
  let count = 0;
  for (const traps of subsets(N, k)) {
    sum += play(start(k, traps), decide, (f) => f[0], (f) => f[f.length - 1]);
    count++;
  }
  return sum / count;
}

/** Monte Carlo with random teeth and a uniform House, as in the app. */
function mcRtp(k: number, decide: Decide, rng: Rng, minRounds: number) {
  let sum = 0;
  let sq = 0;
  let n = 0;
  const pick = (f: number[]) => f[rng.int(f.length)];
  for (;;) {
    for (let i = 0; i < 5_000; i++) {
      const m = play(start(k, pickTraps(N, k, rng)), decide, pick, pick);
      sum += m;
      sq += m * m;
    }
    n += 5_000;
    const mean = sum / n;
    const se = Math.sqrt(Math.max(0, sq / n - mean * mean) / n);
    // Report runs keep going until the SE is under 0.3%.
    if (n >= minRounds && (!REPORT || se <= 0.0029 || n >= 4_000_000)) return { mean, se, n };
  }
}

describe('Croc Dentist (vs House) fairness', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('the player cannot change the maths (the drawer once allowed RTP up to 100%)', () => {
    const saved = { rtp: 1, teeth: 24, badTeethOptions: [23], defaultBadTeeth: 23, houseDelay: 0 };
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(saved), setItem: () => {} });
    const cfg = loadConfig();
    expect(cfg.rtp).toBe(RTP);
    expect(cfg.teeth).toBe(N);
    expect(cfg.badTeethOptions).toEqual(KS);
    expect(cfg.houseDelay).toBe(0); // pace is still the player's
    expect(withFixedMaths({ ...DEFAULT_CONFIG, rtp: 1, teeth: 4 })).toEqual(DEFAULT_CONFIG);
    // What the hole was worth: every strategy returns the configured RTP, so 100% at rtp = 1, and a
    // custom jaw paid far above the manifest's max.
    const rtp1 = exactRtpWith(4, 1);
    expect(rtp1).toBeCloseTo(1, 12);
    const customMax = Math.max(...Array.from({ length: 23 }, (_, k) => maxMultiplier(24, [k + 1], 1)));
    expect(customMax).toBeGreaterThan(manifest.maxMultiplier);
    if (REPORT) console.log(`pre-fix: RTP with drawer rtp=1: ${(rtp1 * 100).toFixed(4)}%; max payout with a custom 24-tooth jaw: ${customMax.toFixed(1)}× (manifest ${manifest.maxMultiplier.toFixed(2)}×)`);
  });

  it('traps are a uniform k-subset', () => {
    const rng = createRng(seededSource(5));
    const n = 60_000;
    const k = 4;
    const hits = new Array(N).fill(0);
    let pair = 0;
    for (let g = 0; g < n; g++) {
      const t = pickTraps(N, k, rng);
      for (const x of t) hits[x]++;
      if (t.includes(0) && t.includes(N - 1)) pair++;
    }
    const p = k / N;
    for (const h of hits) expect(Math.abs(h / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    const pp = (k * (k - 1)) / (N * (N - 1));
    expect(Math.abs(pair / n - pp)).toBeLessThan(4 * Math.sqrt((pp * (1 - pp)) / n));
  });

  it('martingale: every action at ≥ 30 reachable states keeps E[value] = value (exact)', () => {
    const rng = createRng(seededSource(17));
    const states: GameState[] = [];
    for (const k of KS) {
      for (let g = 0; g < 4; g++) {
        let s = start(k, pickTraps(N, k, rng));
        while (live(s)) {
          states.push(s);
          const f = freeOf(s);
          // Steer towards long rounds so the last rungs (and the auto cash-out) are covered.
          const safe = f.filter((i) => !s.round!.traps.includes(i));
          const pool = s.phase === 'you' && safe.length && rng.next() < 0.8 ? safe : s.phase === 'house' && safe.length && rng.next() < 0.8 ? safe : f;
          s = reducer(s, { type: s.phase === 'you' ? 'pressYou' : 'pressHouse', i: pool[rng.int(pool.length)] });
        }
      }
    }
    expect(states.length).toBeGreaterThanOrEqual(30);
    let lastRungs = 0;
    for (const s of states) {
      const rd = s.round!;
      const V = fairValue(s, null);
      if (rd.r === rd.ladder.length - 1) lastRungs++;
      if (s.phase === 'you') {
        if (rd.r > 0) expect(reducer(s, { type: 'cashOut' }).history[0].mult).toBeCloseTo(V, 12);
        else expect(reducer(s, { type: 'cashOut' })).toBe(s); // no cash-out before the first round
        for (const i of freeOf(s)) expect(Math.abs(expectPress(s, i) - V) / V).toBeLessThan(1e-9);
      } else {
        expect(Math.abs(expectHouse(s) - V) / V).toBeLessThan(1e-9);
        // Leaving once the House has picked settles at the resolved value.
        for (const j of freeOf(s)) {
          const after = reducer(s, { type: 'pressHouse', i: j });
          expect(fairValue(s, j)).toBeCloseTo(after.phase === 'over' ? after.history[0].mult : fairValue(after, null), 12);
        }
      }
    }
    expect(lastRungs).toBeGreaterThan(0);
  });

  it('adversarial strategies return exactly the RTP over every trap placement', () => {
    for (const k of EVAL_KS) {
      for (const [name, decide] of STRATEGIES) {
        const r = exactRtp(k, decide);
        if (REPORT) console.log(`k=${k} | ${name} | exact ${(r * 100).toFixed(6)}%`);
        expect(Math.abs(r - RTP)).toBeLessThan(1e-9);
      }
    }
  });

  it('adversarial strategies, Monte Carlo with random teeth and a uniform House (4 SE)', () => {
    const rng = createRng(seededSource(23));
    for (const k of EVAL_KS) {
      for (const [name, decide] of STRATEGIES) {
        const r = mcRtp(k, decide, rng, REPORT ? 200_000 : 5_000);
        if (REPORT) console.log(`k=${k} | ${name} | MC ${(r.mean * 100).toFixed(3)}% ± ${(r.se * 100).toFixed(3)} (${r.n} rounds)`);
        expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-12);
      }
    }
  });

  it('the manifest max is an honest bound for the shipped settings', () => {
    for (const k of KS) expect(ladderStats(buildLadder(N, k, BITE, RTP)).max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
  });
});

/** Exact RTP of play-to-the-end at a given ladder RTP (for the pre-fix drawer exploit). */
function exactRtpWith(k: number, rtp: number): number {
  let sum = 0;
  let count = 0;
  for (const traps of subsets(N, k)) {
    sum += play(start(k, traps, rtp), () => 'press', (f) => f[0], (f) => f[f.length - 1]);
    count++;
  }
  return sum / count;
}
