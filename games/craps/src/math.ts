// Craps (the RNG craps tables at BC.Game, Stake…). Two fair dice, so a roll's
// sum s has probability WAYS[s] / 36. A round is one pass-line decision:
//
//   Come-out roll: 7 or 11 is a natural (Pass wins), 2, 3 or 12 is craps
//   (Pass loses; Don't Pass wins on 2 or 3 and pushes on 12, "bar 12").
//   Any other sum p becomes the point. The dice then roll until p again
//   (Pass wins) or 7 (seven out, Don't Pass wins).
//
// Exact odds come from the two-state Markov chain. Once the point is p, only
// the rolls p and 7 matter, so P(point before 7) = w / (w + 6) with w = WAYS[p].
//
//   P(Pass wins)       = 8/36 + Σ_p (w/36)·w/(w+6)        = 244/495
//   RTP(Pass)          = 2 · 244/495                       = 488/495   = 98.586%
//   P(Don't Pass wins) = 3/36 + Σ_p (w/36)·6/(w+6)         = 949/1980,  push 1/36
//   RTP(Don't Pass)    = 2 · 949/1980 + 1/36               = 1953/1980 = 98.636%
//   Odds behind Pass pay 6:w (2:1 on 4/10, 3:2 on 5/9, 6:5 on 6/8) and lay
//   odds behind Don't Pass pay w:6, the true odds, so both return exactly 100%.
//
// One-roll bets (each RTP = Σ ways × return / 36):
//   Field 2,3,4,9,10,11,12 (2 and 12 pay 2:1)   34/36 = 94.444%
//   Field with 12 paying 3:1                     35/36 = 97.222%
//   Any 7 4:1                                    30/36 = 83.333%
//   Any Craps (2, 3, 12) 7:1                     32/36 = 88.889%
//   Yo (11) 15:1, Ace-Deuce (3) 15:1             32/36 = 88.889%
//   Aces (2) 30:1, Twelve (12) 30:1              31/36 = 86.111%
//
// A layout is a set of independent bets on the same dice, so its expected
// return is the stake-weighted sum of these. The round multiplier the eval and
// the history show is returned / wagered, whose expectation depends on how
// much was staked in each branch (odds are added only once there is a point,
// one-roll bets can stay up for every roll). `roundMoments` computes it
// exactly: finite enumeration for the come-out, and for each point an exact
// geometric series over the number of rolls N (the series is summed until its
// terms fall below 1e-18, i.e. to double precision).
//
// manifest.rtp is the main bet's RTP, Pass = 488/495. No payout ratio exceeds
// a 30:1 prop (31× its stake) and a round's return is a stake-weighted mix of
// bet returns, so 31× bounds every round multiplier.

export const WAYS = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1] as const;
export const SUMS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const POINTS = [4, 5, 6, 8, 9, 10] as const;
export type Point = (typeof POINTS)[number];

export const PASS_RTP = 488 / 495;
export const DONT_RTP = 1953 / 1980;
export const RTP = PASS_RTP;
export const MAX_MULTIPLIER = 31;

export const isPoint = (s: number): s is Point => s === 4 || s === 5 || s === 6 || s === 8 || s === 9 || s === 10;

/** Two fair dice from a uniform integer source. */
export const rollDice = (int: (n: number) => number): [number, number] => [1 + int(6), 1 + int(6)];

// ------------------------------------------------------------------ bets

export type LineId = 'pass' | 'dontPass';
export type OddsId = 'passOdds' | 'layOdds';
export type RollId = 'field' | 'any7' | 'anyCraps' | 'yo' | 'aceDeuce' | 'aces' | 'twelve';
export type BetId = LineId | OddsId | RollId;
export type Layout = Partial<Record<BetId, number>>;

export const LINE_IDS: LineId[] = ['pass', 'dontPass'];
export const ODDS_IDS: OddsId[] = ['passOdds', 'layOdds'];
export const ROLL_IDS: RollId[] = ['field', 'any7', 'anyCraps', 'yo', 'aceDeuce', 'aces', 'twelve'];
export const ALL_IDS: BetId[] = [...LINE_IDS, ...ODDS_IDS, ...ROLL_IDS];

export const ODDS_OF: Record<LineId, OddsId> = { pass: 'passOdds', dontPass: 'layOdds' };
export const LINE_OF: Record<OddsId, LineId> = { passOdds: 'pass', layOdds: 'dontPass' };

export type FieldPays = 'double' | 'triple';
export const FIELD_PAYS: { id: FieldPays; label: string; title: string }[] = [
  { id: 'double', label: '2 & 12 pay 2:1', title: 'The classic field: 94.44%' },
  { id: 'triple', label: '12 pays 3:1', title: 'The richer field: 97.22%' },
];

export const BET_NAME: Record<BetId, string> = {
  pass: 'Pass Line',
  dontPass: "Don't Pass",
  passOdds: 'Pass Odds',
  layOdds: 'Lay Odds',
  field: 'Field',
  any7: 'Any 7',
  anyCraps: 'Any Craps',
  yo: 'Yo 11',
  aceDeuce: 'Ace-Deuce',
  aces: 'Aces',
  twelve: 'Twelve',
};

/** Sums each one-roll bet wins on (for the table art and the info modal). */
export const ROLL_WINS: Record<RollId, number[]> = {
  field: [2, 3, 4, 9, 10, 11, 12],
  any7: [7],
  anyCraps: [2, 3, 12],
  yo: [11],
  aceDeuce: [3],
  aces: [2],
  twelve: [12],
};

/** Return per unit staked (stake included) of a one-roll bet when the dice sum to s. */
export function rollReturn(id: RollId, s: number, field: FieldPays): number {
  switch (id) {
    case 'field':
      if (s === 2) return 3;
      if (s === 12) return field === 'triple' ? 4 : 3;
      return s === 3 || s === 4 || s === 9 || s === 10 || s === 11 ? 2 : 0;
    case 'any7':
      return s === 7 ? 5 : 0;
    case 'anyCraps':
      return s === 2 || s === 3 || s === 12 ? 8 : 0;
    case 'yo':
      return s === 11 ? 16 : 0;
    case 'aceDeuce':
      return s === 3 ? 16 : 0;
    case 'aces':
      return s === 2 ? 31 : 0;
    case 'twelve':
      return s === 12 ? 31 : 0;
  }
}

/** "4:1"-style payout label of a one-roll bet. */
export function rollPaysLabel(id: RollId, field: FieldPays): string {
  if (id === 'field') return field === 'triple' ? '1:1 · 2:1 · 3:1' : '1:1 · 2:1';
  return { any7: '4:1', anyCraps: '7:1', yo: '15:1', aceDeuce: '15:1', aces: '30:1', twelve: '30:1' }[id];
}

/** Exact chance a one-roll bet wins. */
export const rollChance = (id: RollId) => ROLL_WINS[id].reduce((a, s) => a + WAYS[s], 0) / 36;

/** Exact RTP of a one-roll bet. */
export const rollRtp = (id: RollId, field: FieldPays) => SUMS.reduce((a, s) => a + WAYS[s] * rollReturn(id, s, field), 0) / 36;

/** Payout ("to one") of the odds behind each line when the point is p: Pass odds 6:w, lay odds w:6. */
export const passOddsPay = (p: Point) => 6 / WAYS[p];
export const layOddsPay = (p: Point) => WAYS[p] / 6;

/**
 * Return per unit of a line bet on roll s, or null if it is still undecided.
 * `point` is null on the come-out roll.
 */
export function lineReturn(id: LineId, point: Point | null, s: number): number | null {
  if (point === null) {
    if (id === 'pass') return s === 7 || s === 11 ? 2 : s === 2 || s === 3 || s === 12 ? 0 : null;
    return s === 2 || s === 3 ? 2 : s === 12 ? 1 : s === 7 || s === 11 ? 0 : null;
  }
  if (s === point) return id === 'pass' ? 2 : 0;
  if (s === 7) return id === 'pass' ? 0 : 2;
  return null;
}

/** Return per unit of an odds bet on roll s with point p, or null if undecided. */
export function oddsReturn(id: OddsId, p: Point, s: number): number | null {
  if (s === p) return id === 'passOdds' ? 1 + passOddsPay(p) : 0;
  if (s === 7) return id === 'layOdds' ? 1 + layOddsPay(p) : 0;
  return null;
}

/** Chance the point is made before a 7. */
export const pointChance = (p: Point) => WAYS[p] / (WAYS[p] + 6);

/** Exact chance the Pass line wins from here (come-out when point is null). */
export function passChance(point: Point | null): number {
  if (point !== null) return pointChance(point);
  return 8 / 36 + POINTS.reduce((a, p) => a + (WAYS[p] / 36) * pointChance(p), 0);
}

/** Exact chance Don't Pass wins from here (a bar-12 push is not a win). */
export function dontChance(point: Point | null): number {
  if (point !== null) return 1 - pointChance(point);
  return 3 / 36 + POINTS.reduce((a, p) => a + (WAYS[p] / 36) * (1 - pointChance(p)), 0);
}

/** Expected return per unit of a line or odds bet from the current state: the fair value of a working bet. */
export function workingValue(id: LineId | OddsId, point: Point | null): number {
  if (id === 'passOdds' || id === 'layOdds') return 1;
  if (id === 'pass') return 2 * passChance(point);
  return 2 * dontChance(point) + (point === null ? 1 / 36 : 0);
}

/** Exact RTP of a line bet (a fresh come-out). */
export const lineRtp = (id: LineId) => workingValue(id, null);

// ------------------------------------------------------------- odds limits

export type OddsLimit = '1x' | '2x' | '345x' | '5x' | '10x';
export const ODDS_LIMITS: { id: OddsLimit; label: string; title: string }[] = [
  { id: '1x', label: '1×', title: 'Odds up to 1× the line bet' },
  { id: '2x', label: '2×', title: 'Odds up to 2× the line bet' },
  { id: '345x', label: '3-4-5×', title: '3× on 4 and 10, 4× on 5 and 9, 5× on 6 and 8' },
  { id: '5x', label: '5×', title: 'Odds up to 5× the line bet' },
  { id: '10x', label: '10×', title: 'Odds up to 10× the line bet' },
];

/** The odds multiple a limit allows on point p. */
export function oddsMultiple(limit: OddsLimit, p: Point): number {
  if (limit === '345x') return p === 4 || p === 10 ? 3 : p === 5 || p === 9 ? 4 : 5;
  return { '1x': 1, '2x': 2, '5x': 5, '10x': 10 }[limit];
}

/**
 * The largest odds stake behind a line bet of `line` on point p. Pass odds
 * may stake the multiple; lay odds may stake whatever wins that multiple
 * (the usual rule: lay odds are capped by what they win).
 */
export function maxOdds(id: OddsId, line: number, limit: OddsLimit, p: Point): number {
  const m = oddsMultiple(limit, p) * line;
  return id === 'passOdds' ? m : m / layOddsPay(p);
}

// ------------------------------------------------------------- one round

export type Outcome = 'natural' | 'craps' | 'bar' | 'pointSet' | 'pointMade' | 'sevenOut' | 'roll';

/** What a roll does to the round. `decided` means the line bets are settled. */
export function advance(point: Point | null, s: number): { point: Point | null; outcome: Outcome; decided: boolean } {
  if (point === null) {
    if (s === 7 || s === 11) return { point: null, outcome: 'natural', decided: true };
    if (s === 12) return { point: null, outcome: 'bar', decided: true };
    if (s === 2 || s === 3) return { point: null, outcome: 'craps', decided: true };
    return { point: s as Point, outcome: 'pointSet', decided: false };
  }
  if (s === point) return { point: null, outcome: 'pointMade', decided: true };
  if (s === 7) return { point: null, outcome: 'sevenOut', decided: true };
  return { point, outcome: 'roll', decided: false };
}

/** A fixed way of playing one round (the eval's strategies and Auto). */
export interface Strategy {
  pass: number;
  dontPass: number;
  /** Odds taken (and laid) at the full limit once a point is set; null = no odds. */
  odds: OddsLimit | null;
  /** One-roll bets placed for the come-out. */
  props: Partial<Record<RollId, number>>;
  /** Keep the one-roll bets up for every roll of the point too. */
  propsStay: boolean;
  field: FieldPays;
}

const sumOf = (l: Partial<Record<string, number>>) => Object.values(l).reduce<number>((a, v) => a + (v ?? 0), 0);

/** Total return of the one-roll bets in `props` on sum s. */
export const propsReturn = (props: Partial<Record<RollId, number>>, s: number, field: FieldPays) =>
  ROLL_IDS.reduce((a, id) => a + (props[id] ?? 0) * rollReturn(id, s, field), 0);

/** Odds stakes a strategy adds on point p. */
export function strategyOdds(st: Strategy, p: Point) {
  if (!st.odds) return { passOdds: 0, layOdds: 0 };
  return { passOdds: maxOdds('passOdds', st.pass, st.odds, p), layOdds: maxOdds('layOdds', st.dontPass, st.odds, p) };
}

/**
 * Exact mean and second moment of the round multiplier returned / wagered.
 * Come-out sums are enumerated. After point p the round lasts N ≥ 1 more
 * rolls with P(N = n, ends on t) = q^(n−1)·WAYS[t]/36 (q = no decision); the
 * n − 1 rolls that miss carry i.i.d. one-roll returns with mean μ and
 * variance σ² (conditioned on missing), so E[X | n, t] and E[X² | n, t] are
 * closed form and the n-series is summed to double precision.
 */
export function roundMoments(st: Strategy): { mean: number; m2: number; sd: number } {
  const propStake = sumOf(st.props);
  const w0 = st.pass + st.dontPass + propStake;
  if (!(w0 > 0)) throw new RangeError('Empty strategy');
  let mean = 0;
  let m2 = 0;
  const hasLine = st.pass + st.dontPass > 0;
  for (const s of SUMS) {
    const ps = WAYS[s] / 36;
    const r0 = propsReturn(st.props, s, st.field);
    if (!hasLine || !isPoint(s)) {
      const line = hasLine ? st.pass * lineReturn('pass', null, s)! + st.dontPass * lineReturn('dontPass', null, s)! : 0;
      const x = (r0 + line) / w0;
      mean += ps * x;
      m2 += ps * x * x;
      continue;
    }
    const p = s;
    const odds = strategyOdds(st, p);
    const wBase = w0 + odds.passOdds + odds.layOdds;
    const perRoll = st.propsStay ? propStake : 0;
    const live = st.propsStay ? st.props : {};
    const q = 1 - (WAYS[p] + 6) / 36;
    // One-roll returns on a roll that misses (neither p nor 7).
    let mu = 0;
    let mu2 = 0;
    for (const r of SUMS) {
      if (r === p || r === 7) continue;
      const v = propsReturn(live, r, st.field);
      mu += (WAYS[r] / 36 / q) * v;
      mu2 += (WAYS[r] / 36 / q) * v * v;
    }
    const sigma2 = Math.max(0, mu2 - mu * mu);
    const ends = [
      { t: p, d: st.pass * 2 + odds.passOdds * (1 + passOddsPay(p)) },
      { t: 7, d: st.dontPass * 2 + odds.layOdds * (1 + layOddsPay(p)) },
    ].map((e) => ({ pt: WAYS[e.t] / 36, a: r0 + e.d + propsReturn(live, e.t, st.field) }));
    let qn = 1; // q^(n−1)
    for (let n = 1; qn > 1e-18; n++) {
      const den = wBase + n * perRoll;
      for (const { pt, a } of ends) {
        const num = a + (n - 1) * mu;
        const pr = ps * qn * pt;
        mean += (pr * num) / den;
        m2 += (pr * (num * num + (n - 1) * sigma2)) / (den * den);
      }
      qn *= q;
    }
  }
  return { mean, m2, sd: Math.sqrt(Math.max(0, m2 - mean * mean)) };
}

/**
 * Exact expected amount wagered and returned in one round, and their ratio:
 * the RTP the wallet sees (return per unit staked). Each bet's expected
 * return is its stake times its RTP; after point p the dice roll a geometric
 * number of times with mean 36 / (WAYS[p] + 6), and one-roll bets that stay
 * up are staked on each of those rolls.
 */
export function roundDollars(st: Strategy): { returned: number; wagered: number; rtp: number } {
  const propStake = sumOf(st.props);
  const propRet = ROLL_IDS.reduce((a, id) => a + (st.props[id] ?? 0) * rollRtp(id, st.field), 0);
  let wagered = st.pass + st.dontPass + propStake;
  let returned = st.pass * PASS_RTP + st.dontPass * DONT_RTP + propRet;
  if (st.pass + st.dontPass > 0) {
    for (const p of POINTS) {
      const pp = WAYS[p] / 36;
      const odds = strategyOdds(st, p);
      const rolls = 36 / (WAYS[p] + 6);
      wagered += pp * (odds.passOdds + odds.layOdds + (st.propsStay ? rolls * propStake : 0));
      returned += pp * (odds.passOdds + odds.layOdds + (st.propsStay ? rolls * propRet : 0));
    }
  }
  return { returned, wagered, rtp: returned / wagered };
}

/** Plays one round of a strategy with the given dice-sum source. */
export function playStrategy(st: Strategy, nextSum: () => number): { returned: number; wagered: number; rolls: number } {
  const propStake = sumOf(st.props);
  let wagered = st.pass + st.dontPass + propStake;
  let returned = 0;
  let point: Point | null = null;
  let rolls = 0;
  const hasLine = st.pass + st.dontPass > 0;
  let odds = { passOdds: 0, layOdds: 0 };
  for (;;) {
    const s = nextSum();
    rolls++;
    if (rolls === 1 || st.propsStay) returned += propsReturn(st.props, s, st.field);
    if (!hasLine) break;
    const next = advance(point, s);
    if (next.decided) {
      returned += st.pass * lineReturn('pass', point, s)! + st.dontPass * lineReturn('dontPass', point, s)!;
      if (point !== null) returned += odds.passOdds * oddsReturn('passOdds', point, s)! + odds.layOdds * oddsReturn('layOdds', point, s)!;
      break;
    }
    if (next.outcome === 'pointSet') {
      odds = strategyOdds(st, next.point!);
      wagered += odds.passOdds + odds.layOdds;
    }
    point = next.point;
    if (st.propsStay) wagered += propStake;
  }
  return { returned, wagered, rolls };
}

// ------------------------------------------------------------- the table in play

/** Expected return per unit of each bet (for the paytable). */
export function betRtp(id: BetId, field: FieldPays): number {
  if (id === 'pass' || id === 'dontPass') return lineRtp(id);
  if (id === 'passOdds' || id === 'layOdds') return 1;
  return rollRtp(id, field);
}

/** Exact chance each bet wins outright (Don't Pass: excluding the bar-12 push). */
export function betChance(id: BetId, point: Point | null): number {
  if (id === 'pass') return passChance(point);
  if (id === 'dontPass') return dontChance(point);
  if (id === 'passOdds') return point === null ? 0 : pointChance(point);
  if (id === 'layOdds') return point === null ? 0 : 1 - pointChance(point);
  return rollChance(id);
}

/** Expected value of the chips on the table for the next roll / the rest of the round, per bet. */
export function layoutValue(l: Layout, point: Point | null, field: FieldPays): number {
  let v = 0;
  for (const id of ALL_IDS) {
    const amt = l[id] ?? 0;
    if (!amt) continue;
    if (id === 'pass' || id === 'dontPass' || id === 'passOdds' || id === 'layOdds') v += amt * workingValue(id, point);
    else v += amt * rollRtp(id, field);
  }
  return v;
}

export const totalOf = (l: Layout) => sumOf(l);
export const cents = (x: number) => Math.round(x * 100) / 100;
export const floorCents = (x: number) => Math.floor(x * 100 + 1e-7) / 100;

/** A come-out layout as a strategy (Auto and the volatility hint). */
export function strategyOf(l: Layout, odds: OddsLimit | null, propsStay: boolean, field: FieldPays): Strategy {
  const props: Partial<Record<RollId, number>> = {};
  for (const id of ROLL_IDS) if (l[id]) props[id] = l[id];
  return { pass: l.pass ?? 0, dontPass: l.dontPass ?? 0, odds, props, propsStay, field };
}

export type Vol = 'low' | 'medium' | 'high' | 'extreme';
export const volatilityOf = (sd: number): Vol => (sd < 1.3 ? 'low' : sd < 2.2 ? 'medium' : sd < 3.8 ? 'high' : 'extreme');
