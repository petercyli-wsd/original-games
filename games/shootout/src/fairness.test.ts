// Fairness audit: can any way of playing Shootout beat the RTP?
//
// A kick is a goal with the kicker's chance (isGoal on a uniform u). After
// every kick that doesn't settle your pick you may cash out (prize × P(pick)),
// take the next kick, or switch what you back (the cash-out is kept and the
// prize relocked at cash / P(new pick), offered only while that prize is
// within MAX_PRIZE). So the questions: is the cash-out a martingale over the
// next kick for every pick you could switch to, does a switch keep the value,
// does the goal mouth's green share equal the scoring chance the code uses,
// and do Auto and manual play pay the same?
//
// The next event always has two outcomes (goal or miss), so the martingale is
// checked exactly. Every strategy is also valued exactly by recursion over
// (kicks so far, pick, prize). Sudden death is cut after MAX_KICKS kicks by
// cashing out there; that is just one more stopping rule, so the value of the
// cut policy is still exactly RTP if the game is fair (no approximation).
// Monte Carlo through the game's own functions checks the same strategies,
// uncut, with a real rng.
//
// Strategies (per eval config: a matchup and an opening pick):
//   (a) the tester's: take the next kick only if it goes your way (raises or
//       keeps your chance) with probability ≥ 0.8, else cash out;
//   (b) take any profit: cash out as soon as the cash-out is above the stake;
//   (c) play to the end (never cash out, never switch);
//   (d) the strongest we could think of: d1 hop to the longest open shot at
//       every checkpoint (highest prize the cap allows) and play to the end;
//       d2 back whichever pick the next kick most likely helps, and cash out
//       if the bad branch would cut its chance by more than half; d3 lock the
//       favourite, then cash out at 2× or before a kick that decides it.
//   The first kick is part of Bet (no choice before it).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  EMPTY,
  chanceOf as chanceOfRaw,
  forecast as forecastRaw,
  KICKS,
  MATCHUPS,
  MATCHUP_IDS,
  MAX_PRIZE,
  PICKS,
  RTP,
  VOLATILITY,
  addKick,
  autoRound,
  canSwitch,
  goalsOf,
  isGoal,
  keeperZone,
  kickChance,
  kicker,
  prizeFor,
  reachedSuddenDeath,
  settled,
  switchPrize,
  type Kicks,
  type Matchup,
  type MatchupId,
  type Pick,
} from './math';

/** Rounds per Monte Carlo run; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 1_500);
/** Exact recursion cashes out here (deep sudden death): a stopping rule, so still exact. */
const MAX_KICKS = 24;

// The game's chanceOf / forecast are pure functions of (matchup, counts, pick);
// memoising them keeps the Monte Carlo fast without changing a single value.
const keyOf = (s: Kicks, m: Matchup, pick: Pick) => `${m.label}|${s.a.length},${s.b.length},${goalsOf(s.a)},${goalsOf(s.b)}|${pick}`;
const chanceMemo = new Map<string, number>();
const forecastMemo = new Map<string, ReturnType<typeof forecastRaw>>();
function chanceOf(s: Kicks, m: Matchup, pick: Pick) {
  const k = keyOf(s, m, pick);
  let v = chanceMemo.get(k);
  if (v === undefined) chanceMemo.set(k, (v = chanceOfRaw(s, m, pick)));
  return v;
}
function forecast(s: Kicks, m: Matchup, pick: Pick) {
  const k = keyOf(s, m, pick);
  let v = forecastMemo.get(k);
  if (v === undefined) forecastMemo.set(k, (v = forecastRaw(s, m, pick)));
  return v;
}

/** Value of a checkpoint (or of a settled state) for a pick and prize. */
function valueAt(s: Kicks, m: Matchup, pick: Pick, prize: number) {
  const r = settled(s, pick);
  if (r) return r === 'win' ? prize : 0;
  return prize * chanceOf(s, m, pick);
}

// ---------- Strategies ----------

interface Decision {
  /** Switch to this pick first (only if canSwitch allows it). */
  to?: Pick;
  cash: boolean;
}
type Policy = (s: Kicks, m: Matchup, pick: Pick, prize: number) => Decision;

/** The chance the next kick goes your way (the branch that doesn't lower your chance). */
function goesYourWay(s: Kicks, m: Matchup, pick: Pick) {
  const f = forecast(s, m, pick);
  return f.ifGoal >= f.ifMiss ? f.p : 1 - f.p;
}

const openPicks = (s: Kicks, m: Matchup, pick: Pick, prize: number) => {
  const cash = prize * chanceOf(s, m, pick);
  return PICKS.filter((p) => p === pick || canSwitch(cash, s, m, pick, p));
};

const STRATEGIES: Record<string, Policy> = {
  'a tester (kick iff ≥80% your way)': (s, m, pick) => ({ cash: goesYourWay(s, m, pick) < 0.8 }),
  'b any profit': (s, m, pick, prize) => ({ cash: prize * chanceOf(s, m, pick) > 1 }),
  'c play to the end': () => ({ cash: false }),
  'd1 hop to the longest shot': (s, m, pick, prize) => {
    const open = openPicks(s, m, pick, prize);
    const to = open.reduce((a, b) => (chanceOf(s, m, b) < chanceOf(s, m, a) ? b : a));
    return { to, cash: false };
  },
  'd2 momentum, bail if bad branch halves': (s, m, pick, prize) => {
    const open = openPicks(s, m, pick, prize);
    const to = open.reduce((a, b) => (goesYourWay(s, m, b) > goesYourWay(s, m, a) ? b : a));
    const f = forecast(s, m, to);
    const now = chanceOf(s, m, to);
    return { to, cash: Math.min(f.ifGoal, f.ifMiss) / now < 0.5 };
  },
  'd3 favourite, cash at 2x or before a decider': (s, m, pick, prize) => {
    const open = openPicks(s, m, pick, prize);
    const to = open.reduce((a, b) => (chanceOf(s, m, b) > chanceOf(s, m, a) ? b : a));
    const f = forecast(s, m, to);
    const decider = [f.ifGoal, f.ifMiss].some((v) => v <= 1e-12 || v >= 1 - 1e-12);
    return { to, cash: prize * chanceOf(s, m, pick) >= 2 || decider };
  },
};

/** Applies a decision's switch the way Game.tsx's choose() does. */
function applySwitch(s: Kicks, m: Matchup, pick: Pick, prize: number, to: Pick | undefined) {
  if (!to || to === pick) return { pick, prize };
  const cash = prize * chanceOf(s, m, pick);
  if (!canSwitch(cash, s, m, pick, to)) return { pick, prize };
  return { pick: to, prize: switchPrize(cash, s, m, to) };
}

/** Exact value of a policy, for a stake of 1, from Bet (which takes the first kick). */
function exactValue(m: Matchup, first: Pick, policy: Policy): number {
  const memo = new Map<string, number>();
  const kickFrom = (s: Kicks, pick: Pick, prize: number): number => {
    const p = kickChance(m, kicker(s));
    let v = 0;
    for (const goal of [true, false]) {
      const w = goal ? p : 1 - p;
      const t = addKick(s, goal);
      const r = settled(t, pick);
      v += w * (r ? (r === 'win' ? prize : 0) : checkpoint(t, pick, prize));
    }
    return v;
  };
  const checkpoint = (s: Kicks, pick0: Pick, prize0: number): number => {
    if (s.a.length + s.b.length >= MAX_KICKS) return prize0 * chanceOf(s, m, pick0);
    const key = `${s.a.length},${s.b.length},${goalsOf(s.a)},${goalsOf(s.b)}|${pick0}|${prize0.toPrecision(14)}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const d = policy(s, m, pick0, prize0);
    const { pick, prize } = applySwitch(s, m, pick0, prize0, d.to);
    const v = d.cash ? prize * chanceOf(s, m, pick) : kickFrom(s, pick, prize);
    memo.set(key, v);
    return v;
  };
  return kickFrom(EMPTY, first, prizeFor(m, first));
}

/** One manual round through the game's functions with a real rng (as Game.tsx's kick / choose / cashOut). */
function playManual(m: Matchup, first: Pick, policy: Policy, rng: Rng): number {
  let pick = first;
  let prize = prizeFor(m, pick);
  let s = EMPTY;
  for (;;) {
    s = addKick(s, isGoal(rng.next(), kickChance(m, kicker(s))));
    const r = settled(s, pick);
    if (r) return r === 'win' ? prize : 0;
    const d = policy(s, m, pick, prize);
    ({ pick, prize } = applySwitch(s, m, pick, prize, d.to));
    if (d.cash) return prize * chanceOf(s, m, pick);
  }
}

// ---------- Reachable states ----------

/** Checkpoints from random real rounds, plus hand-picked late, sudden-death and near-cap states. */
function states(): { m: Matchup; s: Kicks; pick: Pick; prize: number }[] {
  const rng = createRng(seededSource(77));
  const out: { m: Matchup; s: Kicks; pick: Pick; prize: number }[] = [];
  for (const id of MATCHUP_IDS) {
    const m = MATCHUPS[id];
    for (const first of PICKS) {
      for (let k = 0; k < 4; k++) {
        let pick = first;
        let prize = prizeFor(m, pick);
        let s = EMPTY;
        const stopAt = 1 + rng.int(14);
        for (let i = 0; i < 40; i++) {
          const t = addKick(s, isGoal(rng.next(), kickChance(m, kicker(s))));
          if (settled(t, pick)) break;
          s = t;
          // Random value-preserving switches on the way, like a player would make.
          const to = PICKS[rng.int(3)];
          ({ pick, prize } = applySwitch(s, m, pick, prize, to));
          if (i + 1 >= stopAt) break;
        }
        if (s.a.length + s.b.length > 0) out.push({ m, s, pick, prize });
      }
    }
  }
  const K = (a: string, b: string): Kicks => ({ a: [...a].map((c) => c === '1'), b: [...b].map((c) => c === '1') });
  const hand: [MatchupId, string, string, Pick][] = [
    ['even', '11110', '1111', 'A'], // Orange's last regulation kick
    ['even', '10101', '0101', 'SD'], // last kick of regulation decides sudden death
    ['mismatch', '11111', '11110', 'B'], // sudden death reached, near-certain loss for Orange
    ['keepers', '110101', '10101', 'A'], // sudden death, Teal scored in the pair
    ['keepers', '1101010', '101011', 'B'], // sudden death, Teal missed in the pair
    ['edge', '1111111111', '111111111', 'SD'], // deep sudden death
    ['mismatch', '1', '', 'B'], // the longest opening shot
    ['mismatch', '11', '0', 'B'],
  ];
  for (const [id, a, b, pick] of hand) {
    const m = MATCHUPS[id];
    const s = K(a, b);
    if (!settled(s, pick)) out.push({ m, s, pick, prize: prizeFor(m, pick) });
  }
  // Near the cap: Orange in Mismatch after Teal scores twice; the switch to Orange from Teal costs a prize near MAX_PRIZE.
  const m = MATCHUPS.mismatch;
  for (const s of [K('11', '0'), K('111', '00'), K('1111', '001')]) out.push({ m, s, pick: 'A', prize: prizeFor(m, 'A') });
  return out;
}

describe('Shootout fairness', () => {
  const all = states();

  it('reaches at least 30 varied checkpoints, including sudden death and near-cap switches', () => {
    expect(all.length).toBeGreaterThanOrEqual(30);
    expect(all.some(({ s }) => reachedSuddenDeath(s))).toBe(true);
    expect(all.some(({ s }) => s.a.length === KICKS && s.b.length === KICKS - 1)).toBe(true);
  });

  it('every offered switch keeps the cash-out, and every pick is a martingale over the next kick (exact)', () => {
    let switches = 0;
    let nearCap = 0;
    for (const { m, s, pick, prize } of all) {
      const cash = valueAt(s, m, pick, prize);
      for (const to of PICKS) {
        let pr = prize;
        if (to !== pick) {
          if (!canSwitch(cash, s, m, pick, to)) {
            // Refused switches are either settled outcomes or over the cap: no value is created.
            const q = chanceOf(s, m, to);
            expect(q <= 0 || q >= 1 || cash / q > MAX_PRIZE).toBe(true);
            continue;
          }
          pr = switchPrize(cash, s, m, to);
          switches++;
          if (pr > MAX_PRIZE / 4) nearCap++;
          expect(pr).toBeLessThanOrEqual(MAX_PRIZE);
          expect(valueAt(s, m, to, pr)).toBeCloseTo(cash, 12);
        }
        const p = kickChance(m, kicker(s));
        const after = p * valueAt(addKick(s, true), m, to, pr) + (1 - p) * valueAt(addKick(s, false), m, to, pr);
        expect(Math.abs(after - cash)).toBeLessThan(1e-9 * Math.max(1, cash));
        // The board's forecast averages back to the chance now.
        const f = forecast(s, m, to);
        expect(f.p * f.ifGoal + (1 - f.p) * f.ifMiss).toBeCloseTo(chanceOf(s, m, to), 12);
      }
    }
    expect(switches).toBeGreaterThan(30);
    expect(nearCap).toBeGreaterThan(0);
  });

  it('the opening value is RTP and the green corners equal the scoring chance the code draws', () => {
    for (const id of MATCHUP_IDS)
      for (const pick of PICKS) {
        const m = MATCHUPS[id];
        expect(prizeFor(m, pick) * chanceOf(EMPTY, m, pick)).toBeCloseTo(RTP, 12);
      }
    for (const p of [0.45, 0.5, 0.55, 0.65, 0.75, 0.8, 0.9]) {
      const { lo, hi } = keeperZone(p);
      expect(lo + (1 - hi)).toBeCloseTo(p, 14);
      // A lattice sweep of u through the real isGoal: the share is p to the lattice step.
      const n = 1 << 16;
      let g = 0;
      for (let i = 0; i < n; i++) if (isGoal((i + 0.5) / n, p)) g++;
      expect(Math.abs(g / n - p)).toBeLessThan(2 / n);
    }
  });

  it('every strategy is worth exactly RTP (backward induction, every config)', () => {
    const rows: string[] = [];
    for (const [level, { matchup, pick }] of Object.entries(VOLATILITY)) {
      const m = MATCHUPS[matchup];
      for (const [name, policy] of Object.entries(STRATEGIES)) {
        const v = exactValue(m, pick, policy);
        rows.push(`${level} ${name}: ${(v * 100).toFixed(10)}%`);
        expect(Math.abs(v - RTP)).toBeLessThan(1e-9);
      }
    }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });

  it('every strategy returns RTP within 4 SE through the game flow (Monte Carlo)', () => {
    const rows: string[] = [];
    let seed = 1;
    for (const [level, { matchup, pick }] of Object.entries(VOLATILITY)) {
      const m = MATCHUPS[matchup];
      for (const [name, policy] of Object.entries(STRATEGIES)) {
        const rng = createRng(seededSource(1000 + seed++));
        let sum = 0;
        let sq = 0;
        for (let i = 0; i < ROUNDS; i++) {
          const x = playManual(m, pick, policy, rng);
          sum += x;
          sq += x * x;
        }
        const mean = sum / ROUNDS;
        const se = Math.sqrt(Math.max(0, sq / ROUNDS - mean * mean) / ROUNDS);
        rows.push(`${level} ${name}: ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}% (z ${((mean - RTP) / se).toFixed(2)})`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
      }
    }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });

  it('Auto pays exactly what manual play with the same stop rule and the same draws pays', () => {
    const rng = createRng(seededSource(5));
    for (let i = 0; i < 1500; i++) {
      const id = MATCHUP_IDS[i % 4];
      const m = MATCHUPS[id];
      const pick = PICKS[rng.int(3)];
      const cashAt = [null, 1.5, 2, 3, 5][rng.int(5)] as null | 1.5 | 2 | 3 | 5;
      const us: number[] = [];
      for (let k = 0; k < 400; k++) us.push(rng.next());
      let k1 = 0;
      const auto = autoRound(m, pick, cashAt, () => us[k1++]);
      let k2 = 0;
      const replay = { next: () => us[k2++], int: (n: number) => Math.floor(us[k2++] * n), shuffle: <T>(x: readonly T[]) => x.slice() };
      const manual = playManual(m, pick, (s, mm, p, prize) => ({ cash: cashAt !== null && prize * chanceOf(s, mm, p) >= cashAt }), replay);
      expect(auto.multiplier).toBe(manual);
      expect(k1).toBe(k2);
    }
  });

  it('the eval configs are the audited ones', () => {
    expect(evalSpec.configs.map((c) => c.params)).toEqual(Object.values(VOLATILITY));
  });
});
