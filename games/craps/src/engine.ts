// The table in play, without React: what a roll charges, how it resolves the
// chips on the table, and the Auto round loop. Game.tsx drives these with the
// wallet and the animations; the tests drive the same functions directly and
// check them against the exact maths (playStrategy / roundDollars).

import {
  ALL_IDS,
  LINE_OF,
  ODDS_IDS,
  ROLL_IDS,
  advance,
  cents,
  floorCents,
  lineReturn,
  maxOdds,
  oddsReturn,
  rollReturn,
  totalOf,
  type BetId,
  type FieldPays,
  type Layout,
  type OddsId,
  type OddsLimit,
  type Outcome,
  type Point,
} from './math';

export type Phase = 'idle' | 'rolling' | 'point' | 'over';
export type AutoOdds = 'none' | '1x' | '2x' | 'max';

export interface Marks {
  won: Partial<Record<BetId, number>>;
  lost: BetId[];
  push: BetId[];
}

export interface RoundState {
  phase: Phase;
  /** Chips on the table. */
  table: Layout;
  /** Line and odds chips already staked and working this round. */
  working: Layout;
  /** The come-out layout of this round (Bet again, Auto). */
  base: Layout;
  point: Point | null;
  wagered: number;
  returned: number;
  rolls: number;
  outcome: Outcome | null;
  lastSum: number | null;
  /** The point that was on when the round ended (for the title). */
  endPoint: Point | null;
  marks: Marks | null;
}

export const IDLE: RoundState = { phase: 'idle', table: {}, working: {}, base: {}, point: null, wagered: 0, returned: 0, rolls: 0, outcome: null, lastSum: null, endPoint: null, marks: null };

export const isOdds = (id: BetId): id is OddsId => id === 'passOdds' || id === 'layOdds';
export const isLine = (id: BetId): id is 'pass' | 'dontPass' => id === 'pass' || id === 'dontPass';

/** Drops empty bets and rounds to cents. */
export function clean(l: Layout): Layout {
  const out: Layout = {};
  for (const id of ALL_IDS) if ((l[id] ?? 0) > 0.0001) out[id] = cents(l[id]!);
  return out;
}

/** The same layout scaled to a new total (Auto's on win / on loss). */
export function scaleLayout(l: Layout, total: number): Layout {
  const t = totalOf(l);
  if (!(t > 0)) return l;
  const out: Layout = {};
  for (const id of ALL_IDS) if (l[id]) out[id] = Math.max(0.01, cents((l[id]! * total) / t));
  return out;
}

/**
 * What the next roll charges. On the come-out: the line bets plus the
 * one-roll bets. On a point: odds added since the last roll plus the one-roll
 * bets. Line and odds money ("contract") and one-roll money go on separate
 * tickets, because they settle at different times.
 */
export function chargesOf(s: RoundState) {
  const comeOut = s.phase !== 'point';
  const contract: Layout = {};
  const props: Layout = {};
  if (comeOut) {
    if (s.table.pass) contract.pass = s.table.pass;
    if (s.table.dontPass) contract.dontPass = s.table.dontPass;
  } else {
    for (const id of ODDS_IDS) {
      const add = cents((s.table[id] ?? 0) - (s.working[id] ?? 0));
      if (add > 0) contract[id] = add;
    }
  }
  for (const id of ROLL_IDS) if (s.table[id]) props[id] = s.table[id];
  return { contract, props, total: cents(totalOf(contract) + totalOf(props)) };
}

/** The most odds the table allows behind the working line bet (to the cent, rounded down). */
export function oddsCap(s: RoundState, id: OddsId, limit: OddsLimit): number {
  if (s.point === null) return 0;
  return floorCents(maxOdds(id, s.working[LINE_OF[id]] ?? 0, limit, s.point));
}

/** Takes odds behind every working line bet: the table maximum, or a smaller multiple (Auto). */
export function withOdds(s: RoundState, limit: OddsLimit, mode: AutoOdds = 'max'): RoundState {
  if (s.phase !== 'point' || s.point === null || mode === 'none') return s;
  const table = { ...s.table };
  for (const id of ODDS_IDS) {
    const line = s.working[LINE_OF[id]] ?? 0;
    if (!line) continue;
    const cap = oddsCap(s, id, limit);
    const want = mode === 'max' ? cap : Math.min(cap, floorCents(maxOdds(id, line, mode, s.point)));
    table[id] = Math.max(s.working[id] ?? 0, want);
  }
  return { ...s, table: clean(table) };
}

/** Takes off everything not yet working (pending odds, one-roll bets). */
export function onlyWorking(s: RoundState): RoundState {
  const table: Layout = {};
  for (const id of ALL_IDS) if (s.working[id]) table[id] = s.working[id];
  return { ...s, table };
}

export type RollTag = 'win' | 'lose' | 'point' | 'push' | 'roll';

export interface RollResult {
  /** The state once the roll has played out (phase 'over' or 'point'). */
  next: RoundState;
  contract: Layout;
  props: Layout;
  /** Whether the line (and so every contract ticket) is settled by this roll. */
  decided: boolean;
  /** Return per unit of each bet on this roll, for decided contract bets and one-roll bets. */
  returnOf(id: BetId): number;
  propRet: number;
  contractRet: number;
  tag: RollTag;
}

/** Resolves one roll of dice d against the table in state s. Pure. */
export function resolveRoll(s: RoundState, d: [number, number], field: FieldPays, propsStay: boolean): RollResult {
  const comeOut = s.phase !== 'point';
  const { contract, props, total } = chargesOf(s);
  const sum = d[0] + d[1];
  const point = comeOut ? null : s.point;
  const hasLine = comeOut ? !!(s.table.pass || s.table.dontPass) : true;
  const step = advance(point, sum);
  const decided = !hasLine || step.decided;

  const returnOf = (id: BetId): number => {
    if (isLine(id)) return lineReturn(id, point, sum) ?? 0;
    if (isOdds(id)) return point === null ? 0 : (oddsReturn(id, point, sum) ?? 0);
    return rollReturn(id, sum, field);
  };

  const marks: Marks = { won: {}, lost: [], push: [] };
  let propRet = 0;
  for (const id of ROLL_IDS) {
    const a = props[id] ?? 0;
    if (!a) continue;
    const r = a * returnOf(id);
    propRet += r;
    if (r > 0) marks.won[id] = r - a;
    else marks.lost.push(id);
  }

  const working: Layout = comeOut ? { ...contract } : { ...s.working };
  if (!comeOut) for (const id of ODDS_IDS) if (contract[id]) working[id] = cents((working[id] ?? 0) + contract[id]!);
  let contractRet = 0;
  if (hasLine && step.decided) {
    for (const id of [...(['pass', 'dontPass'] as const), ...ODDS_IDS]) {
      const a = working[id] ?? 0;
      if (!a) continue;
      const r = a * returnOf(id);
      contractRet += r;
      if (r > a + 1e-9) marks.won[id] = r - a;
      else if (Math.abs(r - a) < 1e-9) marks.push.push(id);
      else marks.lost.push(id);
    }
  }

  const wagered = (comeOut ? 0 : s.wagered) + total;
  const returned = (comeOut ? 0 : s.returned) + propRet + contractRet;
  const rolls = (comeOut ? 0 : s.rolls) + 1;
  const base = comeOut ? clean({ ...s.table }) : s.base;
  const tag: RollTag = !hasLine
    ? propRet > 0
      ? 'win'
      : 'lose'
    : step.outcome === 'natural' || step.outcome === 'pointMade'
      ? 'win'
      : step.outcome === 'craps' || step.outcome === 'sevenOut'
        ? 'lose'
        : step.outcome === 'bar'
          ? 'push'
          : step.outcome === 'pointSet'
            ? 'point'
            : 'roll';

  let next: RoundState;
  if (decided) {
    next = {
      ...s,
      phase: 'over',
      table: { ...s.table, ...working },
      working,
      base,
      point: null,
      endPoint: point,
      wagered,
      returned,
      rolls,
      outcome: hasLine ? step.outcome : 'roll',
      lastSum: sum,
      marks,
    };
  } else {
    // Still rolling for the point: one-roll bets stay up or come down.
    const table: Layout = { ...s.table, ...working };
    if (!propsStay) for (const id of ROLL_IDS) delete table[id];
    next = { ...s, phase: 'point', table: clean(table), working, base, point: step.point, endPoint: null, wagered, returned, rolls, outcome: step.outcome, lastSum: sum, marks };
  }
  return { next, contract, props, decided, returnOf, propRet, contractRet, tag };
}

/** The settlement multiplier of a ticket holding `parts`, once its bets are decided. */
export function ticketValue(parts: Layout, returnOf: (id: BetId) => number): number {
  const amount = totalOf(parts);
  let v = 0;
  for (const id of ALL_IDS) if (parts[id]) v += parts[id]! * returnOf(id);
  return amount > 0 ? v / amount : 0;
}

export interface AutoConfig {
  limit: OddsLimit;
  autoOdds: AutoOdds;
  field: FieldPays;
  propsStay: boolean;
}

/**
 * Prepares the table before an Auto roll: odds go up once, on the first roll
 * after the point is set, and whatever the balance can't cover comes off.
 */
export function autoBeforeRoll(s: RoundState, cfg: AutoConfig, firstPointRoll: boolean, balance: number): RoundState {
  let p = firstPointRoll ? withOdds(s, cfg.limit, cfg.autoOdds) : s;
  if (chargesOf(p).total > balance + 1e-9) p = onlyWorking(p);
  return p;
}

/**
 * One whole Auto round without animation or wallet, ticket by ticket, exactly
 * as Game.tsx plays it: for the tests.
 */
export function simulateAutoRound(layout: Layout, cfg: AutoConfig, nextDice: () => [number, number], balance = Infinity) {
  let s: RoundState = { ...IDLE, table: layout };
  const open: { parts: Layout; amount: number; value: number | null }[] = [];
  let placed = 0;
  let settled = 0;
  let paid = 0;
  let first = true;
  for (;;) {
    if (s.phase === 'point') {
      s = autoBeforeRoll(s, cfg, first, balance);
      first = false;
    }
    const r = resolveRoll(s, nextDice(), cfg.field, cfg.propsStay);
    const c = totalOf(r.contract) > 0 ? { parts: r.contract, amount: totalOf(r.contract), value: null as number | null } : null;
    const p = totalOf(r.props) > 0 ? { parts: r.props, amount: totalOf(r.props), value: ticketValue(r.props, r.returnOf) } : null;
    for (const t of [c, p]) if (t) (placed++, open.push(t));
    balance -= totalOf(r.contract) + totalOf(r.props);
    const settle = (t: (typeof open)[number]) => {
      open.splice(open.indexOf(t), 1);
      settled++;
      paid += t.amount * t.value!;
      balance += t.amount * t.value!;
    };
    if (p) settle(p);
    if (r.decided) for (const t of [...open]) (t.value = ticketValue(t.parts, r.returnOf), settle(t));
    s = r.next;
    if (s.phase === 'over') return { state: s, placed, settled, paid, open: open.length };
  }
}
