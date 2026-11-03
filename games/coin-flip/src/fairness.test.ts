// Fairness audit: can any way of playing Coin Flip beat the RTP?
//
// A round fixes coins n and "need" k at the bet. Each flip the player picks a
// call (Heads, Tails, Random), then either cashes out or flips again. So the
// questions are: is every flip, under every call, a fair bet at the shown
// prices (the cash-out is a martingale), and does the call matter at all?
//
// Each flip is enumerated exactly through the game's own flip(): a scripted
// rng feeds it every combination of its int(2) draws (the random call's draw
// and each coin), so the probabilities come from the code that draws.
//
// Strategies, per eval config (the eval's coins / need / depth):
//   (a) the tester's: flip again while the flip wins ≥ 80%, else cash out
//       (the first flip is part of the bet, so cash-out is from one win on);
//   (b) take any profit: cash out at the first win (every first win pays > 1×);
//   (c) flip to the top rung (the auto cash-out at the ladder's end);
//   (d) "the hot hand": call the side most coins showed last flip, Random on
//       the first, play to the eval's deep target. The exact check also sweeps
//       every fixed target and every call pattern, and calls chosen from the
//       previous flip's coins.
// Each is checked exactly (backward induction with the enumerated flip) to
// 1e-9 and by Monte Carlo on the real rng (within 4 SE). Long-shot strategies
// (the top rung of 5-coins-need-2 is 20 flips at 81%) cannot reach a 0.3% SE
// in any feasible Monte Carlo, so there the exact check is the binding one.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { COINS, RTP, autoCallAt, autoRound, cashAfter, flip, flipChance, maxFlips, type AutoCall, type Call, type Flip, type Side } from './math';

/** Rounds per Monte Carlo run; the audit's 200k run sets FAIRNESS_ROUNDS=200000 (scratch fairness/run-heavy.sh). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

/** An rng that replays a fixed list of int(2) results and fails on anything else. */
function scripted(ints: number[]): Rng & { used: () => number } {
  let i = 0;
  return {
    next: () => {
      throw new Error('flip() should only draw int(2)');
    },
    int: (n: number) => {
      if (n !== 2) throw new Error(`unexpected int(${n})`);
      if (i >= ints.length) throw new Error('flip() drew more than expected');
      return ints[i++];
    },
    shuffle: () => {
      throw new Error('no shuffles');
    },
    used: () => i,
  };
}

/** Every equally likely flip for a call, through the real flip(). */
function enumerateFlip(n: number, need: number, call: Call): { p: number; f: Flip }[] {
  const draws = n + (call === 'random' ? 1 : 0);
  const out: { p: number; f: Flip }[] = [];
  for (let m = 0; m < 2 ** draws; m++) {
    const ints = Array.from({ length: draws }, (_, b) => (m >> b) & 1);
    const rng = scripted(ints);
    const f = flip(n, need, call, rng);
    if (rng.used() !== draws) throw new Error('flip() drew fewer values than expected');
    out.push({ p: 2 ** -draws, f });
  }
  return out;
}

/** The cash-out after s wins, as the game shows and pays it (s = 0: the stake's fair value). */
const V = (n: number, need: number, s: number) => cashAfter(n, need, s);

/**
 * A call rule: the call for flip s + 1 given the wins so far and the last flip
 * (what the board shows). Rules that look further back are no stronger: the
 * coins are independent of the past, which the enumeration confirms.
 */
type CallRule = (s: number, last: Flip | undefined) => Call;
/** A stop rule: cash out after s ≥ 1 wins (the top rung cashes out by itself). */
type StopRule = (n: number, need: number, s: number) => boolean;

/** Exact value of a strategy by enumerating every flip through flip(), memoised on (wins, last flip). */
function exactValue(n: number, need: number, stop: StopRule, callOf: CallRule, pay = V): number {
  const memo = new Map<string, number>();
  const enumCache = new Map<Call, { p: number; f: Flip }[]>();
  const value = (s: number, last: Flip | undefined): number => {
    if (s >= maxFlips(n, need) || (s > 0 && stop(n, need, s))) return pay(n, need, s);
    // Rules that ignore the last flip (declared with fewer than two parameters) memoise on s alone.
    const key = callOf.length < 2 ? `${s}` : `${s}|${last ? `${last.call}:${last.coins.join('')}` : '-'}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const call = callOf(s, last);
    let outs = enumCache.get(call);
    if (!outs) enumCache.set(call, (outs = enumerateFlip(n, need, call)));
    let v = 0;
    for (const { p, f } of outs) if (f.win) v += p * value(s + 1, f);
    memo.set(key, v);
    return v;
  };
  return value(0, undefined);
}

/** One round exactly as Game.tsx plays it: flipOnce → win: cashAfter(s + 1), top rung auto-cashes; loss: 0. */
function playRound(n: number, need: number, stop: StopRule, callOf: CallRule, rng: Rng): number {
  let last: Flip | undefined;
  for (let s = 0; ; ) {
    const f = flip(n, need, callOf(s, last), rng);
    if (!f.win) return 0;
    last = f;
    s++;
    if (s >= maxFlips(n, need) || stop(n, need, s)) return cashAfter(n, need, s);
  }
}

/** The side most coins showed on the last flip (ties: Heads); Random on the first flip. */
const hotHand: CallRule = (_, last) => {
  if (!last) return 'random';
  const heads = last.coins.filter((c) => c === 0).length;
  return (heads * 2 >= last.coins.length ? 0 : 1) as Side;
};
/** The opposite ("it's due"). */
const due: CallRule = (s, last) => {
  const h = hotHand(s, last);
  return h === 'random' ? 0 : ((1 - h) as Side);
};

const configs = evalSpec.configs.map((c) => c.params);

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    s += x;
    s2 += x * x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds) };
}

describe('Coin Flip fairness', () => {
  it('martingale: at 30+ reached states, the next flip under every call keeps the cash-out value', () => {
    const rng = createRng(seededSource(5150));
    const states = new Set<string>();
    for (let r = 0; r < 600; r++) {
      const n = COINS[rng.int(COINS.length)];
      const need = 1 + rng.int(n);
      let s = 0;
      while (s < maxFlips(n, need)) {
        states.add(`${n}/${need}/${s}`);
        if (!flip(n, need, 'random', rng).win) break;
        s++;
      }
    }
    // The last flip before the top rung, for every setting.
    for (const n of COINS) for (let need = 1; need <= n; need++) states.add(`${n}/${need}/${maxFlips(n, need) - 1}`);
    expect(states.size).toBeGreaterThanOrEqual(30);

    for (const key of states) {
      const [n, need, s] = key.split('/').map(Number);
      for (const call of [0, 1, 'random'] as Call[]) {
        let ev = 0;
        let pWin = 0;
        for (const { p, f } of enumerateFlip(n, need, call)) {
          if (!f.win) continue;
          pWin += p;
          ev += p * V(n, need, s + 1);
        }
        // The chance on screen is the chance the code draws, under every call.
        expect(pWin).toBeCloseTo(flipChance(n, need), 14);
        expect(Math.abs(ev - V(n, need, s)) / V(n, need, s)).toBeLessThan(1e-9);
      }
    }
  });

  it('exact: every stopping rule, call pattern and Auto target is worth RTP on every config', () => {
    for (const { coins: n, need } of configs) {
      const top = maxFlips(n, need);
      const calls: CallRule[] = [() => 0, () => 1, () => 'random', hotHand, due, (s) => autoCallAt('alternate', s)];
      const stops: StopRule[] = [
        (nn, kk) => flipChance(nn, kk) < 0.8, // (a)
        (nn, kk, s) => V(nn, kk, s) > 1, // (b)
        () => false, // (c) the top rung
        (nn, kk, s) => V(nn, kk, s) >= 10, // chase 10×
      ];
      for (const stop of stops) for (const callOf of calls) expect(exactValue(n, need, stop, callOf)).toBeCloseTo(RTP, 9);
      // Every fixed target (Auto's cash-out streak) under every call pattern.
      for (let t = 1; t <= top; t++) for (const callOf of calls) expect(exactValue(n, need, (_, __, s) => s >= t, callOf)).toBeCloseTo(RTP, 9);
    }
  });

  it('Auto (autoRound) pays the same as manual play for every target and call pattern', () => {
    const rng = createRng(seededSource(77));
    for (const { coins: n, need } of configs) {
      for (const pattern of [0, 1, 'random', 'alternate'] as AutoCall[]) {
        for (const target of [1, 2, maxFlips(n, need)]) {
          let bad = 0;
          for (let r = 0; r < 200; r++) {
            const res = autoRound(n, need, target, pattern, rng);
            const wins = res.flips.filter((f) => f.win).length;
            const lost = res.flips.length > wins;
            if (lost ? res.multiplier !== 0 : res.multiplier !== cashAfter(n, need, wins) || wins !== Math.min(target, maxFlips(n, need))) bad++;
          }
          expect(bad).toBe(0);
        }
      }
    }
  });

  it('Monte Carlo with the real rng: (a)–(d) on every eval config are within 4 SE of RTP', () => {
    const rows: string[] = [];
    configs.forEach(({ coins: n, need, deep }, ci) => {
      const target = Math.min(deep, maxFlips(n, need));
      const plays: { name: string; stop: StopRule; callOf: CallRule }[] = [
        { name: '(a) flip while ≥ 80% to win', stop: (nn, kk) => flipChance(nn, kk) < 0.8, callOf: () => 0 },
        { name: '(b) take any profit', stop: (nn, kk, s) => V(nn, kk, s) > 1, callOf: () => 'random' },
        { name: '(c) to the top rung', stop: () => false, callOf: () => 1 },
        { name: `(d) hot hand to ${target} wins`, stop: (_, __, s) => s >= target, callOf: hotHand },
      ];
      plays.forEach(({ name, stop, callOf }, si) => {
        const { mean, se } = mc((r) => playRound(n, need, stop, callOf, r), ROUNDS, 4400 + 17 * ci + si);
        // Too few paying rounds to measure (the extreme top rung pays 1 in 2^20): the exact test covers it.
        const paying = exactValue(n, need, stop, callOf, () => 1) * ROUNDS;
        rows.push(`${n} coins need ${need}  ${name.padEnd(30)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%${paying < 25 ? `  (exact only: ${paying.toFixed(2)} paying rounds expected)` : ''}`);
        if (paying >= 25) expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
