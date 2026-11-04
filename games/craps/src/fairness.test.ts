// Fairness audit: can any way of playing Craps beat the house?
//
// Craps has no cash-out ladder. Its decisions are: which bets go on the
// come-out, how much odds to take or lay once a point is set, which one-roll
// bets to put up (or leave up) on each roll, and leaving mid-round, which
// settles every undecided line or odds bet at its exact expected return from
// the current point (workingValue, Game.tsx's unmount handler). Every bet has
// a documented RTP ≤ 100% (odds exactly 100%). The game is fair when
//   E[money back from the next roll + fair value of what is still working]
//     = fair value working now + Σ (each new stake × its documented RTP)
// for every state and every decision: a decision can then only add bets at
// their documented price, and by optional stopping no strategy (including
// leaving at any moment) returns more than the stake-weighted mix of those
// RTPs, never more than 100%. The check enumerates the 36 dice exactly
// through the engine Game.tsx plays (resolveRoll).
//
// Strategies, per eval family (each round picks one of its strategies at a
// random scale, as the eval does):
//   (a) the tester's: roll only while the working line can't lose on the
//       next roll with chance > 20%, else leave. Pass loses a point roll
//       6/36, Don't Pass at most 5/36, so (a) never leaves: it is (c);
//   (b) take any profit: leave the moment the money back plus the fair value
//       of the working bets exceeds the money staked (Don't Pass on 4, 5, 9
//       or 10 leaves at once);
//   (c) play every round out, odds as the strategy says;
//   (d) the most a player can squeeze: 10× odds behind every line bet (the
//       0-edge bet), one-roll bets kept up, and leave when ahead.
// For each, Σ money back − Σ (stake × documented RTP) over the rounds must be
// 0 within 4 SE: nothing is paid beyond the documented prices.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { IDLE, chargesOf, resolveRoll, withOdds, type RoundState } from './engine';
import evalSpec, { FAMILIES } from './eval';
import {
  ALL_IDS,
  ODDS_IDS,
  ROLL_IDS,
  WAYS,
  betRtp,
  isPoint,
  maxOdds,
  oddsMultiple,
  roundDollars,
  totalOf,
  workingValue,
  type FieldPays,
  type Layout,
  type OddsLimit,
  type Point,
  type Strategy,
} from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000 (scratch fairness/run-heavy.sh). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

const DICE: [number, number][] = [];
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) DICE.push([a, b]);

/** What leaving pays for the working line and odds chips (Game.tsx's unmount handler). */
function workingFair(s: RoundState): number {
  if (s.phase !== 'point') return 0;
  let v = 0;
  for (const id of ALL_IDS) {
    const a = s.working[id] ?? 0;
    if (a && (id === 'pass' || id === 'dontPass' || id === 'passOdds' || id === 'layOdds')) v += a * workingValue(id, s.point);
  }
  return v;
}

/** The documented price of the next roll's charges: Σ stake × RTP. */
function priced(s: RoundState, field: FieldPays): number {
  const { contract, props } = chargesOf(s);
  let v = 0;
  for (const l of [contract, props] as Layout[]) for (const id of ALL_IDS) if (l[id]) v += l[id]! * betRtp(id, field);
  return v;
}

/** Exact E[money back from the next roll + fair value still working] through resolveRoll. */
function nextRollValue(s: RoundState, field: FieldPays, propsStay: boolean): number {
  let v = 0;
  for (const d of DICE) {
    const r = resolveRoll(s, d, field, propsStay);
    v += (r.propRet + r.contractRet + (r.decided ? 0 : workingFair(r.next))) / 36;
  }
  return v;
}

const LIMITS: OddsLimit[] = ['1x', '2x', '345x', '5x', '10x'];
const FIELDS: FieldPays[] = ['double', 'triple'];

/** A random come-out layout: line bets and any mix of one-roll bets. */
function randomLayout(rng: Rng): Layout {
  const l: Layout = {};
  if (rng.next() < 0.7) l.pass = 1 + rng.int(5);
  if (rng.next() < 0.4) l.dontPass = 1 + rng.int(5);
  for (const id of ROLL_IDS) if (rng.next() < 0.25) l[id] = 0.5 + rng.int(4);
  if (!totalOf(l)) l.pass = 1;
  return l;
}

/** Every decision available before a roll in state s (the table as it would be rolled). */
function decisions(s: RoundState, limit: OddsLimit): { name: string; s: RoundState }[] {
  const out = [{ name: 'as is', s }];
  if (s.phase === 'point') {
    out.push({ name: 'max odds', s: withOdds(s, limit, 'max') });
    out.push({ name: '1x odds', s: withOdds(s, limit, '1x') });
    // Only what is working stays: one-roll bets off.
    const bare: RoundState = { ...s, table: { ...s.working } };
    out.push({ name: 'one-roll bets off', s: bare });
  }
  for (const id of ROLL_IDS) out.push({ name: `+ ${id}`, s: { ...s, table: { ...s.table, [id]: (s.table[id] ?? 0) + 1 } } });
  return out;
}

interface Plan {
  layout: Layout;
  /** Odds limit to take at the first point roll (null: none). */
  odds: OddsLimit | null;
  propsStay: boolean;
  field: FieldPays;
  /** Leave when the round is ahead (money back + working fair value > staked). */
  takeProfit: boolean;
  /** Leave when a working line bet loses the next roll with chance > 20%. */
  tester: boolean;
}

/** One round through the engine, as Game.tsx plays it; returns money back, money staked and the documented price. */
function playPlan(p: Plan, rng: Rng) {
  let s: RoundState = { ...IDLE, table: p.layout };
  let back = 0;
  let staked = 0;
  let price = 0;
  let first = true;
  for (;;) {
    if (s.phase === 'point') {
      if (first && p.odds) s = withOdds(s, p.odds, 'max');
      first = false;
      const fair = workingFair(s);
      const ahead = back + fair > staked + 1e-12;
      const pt = s.point!;
      const risky = ((s.working.pass ?? 0) > 0 && 6 / 36 > 0.2) || ((s.working.dontPass ?? 0) > 0 && WAYS[pt] / 36 > 0.2);
      if ((p.takeProfit && ahead) || (p.tester && risky)) return { back: back + fair, staked, price };
    }
    price += priced(s, p.field);
    const r = resolveRoll(s, [1 + rng.int(6), 1 + rng.int(6)], p.field, p.propsStay);
    staked += chargesOf(s).total;
    back += r.propRet + r.contractRet;
    s = r.next;
    if (s.phase === 'over') return { back, staked, price };
  }
}

function planOf(st: Strategy, k: number, mode: 'a' | 'b' | 'c' | 'd'): Plan {
  const layout: Layout = {};
  if (st.pass) layout.pass = st.pass * k;
  if (st.dontPass) layout.dontPass = st.dontPass * k;
  for (const id of ROLL_IDS) if (st.props[id]) layout[id] = st.props[id]! * k;
  return {
    layout,
    odds: mode === 'd' ? '10x' : st.odds,
    propsStay: mode === 'd' ? true : st.propsStay,
    field: st.field,
    takeProfit: mode === 'b' || mode === 'd',
    tester: mode === 'a',
  };
}

describe('Craps fairness', () => {
  it('every bet is priced at ≤ 100%, odds exactly 100%', () => {
    for (const field of FIELDS) {
      for (const id of ALL_IDS) expect(betRtp(id, field)).toBeLessThanOrEqual(1 + 1e-15);
      for (const id of ODDS_IDS) expect(betRtp(id, field)).toBe(1);
    }
  });

  it('martingale: at 30+ reached states, every decision changes the expected value by exactly its documented price', () => {
    const rng = createRng(seededSource(1313));
    let checked = 0;
    const seen = new Set<string>();
    const allPoints = () => [4, 5, 6, 8, 9, 10].every((p) => seen.has(`point:${p}`));
    while (checked < 40 || !allPoints()) {
      const limit = LIMITS[rng.int(LIMITS.length)];
      const field = FIELDS[rng.int(2)];
      const propsStay = rng.next() < 0.5;
      let s: RoundState = { ...IDLE, table: randomLayout(rng) };
      // Walk a random round, checking each state on the way (come-out and point rolls).
      for (let step = 0; step < 6 && s.phase !== 'over'; step++) {
        seen.add(`${s.phase}:${s.point}`);
        for (const { s: t } of decisions(s, limit)) {
          if (t.phase === 'idle' && !(totalOf(t.table) > 0)) continue;
          const lhs = nextRollValue(t, field, propsStay);
          const rhs = workingFair(t) + priced(t, field);
          expect(Math.abs(lhs - rhs)).toBeLessThan(1e-9);
          checked++;
        }
        // Move on with a random decision.
        const ds = decisions(s, limit);
        s = resolveRoll(ds[rng.int(ds.length)].s, [1 + rng.int(6), 1 + rng.int(6)], field, propsStay).next;
      }
    }
    expect(seen.has('idle:null')).toBe(true);
  });

  it('odds can never be stacked beyond the table limit, and lay odds win exactly the limit', () => {
    for (const limit of LIMITS) {
      for (const p of [4, 5, 6, 8, 9, 10] as Point[]) {
        expect(isPoint(p)).toBe(true);
        let s: RoundState = { ...IDLE, phase: 'point', point: p, table: { pass: 3, dontPass: 3 }, working: { pass: 3, dontPass: 3 } };
        s = withOdds(withOdds(s, limit, 'max'), limit, 'max');
        expect(s.table.passOdds!).toBeLessThanOrEqual(maxOdds('passOdds', 3, limit, p) + 1e-9);
        expect(s.table.layOdds!).toBeLessThanOrEqual(maxOdds('layOdds', 3, limit, p) + 1e-9);
        expect(s.table.layOdds! * (WAYS[p] / 6)).toBeLessThanOrEqual(oddsMultiple(limit, p) * 3 + 1e-9);
      }
    }
  });

  it('best possible play stays below 100%: the most odds behind either line', () => {
    const S = (p: Partial<Strategy>): Strategy => ({ pass: 0, dontPass: 0, odds: null, props: {}, propsStay: false, field: 'double', ...p });
    const best = Math.max(
      ...LIMITS.flatMap((odds) => [roundDollars(S({ pass: 1, odds })).rtp, roundDollars(S({ dontPass: 1, odds })).rtp]),
    );
    // Don't Pass with 10× lay odds: (1953/1980 + 10) / 11.
    expect(best).toBeCloseTo((1953 / 1980 + 10) / 11, 12);
    expect(best).toBeLessThan(1);
  });

  it('strategies (a)–(d) on every eval family pay exactly the documented prices (4 SE)', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params: { family } }, ci) => {
      (['a', 'b', 'c', 'd'] as const).forEach((mode, mi) => {
        const rng = createRng(seededSource(8800 + 37 * ci + mi));
        let sumBack = 0;
        let sumStaked = 0;
        let sumPrice = 0;
        let s1 = 0;
        let s2 = 0;
        for (let i = 0; i < ROUNDS; i++) {
          const st = FAMILIES[family].strategies[rng.int(FAMILIES[family].strategies.length)];
          const r = playPlan(planOf(st, 1 + rng.int(5), mode), rng);
          sumBack += r.back;
          sumStaked += r.staked;
          sumPrice += r.price;
          const x = r.back - r.price;
          s1 += x;
          s2 += x * x;
        }
        const mean = s1 / ROUNDS;
        const se = Math.sqrt(Math.max(0, s2 / ROUNDS - mean * mean) / ROUNDS);
        const perStake = ROUNDS / sumStaked;
        rows.push(
          `${label.slice(0, 7).padEnd(8)} (${mode}) RTP ${((sumBack / sumStaked) * 100).toFixed(2)}%  priced ${((sumPrice / sumStaked) * 100).toFixed(2)}%  excess ${(mean * perStake * 100).toFixed(3)}% ± ${(se * perStake * 100).toFixed(3)}%`,
        );
        expect(Math.abs(mean)).toBeLessThan(4 * se + 1e-12);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
