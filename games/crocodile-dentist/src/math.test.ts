import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import evalSpec from './eval';
import { fairValue, initialState, reducer, type GameState } from './game';
import manifest from './manifest';
import { BITE, buildLadder, cardValue, ladderStats, pickTraps, winChance } from './math';

const rng = createRng(seededSource(7));
const RTP = 0.99;
const N = DEFAULT_CONFIG.teeth;
const KS = DEFAULT_CONFIG.badTeethOptions;

// The shipped settings, plus other jaw sizes so the formulas are checked generally.
const CONFIGS: [number, number][] = [...KS.map((k) => [N, k] as [number, number])];
for (const n of [8, 11, 12, 15]) for (let k = 1; k < n; k++) CONFIGS.push([n, k]);

// Exact expected return of the strategy "cash out after `stop` rounds" (Infinity = play to the end).
function exactReturn(n: number, k: number, stop: number) {
  const ladder = buildLadder(n, k, BITE, RTP);
  let reach = 1;
  let ev = 0;
  for (let r = 0; r < ladder.length; r++) {
    if (r === stop) return ev + reach * ladder[r].cash;
    const g = ladder[r];
    ev += reach * g.pHouse * g.bite;
    reach *= g.pBoth;
  }
  const last = ladder[ladder.length - 1];
  return ev + (last.pBoth > 0 ? reach * last.next : 0);
}

const start = (k: number, n = N): GameState =>
  reducer(initialState(), { type: 'start', bet: 1, N: n, k, rtp: RTP, traps: pickTraps(n, k, rng) });
const free = (s: GameState) => s.round!.pressed.flatMap((p, i) => (p ? [] : [i]));

describe('ladder maths', () => {
  it('returns exactly the RTP for every cash-out round', () => {
    for (const [n, k] of CONFIGS) {
      const rounds = buildLadder(n, k, BITE, RTP).length;
      for (let stop = 1; stop <= rounds + 1; stop++) expect(exactReturn(n, k, stop)).toBeCloseTo(RTP, 10);
    }
  });

  it('is a martingale: every round is worth its cash-out, and the House press moves value both ways', () => {
    for (const [n, k] of CONFIGS) {
      for (const g of buildLadder(n, k, BITE, RTP)) {
        expect(g.pYou + g.pHouse + g.pBoth).toBeCloseTo(1, 12);
        expect(g.pHouse * g.bite + g.pBoth * g.next).toBeCloseTo(g.cash, 10);
        expect(g.bite).toBeCloseTo(BITE * g.next, 12);
        expect(g.pYou).toBeLessThan(1); // a certain bite is never offered
        expect(cardValue(g)).toBeGreaterThan(g.cash);
      }
    }
  });

  it('the bad-teeth knob spans 50% to 5% chance and a calm-to-wild prize range', () => {
    const chances = KS.map((k) => ladderStats(buildLadder(N, k, BITE, RTP)).winChance);
    expect(chances[0]).toBeCloseTo(0.5, 12);
    expect(chances[chances.length - 1]).toBeCloseTo(1 / N, 12);
    for (let i = 1; i < chances.length; i++) expect(chances[i]).toBeLessThan(chances[i - 1]);
  });

  it('picks distinct traps in range', () => {
    for (let i = 0; i < 200; i++) {
      const t = pickTraps(N, 7, rng);
      expect(new Set(t).size).toBe(7);
      t.forEach((x) => expect(x >= 0 && x < N).toBe(true));
    }
  });
});

describe('live chance to win (the green bar)', () => {
  it('matches the ladder at the start and satisfies its recursion', () => {
    for (const [n, k] of CONFIGS) {
      expect(winChance(n, k, 'you')).toBeCloseTo(ladderStats(buildLadder(n, k, BITE, RTP)).winChance, 12);
      for (let m = k + 1; m <= n; m++) {
        expect(winChance(m, k, 'you')).toBeCloseTo(((m - k) / m) * winChance(m - 1, k, 'house'), 12);
        expect(winChance(m, k, 'house')).toBeCloseTo(k / m + ((m - k) / m) * winChance(m - 1, k, 'you'), 12);
      }
    }
  });

  it('matches a direct simulation of the raw process (shuffled teeth, alternate presses)', () => {
    for (const k of [1, 4, 7, 12]) {
      const games = 20000;
      let wins = 0;
      for (let g = 0; g < games; g++) {
        // Order of presses is a uniform shuffle; you press positions 0, 2, 4…
        const order = rng.shuffle(Array.from({ length: N }, (_, i) => i < k));
        // You win if the House meets the first bad tooth, or if every good
        // tooth is pressed first (auto cash-out).
        const first = order.indexOf(true);
        if (first % 2 === 1 || first === N - k) wins++;
      }
      const p = winChance(N, k, 'you');
      const se = Math.sqrt((p * (1 - p)) / games);
      expect(Math.abs(wins / games - p)).toBeLessThan(4 * se);
    }
  });

  it('the tooth bar shows the true bite risk: k red of the teeth still in play', () => {
    for (let g = 0; g < 300; g++) {
      const k = KS[rng.int(KS.length)];
      let s = start(k);
      while (s.phase === 'you' || s.phase === 'house') {
        const f = free(s);
        // Exactly k of the free teeth are bad, so the bar's red share is k / free.
        expect(f.filter((i) => s.round!.traps.includes(i)).length).toBe(k);
        s = reducer(s, { type: s.phase === 'you' ? 'pressYou' : 'pressHouse', i: f[rng.int(f.length)] });
      }
    }
  });
});

describe('leaving mid-round settles fairly', () => {
  it('on the House turn the resolved value averages to the fair value', () => {
    for (const k of KS) {
      let s = start(k);
      const f = free(s);
      const safe = f.find((i) => !s.round!.traps.includes(i));
      if (safe === undefined) continue;
      s = reducer(s, { type: 'pressYou', i: safe });
      const left = free(s);
      const avg = left.reduce((a, i) => a + fairValue(s, i), 0) / left.length;
      expect(avg).toBeCloseTo(fairValue(s, null), 10);
      // and before your press it is the start value, RTP
      expect(fairValue(start(k), null)).toBeCloseTo(RTP, 12);
    }
  });
});

// Plays real games through the reducer with random presses.
function simulate(k: number, games: number, cashAfter = Infinity) {
  let sum = 0;
  let sq = 0;
  for (let g = 0; g < games; g++) {
    let s = start(k);
    while (s.phase === 'you' || s.phase === 'house') {
      const f = free(s);
      if (s.phase === 'you' && s.round!.r >= cashAfter) s = reducer(s, { type: 'cashOut' });
      else s = reducer(s, { type: s.phase === 'you' ? 'pressYou' : 'pressHouse', i: f[rng.int(f.length)] });
    }
    sum += s.history[0].mult;
    sq += s.history[0].mult ** 2;
  }
  const mean = sum / games;
  return { mean, se: Math.sqrt((sq / games - mean * mean) / games) };
}

describe('game reducer (Monte Carlo)', () => {
  it('returns the RTP when playing to the end and when cashing out after 2 rounds', () => {
    for (const [k, stop] of [[1, Infinity], [4, Infinity], [7, 2], [12, Infinity]] as const) {
      const { mean, se } = simulate(k, 30000, stop);
      expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
    }
  });

  it('runEval matches the manifest RTP, stays under maxMultiplier and spreads volatility at least 5x', () => {
    const reports = runEval(evalSpec, { rounds: 50_000 });
    for (const r of reports) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
    }
    const sds = reports.map((r) => r.stdDev);
    expect(sds[sds.length - 1]).toBeGreaterThanOrEqual(5 * sds[0]);
  });
});
