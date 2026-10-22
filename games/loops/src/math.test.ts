import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BOX_COUNTS,
  MAX_MULTIPLIER,
  RTP,
  SHARES,
  bustChanceNext,
  candidates,
  cashValue,
  closeChance,
  fitChance,
  fitTable,
  follow,
  lastChance,
  limitFor,
  loopFitChance,
  loopsOf,
  newBoard,
  open,
  pickFor,
  prizeFor,
  remaining,
  ruler,
  winChance,
  winChanceAt,
  type Board,
} from './math';

const rng = createRng(seededSource(13));
const randomPick = (b: Board) => rng.int(candidates(b).length);
const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

const longest = (perm: number[]) => Math.max(...loopsOf(perm).map((l) => l.length));

function* permutations(n: number): Generator<number[]> {
  const a = [...Array(n).keys()];
  function* rec(l: number): Generator<number[]> {
    if (l === n) return yield a;
    for (let i = l; i < n; i++) {
      [a[l], a[i]] = [a[i], a[l]];
      yield* rec(l + 1);
      [a[l], a[i]] = [a[i], a[l]];
    }
  }
  yield* rec(0);
}

/** A random reachable live board for these settings (or null if the random play ended it). */
function randomLiveBoard(n: number, limit: number): Board | null {
  let b = newBoard(n, limit);
  const steps = rng.int(n);
  for (let i = 0; i < steps && b.status === 'live'; i++) b = open(b, randomPick(b));
  return b.status === 'live' ? b : null;
}

const allSettings = BOX_COUNTS.flatMap((n) => SHARES.map((s) => ({ n, limit: limitFor(n, s) })));

describe('Loops maths', () => {
  it('the limits are the advertised shares, and the win chance spans more than 25:1', () => {
    expect(BOX_COUNTS.map((n) => limitFor(n, '1/2'))).toEqual([4, 6, 10, 15]);
    expect(BOX_COUNTS.map((n) => limitFor(n, '1/4'))).toEqual([2, 3, 5, 8]);
    expect(BOX_COUNTS.map((n) => limitFor(n, '3/4'))).toEqual([6, 9, 15, 23]);
    const ps = allSettings.map(({ n, limit }) => fitChance(n, limit));
    expect(Math.max(...ps) / Math.min(...ps)).toBeGreaterThan(25);
    expect(MAX_MULTIPLIER).toBeCloseTo(Math.max(...allSettings.map(({ n, limit }) => prizeFor(n, limit))), 12);
  });

  it('the recursion counts permutations exactly (every n ≤ 8 and every limit)', () => {
    for (let n = 1; n <= 8; n++) {
      const fits = new Array<number>(n + 1).fill(0);
      let total = 0;
      for (const p of permutations(n)) {
        total++;
        for (let L = longest(p); L <= n; L++) fits[L]++;
      }
      for (let L = 1; L <= n; L++) expect(fitChance(n, L)).toBeCloseTo(fits[L] / total, 13);
    }
  });

  it('for limits ≥ n/2 it is 1 − Σ_{k>L} 1/k, and the 100 prisoners rule tends to 1 − ln 2', () => {
    for (const n of BOX_COUNTS) {
      for (let L = Math.ceil(n / 2); L <= n; L++) {
        let tail = 0;
        for (let k = L + 1; k <= n; k++) tail += 1 / k;
        expect(fitChance(n, L)).toBeCloseTo(1 - tail, 12);
      }
    }
    expect(fitChance(100, 50)).toBeCloseTo(0.3118278206898, 10);
    expect(fitChance(4000, 2000)).toBeCloseTo(1 - Math.log(2), 3);
  });

  it('random permutations have every loop within the limit exactly as often as the formula says', () => {
    for (const { n, limit } of [
      { n: 8, limit: 3 },
      { n: 12, limit: 6 },
      { n: 20, limit: 7 },
      { n: 20, limit: 5 },
      { n: 30, limit: 15 },
      { n: 30, limit: 8 },
    ]) {
      const rounds = 20000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) if (longest(rng.shuffle([...Array(n).keys()])) <= limit) wins++;
      const p = fitChance(n, limit);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-9);
    }
  });

  it('playing a hidden permutation to the end wins exactly when its longest loop fits', () => {
    for (const { n, limit } of allSettings) {
      for (let t = 0; t < 40; t++) {
        const perm = rng.shuffle([...Array(n).keys()]);
        let b = newBoard(n, limit);
        while (b.status === 'live') b = open(b, pickFor(b, perm));
        expect(b.status === 'won').toBe(longest(perm) <= limit);
        // Every opened box shows its true arrow, and the closed loops are the permutation's own.
        b.inside.forEach((x, i) => x >= 0 && expect(x).toBe(perm[i]));
        expect(b.loops).toEqual(loopsOf(perm).slice(0, b.loops.length));
      }
    }
  });

  it('the live win chance is the true conditional chance along real permutations', () => {
    const n = 12;
    const limit = 6;
    const seen = new Map<string, { visits: number; wins: number }>();
    for (let r = 0; r < 40000; r++) {
      const perm = rng.shuffle([...Array(n).keys()]);
      const win = longest(perm) <= limit;
      let b = newBoard(n, limit);
      while (b.status === 'live') {
        const k = `${remaining(b)},${b.chain.length ? b.chain.length - 1 : 0}`;
        const e = seen.get(k) ?? { visits: 0, wins: 0 };
        e.visits++;
        if (win) e.wins++;
        seen.set(k, e);
        b = open(b, pickFor(b, perm));
      }
    }
    let checked = 0;
    for (const [k, { visits, wins }] of seen) {
      if (visits < 500) continue;
      const [R, j] = k.split(',').map(Number);
      const p = winChanceAt(n, limit, R, j);
      expect(Math.abs(wins / visits - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / visits) + 1e-9);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('each box is a fair bet: E[cash-out after one box] = cash-out now, exactly', () => {
    for (const { n, limit } of allSettings) {
      for (let t = 0; t < 12; t++) {
        const b = t === 0 ? newBoard(n, limit) : randomLiveBoard(n, limit);
        if (!b) continue;
        const cands = candidates(b);
        let mean = 0;
        for (let i = 0; i < cands.length; i++) mean += cashValue(open(b, i)) / cands.length;
        close(mean, cashValue(b));
      }
      close(cashValue(newBoard(n, limit)), RTP, 1e-12);
    }
  });

  it('following a loop is a fair bet too (exact recursion over every state)', () => {
    for (const { n, limit } of allSettings) {
      const q = fitTable(n, limit);
      const memo = new Map<string, number>();
      // Expected win chance at the end of a Follow from (R, j), using the button's own stop rule.
      const after = (R: number, j: number): number => {
        const key = `${R},${j}`;
        const hit = memo.get(key);
        if (hit !== undefined) return hit;
        const m = R - j;
        const left = R - j - 1;
        const closed = left <= limit ? 1 : q[left];
        const jj = j + 1;
        const extended = m === 1 ? 0 : jj >= limit ? 0 : jj === limit - 1 ? winChanceAt(n, limit, R, jj) : after(R, jj);
        const v = closed / m + ((m - 1) / m) * extended;
        memo.set(key, v);
        return v;
      };
      for (let R = limit + 1; R <= n; R++) for (let j = 0; j < limit; j++) if (j < R) close(after(R, j), winChanceAt(n, limit, R, j), 1e-12);
    }
  });

  it('exhaustively over all 8! permutations, every Open box and every Follow keeps E[cash-out] = RTP', () => {
    const perms = Array.from(permutations(8), (p) => [...p]);
    for (const share of SHARES) {
      const limit = limitFor(8, share);
      for (const mode of ['box', 'loop', 'mixed'] as const) {
        let boards = perms.map(() => newBoard(8, limit));
        for (let step = 0; step < 6; step++) {
          boards = boards.map((b, i) => {
            if (b.status !== 'live') return b;
            const pick = (c: Board) => pickFor(c, perms[i]);
            // The mixed player decides from what is on screen only: follow between loops, else alternate.
            const loop = mode === 'loop' || (mode === 'mixed' && (b.chain.length === 0 || step % 2 === 1));
            if (!loop) return open(b, pick(b));
            const seq = follow(b, pick);
            return seq[seq.length - 1];
          });
          const mean = boards.reduce((s, b) => s + cashValue(b), 0) / boards.length;
          close(mean, RTP, 1e-10);
        }
      }
    }
  });

  it('Follow stops at a closed loop, the end of the round, or right before a last chance', () => {
    for (const { n, limit } of allSettings) {
      for (let t = 0; t < 20; t++) {
        const b = randomLiveBoard(n, limit) ?? newBoard(n, limit);
        const seq = follow(b, randomPick);
        const end = seq[seq.length - 1];
        expect(end.status !== 'live' || end.chain.length === 0 || lastChance(end)).toBe(true);
        for (const mid of seq.slice(0, -1)) expect(mid.status === 'live' && mid.chain.length > 0 && !lastChance(mid)).toBe(true);
        // Only the decider can bust, so a Follow that starts before it never busts.
        if (!lastChance(b)) expect(end.status).not.toBe('bust');
      }
    }
  });

  it('the ruler and the lit boxes on screen are the true odds', () => {
    for (const { n, limit } of allSettings) {
      for (let t = 0; t < 10; t++) {
        const b = t === 0 ? newBoard(n, limit) : randomLiveBoard(n, limit);
        if (!b) continue;
        const slots = ruler(b);
        // Green area over the lit slots = win chance; red slots = this loop too long.
        expect(slots.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 12);
        expect(slots.reduce((s, x) => s + x.share * x.fit, 0)).toBeCloseTo(winChance(b), 12);
        expect(1 - slots.filter((x) => x.over).reduce((s, x) => s + x.share, 0)).toBeCloseTo(loopFitChance(b), 12);
        // Lit boxes: one home box among R − j equally likely targets.
        const cands = candidates(b);
        expect(1 / cands.length).toBeCloseTo(closeChance(b), 15);
        expect(open(b, 0).chain.length).toBe(0);
        // Red boxes on a last chance are exactly the busting targets.
        const busting = cands.filter((_, i) => open(b, i).status === 'bust').length;
        expect(busting / cands.length).toBeCloseTo(bustChanceNext(b), 15);
        // Each slot's green height is the chance the rest fits once the loop closes at that length.
        for (const s of slots) if (!s.over) expect(s.fit).toBeCloseTo(fitChance(remaining(b) - s.length, limit), 15);
      }
    }
  });

  it('in raw permutations the next box closes the loop 1 time in (R − j)', () => {
    const n = 20;
    const tally = new Map<number, { tries: number; closes: number }>();
    for (let r = 0; r < 6000; r++) {
      const perm = rng.shuffle([...Array(n).keys()]);
      let b = newBoard(n, n);
      while (b.status === 'live') {
        const m = candidates(b).length;
        const e = tally.get(m) ?? { tries: 0, closes: 0 };
        e.tries++;
        b = open(b, pickFor(b, perm));
        if (b.chain.length === 0) e.closes++;
        tally.set(m, e);
      }
    }
    let checked = 0;
    for (const [m, { tries, closes }] of tally) {
      if (tries < 400) continue;
      expect(Math.abs(closes / tries - 1 / m)).toBeLessThan(4 * Math.sqrt(((1 / m) * (1 - 1 / m)) / tries));
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });
});
