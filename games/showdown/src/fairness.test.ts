// Fairness audit: can any way of playing Showdown beat the RTP?
//
// Each round both sides flip a card: drawPair maps two uniforms to a card
// from each pile. Nobody chooses a card, so the player's only decision is
// when to stop: after every round that doesn't settle the series, cash out
// at prize × W(state) or flip the next round. The questions: is the cash-out
// a martingale over the next flip from every reachable state, is the flip
// uniform over the |A| × |H| pair grid the board shows, and do Auto and
// manual play pay the same?
//
// The next flip has at most 49 equally likely outcomes, so the martingale is
// checked exactly, through the real drawPair fed the midpoint of every
// (u1, u2) cell. Every stopping strategy is valued exactly by recursion over
// (your pile, house pile, wins, losses); Monte Carlo through the same
// functions checks them with a real rng.
//
// Strategies, per target k (the eval's configs):
//   (a) the tester's: flip only if the round's chance (green share of the
//       pair grid) is ≥ 0.8, else cash out;
//   (b) take any profit: cash out once the cash-out is above the stake;
//   (c) play to the end;
//   (d) the strongest we could think of: d1 flip only favourable rounds
//       (≥ 50%), d2 cash out when losing the next round would at least halve
//       your chance (on average), d3 cash out when some pair of the next flip
//       would settle a loss outright.
//   No choice exists besides stopping; the first flip is part of Bet.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { N, RTP, START, TARGETS, autoRound, cardsOf, chanceOf, drawPair, forecast, grid, play, prizeFor, roundChance, settled, type State, type Target } from './math';

/** Rounds per Monte Carlo run; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 5_000);

type Policy = (s: State, k: number, prize: number) => boolean; // true = cash out

/** Value after a flip lands: the settled payout, or the cash-out at the checkpoint. */
const valueAt = (s: State, k: number, prize: number) => {
  const r = settled(s, k);
  return r ? (r === 'win' ? prize : 0) : prize * chanceOf(s, k);
};

/** Every next flip through the real drawPair: the midpoint of each (u1, u2) cell, each with weight 1 / (|A|·|H|). */
function nextFlips(s: State): State[] {
  const a = cardsOf(s.you).length;
  const h = cardsOf(s.house).length;
  const out: State[] = [];
  for (let x = 0; x < a; x++)
    for (let y = 0; y < h; y++) {
      const { i, j } = drawPair(s, (x + 0.5) / a, (y + 0.5) / h);
      out.push(play(s, i, j));
    }
  return out;
}

const STRATEGIES: Record<string, Policy> = {
  'a tester (flip iff round ≥80%)': (s) => roundChance(s).p < 0.8,
  'b any profit': (s, k, prize) => prize * chanceOf(s, k) > 1,
  'c play to the end': () => false,
  'd1 flip only favourable rounds': (s) => roundChance(s).p < 0.5,
  'd2 cash if a lost round halves the chance': (s, k) => {
    const f = forecast(s, k);
    return !!f.ifLose && f.ifLose.mean / chanceOf(s, k) <= 0.5;
  },
  'd3 cash if the next flip can lose it': (s, k) => grid(s).some((c) => chanceOf(play(s, c.i, c.j), k) <= 1e-12),
};

/** Exact value of a stopping policy, stake 1, from Bet (which plays the first round). */
function exactValue(k: number, policy: Policy): number {
  const prize = prizeFor(k);
  const memo = new Map<number, number>();
  const flipFrom = (s: State): number => {
    const next = nextFlips(s);
    let v = 0;
    for (const t of next) v += settled(t, k) ? valueAt(t, k, prize) : checkpoint(t);
    return v / next.length;
  };
  const checkpoint = (s: State): number => {
    const key = ((s.you * 128 + s.house) * 8 + s.wins) * 8 + s.losses;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const v = policy(s, k, prize) ? prize * chanceOf(s, k) : flipFrom(s);
    memo.set(key, v);
    return v;
  };
  return flipFrom(START);
}

/** One manual series as Game.tsx plays it (flipNext / cashOut), with a real rng. */
function playManual(k: number, policy: Policy, rng: Rng): number {
  const prize = prizeFor(k);
  let s = START;
  for (;;) {
    const { i, j } = drawPair(s, rng.next(), rng.next());
    s = play(s, i, j);
    const r = settled(s, k);
    if (r) return r === 'win' ? prize : 0;
    if (policy(s, k, prize)) return prize * chanceOf(s, k);
  }
}

/** Checkpoints from random series stopped at every depth, for every target. */
function states(): { s: State; k: number }[] {
  const rng = createRng(seededSource(31));
  const out: { s: State; k: number }[] = [];
  for (const k of TARGETS)
    for (let n = 0; n < 16; n++) {
      let s = START;
      const stopAt = 1 + (n % (N - 1));
      for (let r = 0; r < N; r++) {
        const { i, j } = drawPair(s, rng.next(), rng.next());
        const t = play(s, i, j);
        if (settled(t, k)) break;
        s = t;
        if (r + 1 >= stopAt) break;
      }
      if (s.wins + s.losses > 0) out.push({ s, k });
    }
  return out;
}

describe('Showdown fairness', () => {
  const all = states();

  it('reaches at least 30 varied checkpoints, including late ones', () => {
    expect(all.length).toBeGreaterThanOrEqual(30);
    expect(all.some(({ s }) => s.wins + s.losses >= 4)).toBe(true);
    expect(new Set(all.map(({ s }) => `${s.you},${s.house},${s.wins}`)).size).toBeGreaterThanOrEqual(30);
  });

  it('the flip through drawPair is uniform on the pair grid the board shows', () => {
    for (const { s } of all) {
      const a = cardsOf(s.you).length;
      const h = cardsOf(s.house).length;
      const seen = new Set<string>();
      for (let x = 0; x < a; x++)
        for (let y = 0; y < h; y++) {
          // Each (u1, u2) cell maps to one pair, all the way to its edges.
          const eps = 1e-9;
          const ids = [
            drawPair(s, x / a + eps, y / h + eps),
            drawPair(s, (x + 1) / a - eps, (y + 1) / h - eps),
            drawPair(s, (x + 0.5) / a, (y + 0.5) / h),
          ].map(({ i, j }) => `${i},${j}`);
          expect(new Set(ids).size).toBe(1);
          seen.add(ids[0]);
        }
      const cells = grid(s).map((c) => `${c.i},${c.j}`);
      expect([...seen].sort()).toEqual([...cells].sort());
      expect(roundChance(s).p).toBeCloseTo(grid(s).filter((c) => c.win).length / (a * h), 14);
    }
  });

  it('the cash-out is a martingale over the next flip from every checkpoint (exact)', () => {
    for (const { s, k } of all) {
      const prize = prizeFor(k);
      const now = prize * chanceOf(s, k);
      const next = nextFlips(s);
      const after = next.reduce((a, t) => a + valueAt(t, k, prize), 0) / next.length;
      expect(Math.abs(after - now)).toBeLessThan(1e-12 * Math.max(1, prize));
    }
    // And from the start: the value of Bet is RTP.
    for (const k of TARGETS) expect(prizeFor(k) * chanceOf(START, k)).toBeCloseTo(RTP, 12);
  });

  it('every strategy is worth exactly RTP (backward induction, every target)', () => {
    const rows: string[] = [];
    for (const k of TARGETS)
      for (const [name, policy] of Object.entries(STRATEGIES)) {
        const v = exactValue(k, policy);
        rows.push(`k=${k} ${name}: ${(v * 100).toFixed(10)}%`);
        expect(Math.abs(v - RTP)).toBeLessThan(1e-10);
      }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });

  it('every strategy returns RTP within 4 SE through the game flow (Monte Carlo)', () => {
    const rows: string[] = [];
    let seed = 1;
    for (const k of TARGETS)
      for (const [name, policy] of Object.entries(STRATEGIES)) {
        const rng = createRng(seededSource(500 + seed++));
        let sum = 0;
        let sq = 0;
        for (let i = 0; i < ROUNDS; i++) {
          const x = playManual(k, policy, rng);
          sum += x;
          sq += x * x;
        }
        const mean = sum / ROUNDS;
        const se = Math.sqrt(Math.max(0, sq / ROUNDS - mean * mean) / ROUNDS);
        rows.push(`k=${k} ${name}: ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}% (z ${((mean - RTP) / se).toFixed(2)})`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
      }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });

  it('Auto pays exactly what manual play with the same stop rule and the same draws pays', () => {
    const rng = createRng(seededSource(9));
    for (let n = 0; n < 3000; n++) {
      const k = TARGETS[n % TARGETS.length] as Target;
      const cashAt = [null, 1.5, 2, 5, 10][rng.int(5)] as null | 1.5 | 2 | 5 | 10;
      const us: number[] = [];
      for (let i = 0; i < 2 * N; i++) us.push(rng.next());
      let a = 0;
      const auto = autoRound(k, cashAt, () => us[a++]);
      let b = 0;
      const replay = { next: () => us[b++], int: (x: number) => Math.floor(us[b++] * x), shuffle: <T>(x: readonly T[]) => x.slice() };
      const manual = playManual(k, (s, kk, prize) => cashAt !== null && prize * chanceOf(s, kk) >= cashAt, replay);
      expect(auto.multiplier).toBe(manual);
      expect(a).toBe(b);
    }
  });

  it('the eval configs are the audited targets', () => {
    expect(evalSpec.configs.map((c) => c.params.k)).toEqual([...TARGETS]);
  });
});
