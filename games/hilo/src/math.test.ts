import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  AUTO_PICKS,
  MAX_WIN,
  RANKS,
  RTP,
  SKIP_RULES,
  afterWin,
  autoChoice,
  autoRound,
  available,
  chance,
  drawCard,
  factor,
  likelier,
  mainPair,
  maxWinReached,
  skipSet,
  streakChance,
  winningRanks,
  wins,
  withinCap,
  type AutoPick,
  type Guess,
  type SkipRule,
} from './math';

const rng = createRng(seededSource(11));
const ALL: Guess[] = ['higher', 'lower', 'same', 'red', 'black'];
const ranks = Array.from({ length: RANKS }, (_, i) => i + 1);

describe('HiLo odds', () => {
  it('closed-form chances: higher-or-same (14 − r)/13, lower-or-same r/13, ends strict', () => {
    for (const r of ranks) {
      if (r === 1) expect(chance('higher', r)).toBe(12 / 13);
      else if (r === 13) expect(chance('higher', r)).toBe(0);
      else expect(chance('higher', r)).toBeCloseTo((14 - r) / 13, 15);
      if (r === 13) expect(chance('lower', r)).toBe(12 / 13);
      else if (r === 1) expect(chance('lower', r)).toBe(0);
      else expect(chance('lower', r)).toBeCloseTo(r / 13, 15);
      expect(chance('same', r)).toBeCloseTo(1 / 13, 15);
      expect(chance('red', r)).toBe(0.5);
    }
    expect(mainPair(1)).toEqual(['higher', 'same']);
    expect(mainPair(13)).toEqual(['same', 'lower']);
    expect(mainPair(7)).toEqual(['higher', 'lower']);
  });

  it('every offered call matches a direct simulation of the next card (4 SE)', () => {
    const n = 40_000;
    for (const r of [1, 2, 7, 10, 13]) {
      for (const g of ALL) {
        if (!available(g, r, 'extended')) continue;
        const from = { rank: r, suit: 0 };
        let hits = 0;
        for (let i = 0; i < n; i++) if (wins(g, from, drawCard(rng))) hits++;
        const p = chance(g, r);
        expect(Math.abs(hits / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
      }
    }
  });

  it('the ladder lights exactly the winning ranks: lit count / 13 = chance', () => {
    for (const r of ranks)
      for (const g of ['higher', 'lower', 'same'] as Guess[]) {
        const lit = winningRanks(g, r);
        expect(lit.length / RANKS).toBe(chance(g, r));
        for (const x of ranks) expect(wins(g, { rank: r, suit: 0 }, { rank: x, suit: 0 })).toBe(lit.includes(x));
      }
  });

  it('classic offers exactly the two main calls; extended adds Same, Red, Black', () => {
    for (const r of ranks) {
      const classic = ALL.filter((g) => available(g, r, 'classic'));
      expect(classic.sort()).toEqual([...mainPair(r)].sort());
      for (const g of ALL) if (available(g, r, 'extended')) expect(chance(g, r)).toBeGreaterThan(0);
    }
  });
});

describe('HiLo pricing', () => {
  it('each call is a fair bet: chance × payout factor = 1, so E[cash after] = cash', () => {
    for (const r of ranks)
      for (const g of ALL) {
        if (!available(g, r, 'extended')) continue;
        expect(chance(g, r) * factor(g, r)).toBeCloseTo(1, 14);
        const cash = RTP * 3.7;
        expect(chance(g, r) * afterWin(cash, g, r)).toBeCloseTo(cash, 12);
      }
  });

  it('exact enumeration: n calls of any Auto rule are worth exactly RTP', () => {
    // m[r] = E[cash · 1{alive, current rank = r}], pushed through n calls exactly.
    for (const pick of AUTO_PICKS)
      for (const skip of SKIP_RULES) {
        const skipping = skipSet(pick, skip);
        const callable = ranks.filter((r) => !skipping.has(r));
        let m = new Array(RANKS + 1).fill(0);
        for (const r of ranks) m[r] = RTP / RANKS;
        for (let step = 0; step < 6; step++) {
          let held = 0;
          for (const r of skipping) {
            held += m[r];
            m[r] = 0;
          }
          for (const r of callable) m[r] += held / callable.length;
          const next = new Array(RANKS + 1).fill(0);
          for (const r of callable) {
            const calls: [Guess, number][] = pick === 'random' ? [[mainPair(r)[0], 0.5], [mainPair(r)[1], 0.5]] : [[autoChoice(pick, r, skip, 0) as Guess, 1]];
            for (const [g, w] of calls) for (const r2 of winningRanks(g, r)) next[r2] += (m[r] * w * factor(g, r)) / RANKS;
          }
          m = next;
          expect(m.reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(RTP, 12);
        }
      }
  });

  it('exact enumeration: "likelier side, cash out at ×3" returns exactly RTP', () => {
    // V(cash, r) = value of standing on rank r with this cash, before deciding.
    const T = 3;
    const memo = new Map<string, number>();
    const V = (cash: number, r: number, won: number): number => {
      if (won > 0 && cash >= T) return cash;
      const key = `${cash.toPrecision(12)}|${r}|${won > 0}`;
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      const g = likelier(r);
      let v = 0;
      for (const r2 of winningRanks(g, r)) v += V(afterWin(cash, g, r), r2, won + 1) / RANKS;
      memo.set(key, v);
      return v;
    };
    const ev = ranks.reduce((a, r) => a + V(RTP, r, 0), 0) / RANKS;
    expect(ev).toBeCloseTo(RTP, 12);
  });

  it('streak chance (Markov transfer) matches a simulation of the Auto round', () => {
    const cases: [AutoPick, SkipRule, number, number | null][] = [
      ['likelier', 'off', 3, null],
      ['higher', '6-8', 2, null],
      ['random', '5-9', 4, 7],
      ['lower', '7', 5, 13],
    ];
    for (const [pick, skip, n, start] of cases) {
      const p = streakChance(pick, skip, n, start);
      const rounds = 30_000;
      let ok = 0;
      for (let i = 0; i < rounds; i++) {
        const r = autoRound({ pick, skip, stop: { kind: 'streak', value: n }, start: start === null ? null : { rank: start, suit: 0 } }, rng);
        if (r.multiplier > 0) ok++;
      }
      expect(Math.abs(ok / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
    }
    // One call of the likelier side from a random card: (Σ max(14 − r, r)) / 169 with the ends at 12/13.
    const one = ranks.reduce((a, r) => a + chance(likelier(r), r), 0) / RANKS;
    expect(streakChance('likelier', 'off', 1)).toBeCloseTo(one, 14);
  });
});

describe('HiLo auto and max win', () => {
  it('an Auto round resolves exactly once, with a consistent frame trail', () => {
    for (let i = 0; i < 3000; i++) {
      const pick = AUTO_PICKS[rng.int(4)];
      const skip = SKIP_RULES[rng.int(4)];
      const stop = rng.next() < 0.5 ? ({ kind: 'target', value: 1.01 + rng.next() * 20 } as const) : ({ kind: 'streak', value: 1 + rng.int(8) } as const);
      const r = autoRound({ pick, skip, stop, start: null }, rng);
      expect(r.frames[0].action).toBe('start');
      const last = r.frames[r.frames.length - 1];
      if (r.outcome === 'bust') {
        expect(r.multiplier).toBe(0);
        expect(last.won).toBe(false);
      } else {
        expect(r.wins).toBeGreaterThan(0);
        expect(r.multiplier).toBeCloseTo(last.cash, 12);
        if (stop.kind === 'target') expect(r.multiplier).toBeGreaterThanOrEqual(stop.value * (1 - 1e-12));
        else expect(r.wins).toBe(stop.value);
      }
      // Only the last frame can be a losing call.
      expect(r.frames.slice(0, -1).every((f) => f.won !== false)).toBe(true);
    }
  });

  it('the cap is honest: an allowed call never pays above MAX_WIN, and Auto stops at it', () => {
    for (let i = 0; i < 2000; i++) {
      const cash = MAX_WIN * rng.next() * 1.2;
      const r = 1 + rng.int(13);
      for (const g of ALL) if (available(g, r, 'extended') && withinCap(cash, g, r)) expect(afterWin(cash, g, r)).toBeLessThanOrEqual(MAX_WIN * (1 + 1e-12));
    }
    expect(maxWinReached(MAX_WIN * 0.92)).toBe(false);
    expect(maxWinReached(MAX_WIN * 0.93)).toBe(true);
    const big = autoRound({ pick: 'random', skip: 'off', stop: { kind: 'target', value: 1e12 }, start: null }, createRng(seededSource(5)));
    expect(big.multiplier).toBeLessThanOrEqual(MAX_WIN);
    expect(manifest.maxMultiplier).toBe(MAX_WIN);
  });

  it('simulated RTP matches the manifest under every sampled strategy', () => {
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
