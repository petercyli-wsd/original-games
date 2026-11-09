// Fairness audit: can any way of playing Shut beat the RTP?
//
// Shut is a skill game. At a checkpoint you may cash out (prize × V(open
// tiles)) or roll. After a roll you see the total and may cash out at the
// post-roll value (prize × V after the best close) or close any legal set of
// tiles; a close other than the best relocks the prize at value / V(after),
// refused if that passes MAX_WIN. V is the best-play chance, so the
// questions are: does best play return exactly RTP (and no more), does every
// close keep the value at the moment of choosing, is the cash-out after a
// roll the post-roll value (no dodging a bad roll), does rollDice draw the
// totals V assumes, and do Auto and manual play pay the same?
//
// The next roll has at most 11 totals, so the martingale is exact: the real
// rollDice is fed every int() combination. Strategies are valued exactly by
// recursion over (open tiles, prize); Monte Carlo through the same functions
// checks them with a real rng.
//
// Strategies, per eval config (box size):
//   (a) the tester's: roll only if the next roll is playable with chance
//       ≥ 0.8, else cash out; best close;
//   (b) take any profit: cash out (at a checkpoint or straight after a roll)
//       as soon as the value is above the stake; best close;
//   (c) play to the end, best close (optimal play);
//   (d) the strongest we could think of: d1 always the riskiest close the cap
//       allows, to the end; d2 after each roll, cash out if it lowered the
//       chance (a "bad roll"), else close best; d3 riskiest close, then cash
//       out at 3× or when the next roll is < 60% playable; d4 close the
//       highest tiles first (a common human rule), relocking as needed.
//   The first roll is part of Bet.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  BOXES,
  MAX_MULTIPLIER,
  MAX_WIN,
  RTP,
  VOLATILITY,
  closes,
  fullBox,
  oneDie,
  playableChance,
  relock,
  rollDice,
  startPrize,
  totals,
  winChance,
  type Box,
  type Close,
  type Mask,
} from './math';

/** Rounds per Monte Carlo run; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 4_000);

/** Every roll through the real rollDice: each int() sequence with its probability (cached by dice count). */
const rollCache = new Map<number, { total: number; p: number }[]>();
function rollsOf(mask: Mask): { total: number; p: number }[] {
  const n = oneDie(mask) ? 1 : 2;
  const hit = rollCache.get(n);
  if (hit) return hit;
  const out: { total: number; p: number }[] = [];
  for (let a = 0; a < 6; a++)
    for (let b = 0; b < (n === 2 ? 6 : 1); b++) {
      const seq = [a, b];
      let i = 0;
      const { total, dice } = rollDice(mask, (k) => {
        if (k !== 6) throw new Error(`unexpected int(${k})`);
        return seq[i++];
      });
      if (dice.length !== n || i !== n || total !== dice.reduce((x, y) => x + y, 0)) throw new Error('rollDice drew an unexpected roll');
      out.push({ total, p: 1 / 6 ** n });
    }
  rollCache.set(n, out);
  return out;
}

// ---------- Strategies ----------

interface Policy {
  /** At a checkpoint (open tiles `mask`, prize): cash out? */
  stop(mask: Mask, prize: number): boolean;
  /** After a roll with legal closes `options` (best first): 'cash' or the close to make. */
  choose(mask: Mask, total: number, prize: number, options: Close[]): 'cash' | Close;
}

const bestClose = (_m: Mask, _t: number, _p: number, o: Close[]) => o[0];
/** The lowest-chance close whose relock stays within MAX_WIN (the best close is always allowed). */
const riskiest = (_m: Mask, _t: number, prize: number, o: Close[]) =>
  [...o].reverse().find((c) => relock(prize, o[0].win, c) !== null) ?? o[0];
/** "Close the highest tiles": the close containing the highest tile, then the next highest, … */
const highest = (_m: Mask, _t: number, prize: number, o: Close[]) =>
  [...o].sort((a, b) => b.tiles - a.tiles).find((c) => relock(prize, o[0].win, c) !== null) ?? o[0];

const STRATEGIES: Record<string, Policy> = {
  'a tester (roll iff ≥80% playable)': { stop: (m) => playableChance(m) < 0.8, choose: bestClose },
  'b any profit': {
    stop: (m, prize) => prize * winChance(m) > 1,
    choose: (_m, _t, prize, o) => (prize * o[0].win > 1 ? 'cash' : o[0]),
  },
  'c play to the end (best play)': { stop: () => false, choose: bestClose },
  'd1 riskiest close to the end': { stop: () => false, choose: riskiest },
  'd2 cash out after a bad roll': {
    stop: () => false,
    choose: (m, _t, _p, o) => (o[0].win < winChance(m) - 1e-12 ? 'cash' : o[0]),
  },
  'd3 riskiest, cash at 3x or <60% playable': {
    stop: (m, prize) => prize * winChance(m) >= 3 || playableChance(m) < 0.6,
    choose: riskiest,
  },
  'd4 highest tiles first': { stop: () => false, choose: highest },
};

/** The relock the game applies to a chosen close (Game.tsx close()); null = refused. */
function applyClose(prize: number, options: Close[], pick: Close) {
  return relock(prize, options[0].win, pick);
}

/** Exact value of a policy, stake 1, from Bet (which rolls straight away). */
function exactValue(n: Box, policy: Policy): number {
  const memo = new Map<string, number>();
  const rollFrom = (mask: Mask, prize: number): number => {
    let v = 0;
    for (const { total, p } of rollsOf(mask)) {
      const options = closes(mask, total);
      if (options.length === 0) continue; // bust: 0
      const act = options.length === 1 ? options[0] : policy.choose(mask, total, prize, options);
      if (act === 'cash') {
        v += p * prize * options[0].win;
        continue;
      }
      const np = applyClose(prize, options, act);
      if (np === null) throw new Error('policy chose a refused close');
      v += p * (act.after === 0 ? np : checkpoint(act.after, np));
    }
    return v;
  };
  const checkpoint = (mask: Mask, prize: number): number => {
    const key = `${mask}|${prize.toPrecision(14)}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const v = policy.stop(mask, prize) ? prize * winChance(mask) : rollFrom(mask, prize);
    memo.set(key, v);
    return v;
  };
  return rollFrom(fullBox(n), startPrize(n));
}

/** One manual round as Game.tsx plays it (roll / choose / close / cashOut), with a real rng. */
function playManual(n: Box, policy: Policy, rng: Rng): number {
  let mask = fullBox(n);
  let prize = startPrize(n);
  for (;;) {
    const { total } = rollDice(mask, (k) => rng.int(k));
    const options = closes(mask, total);
    if (options.length === 0) return 0;
    // One legal close: the game closes it by itself.
    const act = options.length === 1 ? options[0] : policy.choose(mask, total, prize, options);
    if (act === 'cash') return prize * options[0].win; // valueOf() in the choose phase
    const np = applyClose(prize, options, act);
    if (np === null) throw new Error('policy chose a refused close');
    prize = np;
    mask = act.after;
    if (mask === 0) return prize;
    if (policy.stop(mask, prize)) return prize * winChance(mask);
  }
}

// ---------- Reachable states ----------

/** Checkpoints from random rounds with random (relocking) closes, every box, plus near-cap states. */
function states(): { mask: Mask; prize: number; n: Box }[] {
  const rng = createRng(seededSource(23));
  const out: { mask: Mask; prize: number; n: Box }[] = [];
  for (const n of BOXES)
    for (let g = 0; g < 10; g++) {
      let mask = fullBox(n);
      let prize = startPrize(n);
      const stopAt = 1 + rng.int(6);
      for (let r = 0; r < stopAt; r++) {
        const { total } = rollDice(mask, (k) => rng.int(k));
        const options = closes(mask, total);
        if (!options.length) break;
        // Mostly risky closes, to push prizes up towards the cap.
        const pick = g % 2 ? riskiest(mask, total, prize, options) : options[rng.int(options.length)];
        const np = relock(prize, options[0].win, pick);
        if (np === null || pick.after === 0) break;
        prize = np;
        mask = pick.after;
      }
      if (mask !== fullBox(n)) out.push({ mask, prize, n });
    }
  return out;
}

describe('Shut fairness', () => {
  const all = states();

  it('reaches at least 30 varied checkpoints, including one-die ones', () => {
    expect(all.length).toBeGreaterThanOrEqual(30);
    expect(all.some(({ mask }) => oneDie(mask))).toBe(true);
    expect(new Set(all.map(({ mask }) => mask)).size).toBeGreaterThanOrEqual(30);
  });

  it('rollDice draws exactly the totals V assumes', () => {
    for (const { mask } of all) {
      const dist = new Map<number, number>();
      for (const { total, p } of rollsOf(mask)) dist.set(total, (dist.get(total) ?? 0) + p);
      for (const { total, p } of totals(mask)) expect(dist.get(total) ?? 0).toBeCloseTo(p, 14);
      expect([...dist.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 14);
    }
  });

  it('V is a best-play value: no close beats the best one, and V(S) averages the best closes over the roll', () => {
    let worstOrder = 0;
    let worstBellman = 0;
    for (let mask = 1; mask < 1 << 12; mask++) {
      let e = 0;
      for (const { total, p } of totals(mask)) {
        const o = closes(mask, total);
        for (const c of o) worstOrder = Math.max(worstOrder, c.win - o[0].win);
        e += p * (o.length ? o[0].win : 0);
      }
      worstBellman = Math.max(worstBellman, Math.abs(e - winChance(mask)));
    }
    expect(worstOrder).toBeLessThanOrEqual(1e-15);
    expect(worstBellman).toBeLessThan(1e-14);
  });

  it('the cash-out is a martingale over the next roll for every close, and every close keeps the value (exact)', () => {
    let relocks = 0;
    let refused = 0;
    for (const { mask, prize } of all) {
      const now = prize * winChance(mask);
      let after = 0;
      for (const { total, p } of rollsOf(mask)) {
        const o = closes(mask, total);
        if (!o.length) continue;
        const post = prize * o[0].win; // the choose-phase cash-out
        after += p * post;
        for (const c of o) {
          const np = relock(prize, o[0].win, c);
          if (np === null) {
            refused++;
            expect(post / c.win).toBeGreaterThan(MAX_WIN);
            continue;
          }
          if (np !== prize) relocks++;
          expect(np).toBeLessThanOrEqual(MAX_WIN);
          // Value right after the close = value after the roll (one more martingale step from there is the next state's check).
          expect(Math.abs((c.after === 0 ? np : np * winChance(c.after)) - post)).toBeLessThan(1e-9 * Math.max(1, post));
        }
        // The best close is always allowed.
        expect(relock(prize, o[0].win, o[0])).toBe(prize);
      }
      expect(Math.abs(after - now)).toBeLessThan(1e-12 * Math.max(1, prize));
    }
    expect(relocks).toBeGreaterThan(50);
    expect(refused).toBeGreaterThan(0);
  });

  it('the opening value is RTP, and every prize stays within the max win', () => {
    for (const n of BOXES) {
      expect(startPrize(n) * winChance(fullBox(n))).toBeCloseTo(RTP, 12);
      expect(startPrize(n)).toBeLessThanOrEqual(MAX_WIN);
    }
    expect(MAX_MULTIPLIER).toBe(MAX_WIN);
  });

  it('every strategy is worth exactly RTP (backward induction, every box)', () => {
    const rows: string[] = [];
    for (const [level, n] of Object.entries(VOLATILITY))
      for (const [name, policy] of Object.entries(STRATEGIES)) {
        // Relocking to the end in the 12-box visits ~90k (tiles, prize) states (≈1 s): heavy run only.
        if (n === 12 && /^d[14]/.test(name) && !import.meta.env.FAIRNESS_ROUNDS) continue;
        const v = exactValue(n, policy);
        rows.push(`${level} (box ${n}) ${name}: ${(v * 100).toFixed(10)}%`);
        expect(Math.abs(v - RTP)).toBeLessThan(1e-9);
      }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });

  it('every strategy returns RTP within 4 SE through the game flow (Monte Carlo)', () => {
    const rows: string[] = [];
    let seed = 1;
    for (const [level, n] of Object.entries(VOLATILITY))
      for (const [name, policy] of Object.entries(STRATEGIES)) {
        const rng = createRng(seededSource(700 + seed++));
        let sum = 0;
        let sq = 0;
        let max = 0;
        for (let i = 0; i < ROUNDS; i++) {
          const x = playManual(n, policy, rng);
          sum += x;
          sq += x * x;
          if (x > max) max = x;
        }
        const mean = sum / ROUNDS;
        const se = Math.sqrt(Math.max(0, sq / ROUNDS - mean * mean) / ROUNDS);
        rows.push(`${level} (box ${n}) ${name}: ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}% (z ${((mean - RTP) / se).toFixed(2)}, max ${max.toFixed(1)}x)`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
        expect(max).toBeLessThanOrEqual(MAX_WIN);
      }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });

  it('Auto (best close, cash at the target) pays what the same manual rule pays, and its rule is worth RTP', () => {
    // Game.tsx's Auto loop: best close every roll, cash out at a checkpoint once prize · V ≥ target − 1e-12.
    for (const n of BOXES)
      for (const target of [0, 1.5, 2, 3, 5, 10]) {
        const rule: Policy = { stop: (m, prize) => target > 0 && prize * winChance(m) >= target - 1e-12, choose: bestClose };
        expect(Math.abs(exactValue(n, rule) - RTP)).toBeLessThan(1e-9);
      }
  });

  it('the eval configs are the audited boxes', () => {
    expect(evalSpec.configs.map((c) => c.params.n)).toEqual(Object.values(VOLATILITY));
  });
});
