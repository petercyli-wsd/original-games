import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  EMPTY,
  KICKS,
  MATCHUPS,
  MATCHUP_IDS,
  MAX_PRIZE,
  PICKS,
  RTP,
  addKick,
  autoRound,
  canSwitch,
  chanceOf,
  forecast,
  isGoal,
  keeperZone,
  kickChance,
  kicker,
  odds,
  prizeFor,
  reachedSuddenDeath,
  settled,
  suddenDeath,
  switchPrize,
  winner,
  type Kicks,
  type Matchup,
} from './math';

const rng = createRng(seededSource(11));

/** The raw process, with no early stop: five each, then sudden-death pairs. */
function rawShootout(m: Matchup, u: () => number) {
  let a = 0;
  let b = 0;
  for (let i = 0; i < KICKS; i++) {
    if (u() < m.pA) a++;
    if (u() < m.pB) b++;
  }
  if (a !== b) return { winner: a > b ? 'A' : 'B', sd: false };
  for (;;) {
    const ga = u() < m.pA;
    const gb = u() < m.pB;
    if (ga !== gb) return { winner: ga ? 'A' : 'B', sd: true };
  }
}

/** Every state reachable in regulation (plus a few pairs of sudden death), by playing kicks out. */
function reachable(): Kicks[] {
  const out: Kicks[] = [];
  const walk = (s: Kicks, depth: number) => {
    out.push(s);
    if (winner(s) || depth > 14) return;
    walk(addKick(s, true), depth + 1);
    walk(addKick(s, false), depth + 1);
  };
  walk(EMPTY, 0);
  return out;
}

describe('Shootout maths', () => {
  it('the exact chances match a direct simulation of the raw shootout', () => {
    for (const id of MATCHUP_IDS) {
      const m = MATCHUPS[id];
      const rounds = 40_000;
      let wa = 0;
      let sd = 0;
      for (let r = 0; r < rounds; r++) {
        const res = rawShootout(m, () => rng.next());
        if (res.winner === 'A') wa++;
        if (res.sd) sd++;
      }
      const o = odds(EMPTY, m);
      for (const [hits, p] of [
        [wa, o.A],
        [sd, o.SD],
      ]) {
        expect(Math.abs(hits / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
      }
    }
  });

  it('even matchups are a coin flip, and the sudden-death tail is the geometric formula', () => {
    expect(odds(EMPTY, MATCHUPS.even).A).toBeCloseTo(0.5, 12);
    for (const id of MATCHUP_IDS) {
      const m = MATCHUPS[id];
      const t = suddenDeath(m);
      // s = pA(1−pB) + (pA·pB + (1−pA)(1−pB))·s
      expect(m.pA * (1 - m.pB) + (m.pA * m.pB + (1 - m.pA) * (1 - m.pB)) * t.A).toBeCloseTo(t.A, 12);
      expect(t.A + t.B).toBeCloseTo(1, 12);
    }
  });

  it('every kick is a fair bet: the two branches average to the odds now (martingale)', () => {
    for (const id of MATCHUP_IDS) {
      const m = MATCHUPS[id];
      for (const s of reachable()) {
        for (const pick of PICKS) {
          if (settled(s, pick)) continue;
          const f = forecast(s, m, pick);
          expect(f.p * f.ifGoal + (1 - f.p) * f.ifMiss).toBeCloseTo(chanceOf(s, m, pick), 12);
        }
        const o = odds(s, m);
        expect(o.A + o.B).toBeCloseTo(1, 12);
        // The split bar: Teal's share = Teal in regulation + Teal's part of sudden death.
        expect(o.regA + o.regB + o.SD).toBeCloseTo(1, 12);
      }
    }
  });

  it('the shootout stops exactly when the result is certain', () => {
    for (const id of MATCHUP_IDS) {
      const m = MATCHUPS[id];
      for (const s of reachable()) {
        const o = odds(s, m);
        if (winner(s)) expect(o.A === 0 || o.A === 1).toBe(true);
        else {
          expect(o.A).toBeGreaterThan(0);
          expect(o.A).toBeLessThan(1);
        }
        // Sudden death is reached only from a level score after five each.
        if (reachedSuddenDeath(s)) expect(s.b.length).toBeGreaterThanOrEqual(KICKS);
      }
    }
  });

  it('the drawn goal is the true chance: the keeper covers exactly 1 − p of the mouth', () => {
    for (const p of [0.45, 0.5, 0.55, 0.65, 0.75, 0.8, 0.9]) {
      const { lo, hi } = keeperZone(p);
      expect(hi - lo).toBeCloseTo(1 - p, 12);
      const N = 20_000;
      let goals = 0;
      for (let i = 0; i < N; i++) if (isGoal((i + 0.5) / N, p)) goals++;
      expect(Math.abs(goals / N - p)).toBeLessThan(2 / N);
    }
  });

  it('switching keeps the cash-out, and switching back restores the prize', () => {
    const m = MATCHUPS.edge;
    let s = EMPTY;
    for (const g of [true, false, true, true, false]) s = addKick(s, g);
    const prize = prizeFor(m, 'A');
    const cash = prize * chanceOf(s, m, 'A');
    for (const to of PICKS) {
      if (!canSwitch(cash, s, m, 'A', to)) continue;
      const relocked = switchPrize(cash, s, m, to);
      expect(relocked * chanceOf(s, m, to)).toBeCloseTo(cash, 12);
      expect(switchPrize(relocked * chanceOf(s, m, to), s, m, 'A')).toBeCloseTo(prize, 10);
    }
  });

  it('prizes stay within the cap, and switches above it are not offered', () => {
    for (const id of MATCHUP_IDS) for (const p of PICKS) expect(prizeFor(MATCHUPS[id], p)).toBeLessThanOrEqual(MAX_PRIZE);
    const m = MATCHUPS.mismatch;
    let s = EMPTY;
    for (const g of [true, false, false, true, true, false]) s = addKick(s, g);
    // Orange is now a long shot; a big cash-out cannot be moved onto it past the cap.
    const p = chanceOf(s, m, 'B');
    expect(canSwitch(MAX_PRIZE * p * 1.01, s, m, 'A', 'B')).toBe(false);
    expect(canSwitch(MAX_PRIZE * p * 0.99, s, m, 'A', 'B')).toBe(true);
    expect(manifest.maxMultiplier).toBeGreaterThanOrEqual(MAX_PRIZE);
  });

  it('kicks alternate Teal first, and a settled pick ends the round', () => {
    let s = EMPTY;
    expect(kicker(s)).toBe('A');
    s = addKick(s, true);
    expect(kicker(s)).toBe('B');
    // Teal 3/3, Orange 0/3: Orange can reach at most 2, Teal wins.
    s = { a: [true, true, true], b: [false, false, false] };
    expect(winner(s)).toBe('A');
    expect(settled(s, 'SD')).toBe('lose');
    const level = {
      a: [true, true, true, true, false],
      b: [true, true, true, false, true],
    };
    expect(settled(level, 'SD')).toBe('win');
    expect(settled(level, 'A')).toBeNull();
    // Sudden death: Teal misses, Orange scores.
    expect(winner(addKick(addKick(level, false), true))).toBe('B');
    expect(winner(addKick(level, false))).toBeNull();
  });

  it('Auto rounds pay their cash-out rule and keep RTP', () => {
    for (const id of MATCHUP_IDS) {
      const m = MATCHUPS[id];
      for (const pick of PICKS) {
        const rounds = 6000;
        let sum = 0;
        let sq = 0;
        for (let r = 0; r < rounds; r++) {
          const res = autoRound(m, pick, 2, () => rng.next());
          if (res.outcome === 'cashed') expect(res.multiplier).toBeGreaterThanOrEqual(2);
          sum += res.multiplier;
          sq += res.multiplier ** 2;
        }
        const mean = sum / rounds;
        const se = Math.sqrt((sq / rounds - mean ** 2) / rounds);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
      }
    }
    // The goal draw uses the kicker's own chance.
    expect(kickChance(MATCHUPS.mismatch, 'B')).toBe(0.45);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
