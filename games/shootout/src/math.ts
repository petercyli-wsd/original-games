// Shootout: a penalty shootout between Teal and Orange. They kick in turn,
// Teal first, five each; every Teal kick scores with chance pA and every
// Orange kick with chance pB, independently. The leader after five each wins,
// and the shootout stops early once one side can no longer be caught. If it
// is level after five each, sudden death: pairs of kicks until one side scores
// and the other misses. You back Teal, Orange, or "Goes to sudden death".
//
// Exact odds. In regulation, the final goal difference is the current one
// plus Bin(Teal kicks left, pA) − Bin(Orange kicks left, pB), a convolution of
// two binomials. (Stopping early never changes who wins, so the full
// convolution is exact.) A level score goes to sudden death, which Teal wins
// with the geometric-tail chance
//   s = pA(1 − pB) / (pA(1 − pB) + pB(1 − pA)),
// since each pair is decisive with that denominator and Teal takes it with
// the numerator. Inside a pair, after Teal scores Teal wins with 1 − pB + pB·s;
// after Teal misses, with (1 − pB)·s.
//
// The goal is drawn literally: the keeper covers the middle 1 − p of the
// goal mouth and the shot lands uniformly across it, so the green corners are
// exactly the chance to score.
//
// Pricing (fixed prize, contract pattern 1). Backing outcome X pays
// prize = RTP / P(X) and the cash-out is prize × P(X | kicks so far). P(X | ·)
// is a martingale in the kicks, so the cash-out is one too, and every
// stopping rule returns exactly RTP. Switching at a checkpoint keeps the
// cash-out and re-locks the prize at cash-out / P(new outcome), so a switch
// moves volatility, never EV. A switch is offered only if the new prize stays
// within MAX_PRIZE; every payout is at most the prize, so that is an honest
// bound for maxMultiplier.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
/** Regulation kicks per side. */
export const KICKS = 5;
/** No prize (and so no payout) can exceed this; switches above it are not offered. */
export const MAX_PRIZE = 1000;

export type Team = 'A' | 'B';
/** What you back: Teal (A) wins, Orange (B) wins, or it goes to sudden death. */
export type Pick = 'A' | 'B' | 'SD';
export const PICKS: readonly Pick[] = ['A', 'SD', 'B'];

export const TEAM_NAME: Record<Team, string> = { A: 'Teal', B: 'Orange' };
export const PICK_NAME: Record<Pick, string> = {
  A: 'Teal',
  B: 'Orange',
  SD: 'Sudden death',
};

export interface Matchup {
  label: string;
  /** Teal's scoring chance per kick. */
  pA: number;
  /** Orange's scoring chance per kick. */
  pB: number;
}

export const MATCHUP_IDS = ['even', 'edge', 'mismatch', 'keepers'] as const;
export type MatchupId = (typeof MATCHUP_IDS)[number];

export const MATCHUPS: Record<MatchupId, Matchup> = {
  even: { label: 'Even', pA: 0.75, pB: 0.75 },
  edge: { label: 'Edge', pA: 0.8, pB: 0.65 },
  mismatch: { label: 'Mismatch', pA: 0.9, pB: 0.45 },
  keepers: { label: 'Keepers', pA: 0.55, pB: 0.5 },
};

/** The kicks so far: true = goal, false = miss. Teal (a) kicks first. */
export interface Kicks {
  a: readonly boolean[];
  b: readonly boolean[];
}

export const EMPTY: Kicks = { a: [], b: [] };

export const goalsOf = (xs: readonly boolean[]) => xs.reduce((n, g) => n + (g ? 1 : 0), 0);

/** Who takes the next kick. */
export const kicker = (s: Kicks): Team => (s.a.length === s.b.length ? 'A' : 'B');

export const kickChance = (m: Matchup, t: Team) => (t === 'A' ? m.pA : m.pB);

export const addKick = (s: Kicks, goal: boolean): Kicks => (kicker(s) === 'A' ? { a: [...s.a, goal], b: s.b } : { a: s.a, b: [...s.b, goal] });

/** The shootout's winner, once it is decided (early in regulation when a side can't be caught). */
export function winner(s: Kicks): Team | null {
  const ka = s.a.length;
  const kb = s.b.length;
  const ga = goalsOf(s.a);
  const gb = goalsOf(s.b);
  if (ka <= KICKS && kb <= KICKS) {
    if (ga - gb > KICKS - kb) return 'A';
    if (gb - ga > KICKS - ka) return 'B';
    return null;
  }
  if (ka === kb && ga !== gb) return ga > gb ? 'A' : 'B';
  return null;
}

/** Whether it was level after five each (sudden death reached). */
export const reachedSuddenDeath = (s: Kicks) => s.b.length >= KICKS && (s.a.length > KICKS || goalsOf(s.a) === goalsOf(s.b));

/** Whether this kick is a sudden-death kick. */
export const inSuddenDeath = (s: Kicks) => s.a.length >= KICKS && s.b.length >= KICKS && reachedSuddenDeath(s);

/** Teal's chance to win a sudden death from the start of a pair (and Orange's). */
export function suddenDeath(m: Matchup) {
  const a = m.pA * (1 - m.pB);
  const b = m.pB * (1 - m.pA);
  return { A: a / (a + b), B: b / (a + b) };
}

/** Binomial(n, p) probabilities, index = successes. */
function binom(n: number, p: number): number[] {
  const out = new Array<number>(n + 1).fill(0);
  let c = 1;
  for (let k = 0; k <= n; k++) {
    out[k] = c * p ** k * (1 - p) ** (n - k);
    c = (c * (n - k)) / (k + 1);
  }
  return out;
}

export interface Odds {
  /** Teal wins the shootout. */
  A: number;
  /** Orange wins. */
  B: number;
  /** It is (or was) level after five each. */
  SD: number;
  /** Teal wins without sudden death, and Orange likewise (for the board's split bar). */
  regA: number;
  regB: number;
}

/** Exact chances of every outcome from this point. */
export function odds(s: Kicks, m: Matchup): Odds {
  const w = winner(s);
  const sd = reachedSuddenDeath(s);
  if (w) {
    const A = w === 'A' ? 1 : 0;
    return {
      A,
      B: 1 - A,
      SD: sd ? 1 : 0,
      regA: sd ? 0 : A,
      regB: sd ? 0 : 1 - A,
    };
  }
  const tail = suddenDeath(m);
  if (sd) {
    const ga = goalsOf(s.a);
    const gb = goalsOf(s.b);
    if (s.a.length === s.b.length) return { A: tail.A, B: tail.B, SD: 1, regA: 0, regB: 0 };
    // Teal has kicked in this pair; Orange is up.
    if (ga > gb)
      return {
        A: 1 - m.pB + m.pB * tail.A,
        B: m.pB * tail.B,
        SD: 1,
        regA: 0,
        regB: 0,
      };
    return {
      A: (1 - m.pB) * tail.A,
      B: m.pB + (1 - m.pB) * tail.B,
      SD: 1,
      regA: 0,
      regB: 0,
    };
  }
  const d = goalsOf(s.a) - goalsOf(s.b);
  const xa = binom(KICKS - s.a.length, m.pA);
  const yb = binom(KICKS - s.b.length, m.pB);
  let regA = 0;
  let regB = 0;
  let level = 0;
  for (let i = 0; i < xa.length; i++) {
    for (let j = 0; j < yb.length; j++) {
      const mass = xa[i] * yb[j];
      const f = d + i - j;
      if (f > 0) regA += mass;
      else if (f < 0) regB += mass;
      else level += mass;
    }
  }
  return {
    A: regA + level * tail.A,
    B: regB + level * tail.B,
    SD: level,
    regA,
    regB,
  };
}

export const chanceOf = (s: Kicks, m: Matchup, pick: Pick) => odds(s, m)[pick];

/** The prize for backing `pick` before any kick. */
export const prizeFor = (m: Matchup, pick: Pick) => RTP / chanceOf(EMPTY, m, pick);

/** Whether your pick has been settled by the kicks so far. */
export function settled(s: Kicks, pick: Pick): 'win' | 'lose' | null {
  if (pick === 'SD') {
    if (reachedSuddenDeath(s)) return 'win';
    return winner(s) ? 'lose' : null;
  }
  const w = winner(s);
  return w ? (w === pick ? 'win' : 'lose') : null;
}

/**
 * The goal mouth as a line from 0 to 1. The keeper covers the middle 1 − p;
 * the shot lands at a uniform u, and scores in either corner. Ties: [lo, hi).
 */
export const keeperZone = (p: number) => ({ lo: p / 2, hi: 1 - p / 2 });
export const isGoal = (u: number, p: number) => {
  const { lo, hi } = keeperZone(p);
  return u < lo || u >= hi;
};

export interface Forecast {
  team: Team;
  /** The kicker's chance to score. */
  p: number;
  /** Your chance if this kick goes in, and if it is missed. p·ifGoal + (1−p)·ifMiss = your chance now. */
  ifGoal: number;
  ifMiss: number;
}

export function forecast(s: Kicks, m: Matchup, pick: Pick): Forecast {
  const team = kicker(s);
  return {
    team,
    p: kickChance(m, team),
    ifGoal: chanceOf(addKick(s, true), m, pick),
    ifMiss: chanceOf(addKick(s, false), m, pick),
  };
}

/** The prize after switching to `pick` at a checkpoint: the cash-out is kept. */
export const switchPrize = (cash: number, s: Kicks, m: Matchup, pick: Pick) => cash / chanceOf(s, m, pick);

/** A switch is offered while the new outcome is still open and its prize within the cap. */
export function canSwitch(cash: number, s: Kicks, m: Matchup, from: Pick, to: Pick) {
  if (to === from) return false;
  const p = chanceOf(s, m, to);
  return p > 0 && p < 1 && cash / p <= MAX_PRIZE;
}

/** The volatility of backing `pick` in matchup `m`, from its chance. */
export function volatilityOf(m: Matchup, pick: Pick): Volatility {
  const p = chanceOf(EMPTY, m, pick);
  return p > 0.6 ? 'low' : p > 0.3 ? 'medium' : p > 0.1 ? 'high' : 'extreme';
}

export const VOLATILITY: Record<Volatility, { matchup: MatchupId; pick: Pick }> = {
  low: { matchup: 'mismatch', pick: 'A' },
  medium: { matchup: 'even', pick: 'A' },
  high: { matchup: 'edge', pick: 'B' },
  extreme: { matchup: 'mismatch', pick: 'B' },
};

/** Auto cash-out targets (× stake); null = play to the end. */
export const CASH_AT = [null, 1.5, 2, 3, 5] as const;
export type CashAt = (typeof CASH_AT)[number];

export interface AutoResult {
  /** The state after every kick, in order. */
  states: Kicks[];
  multiplier: number;
  outcome: 'win' | 'lose' | 'cashed';
}

/**
 * One whole Auto round: kick until your pick is settled, or cash out as soon
 * as the cash-out reaches `cashAt` (a stopping rule, so RTP is unchanged).
 */
export function autoRound(m: Matchup, pick: Pick, cashAt: CashAt, u: () => number): AutoResult {
  const prize = prizeFor(m, pick);
  let s = EMPTY;
  const states: Kicks[] = [];
  for (;;) {
    s = addKick(s, isGoal(u(), kickChance(m, kicker(s))));
    states.push(s);
    const r = settled(s, pick);
    if (r) return { states, multiplier: r === 'win' ? prize : 0, outcome: r };
    const cash = prize * chanceOf(s, m, pick);
    if (cashAt !== null && cash >= cashAt) return { states, multiplier: cash, outcome: 'cashed' };
  }
}

/** Every opening prize is within the cap, and every payout is at most its prize. */
export const MAX_MULTIPLIER = Math.max(MAX_PRIZE, ...MATCHUP_IDS.flatMap((id) => PICKS.map((p) => prizeFor(MATCHUPS[id], p))));
