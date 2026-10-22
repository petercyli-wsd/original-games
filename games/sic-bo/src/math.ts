// Sic Bo (the three-dice table game from Macau, offered as an RNG table at
// Stake, BC.Game and others). Three fair dice are rolled: d1, d2, d3 each
// uniform on 1…6 and independent, so all 6³ = 216 ordered outcomes are
// equally likely. Every bet below is settled from those three faces only,
// so its exact return is (Σ over the 216 outcomes of its payout) / 216.
//
// Standard table (payouts "to one", the stake is returned on a win):
//
//   bet                       wins when                         count  pays  return (×216)   RTP
//   Small                     total 4–10, not a triple            105   1:1   2·105 = 210   97.222%
//   Big                       total 11–17, not a triple           105   1:1   210           97.222%
//   Odd / Even                total odd / even, not a triple      105   1:1   210           97.222%
//   Total 4 or 17             exact total                           3  60:1   61·3  = 183   84.722%
//   Total 5 or 16                                                   6  30:1   31·6  = 186   86.111%
//   Total 6 or 15                                                  10  17:1   18·10 = 180   83.333%
//   Total 7 or 14                                                  15  12:1   13·15 = 195   90.278%
//   Total 8 or 13                                                  21   8:1   9·21  = 189   87.500%
//   Total 9 or 12                                                  25   6:1   7·25  = 175   81.019%
//   Total 10 or 11                                                 27   6:1   7·27  = 189   87.500%
//   Single number n           n shows on 1 / 2 / 3 dice       75/15/1  1:1 / 2:1 / 3:1
//                                                     2·75 + 3·15 + 4·1 = 199                  92.130%
//   Combination a–b (a ≠ b)   both a and b show                    30   5:1   6·30  = 180   83.333%
//   Specific double n         n shows on at least two dice         16  10:1   11·16 = 176   81.481%
//   Specific triple n         all three show n                      1 180:1   181           83.796%
//   Any triple                all three dice equal                  6  30:1   31·6  = 186   86.111%
//
// Counts: totals by the number of compositions of t into three parts in 1…6
// (1, 3, 6, 10, 15, 21, 25, 27, 27, 25, …); Small has 108 totals in 4–10
// minus the triples 1-1-1, 2-2-2, 3-3-3 → 105, and Odd has 108 minus the odd
// triples 1-1-1, 3-3-3, 5-5-5 → 105. A single number shows exactly k times
// in C(3,k)·5^(3−k) outcomes; a combination by inclusion–exclusion is
// 216 − 125 − 125 + 64 = 30; a double is 3·5 + 1 = 16.
//
// A layout is a sum of independent bets on the same roll, so by linearity
// its expected return is the stake-weighted average of its bets' RTPs:
// RTP(layout) = Σ sᵢ·RTPᵢ / Σ sᵢ. The tests enumerate all 216 rolls for every
// bet and for random layouts and check these fractions exactly.
//
// The main bet (manifest.rtp) is Big / Small: 210 / 216 = 35 / 36 = 97.2222…%.
//
// Max payout: per unit of total stake, a layout pays a stake-weighted average
// of the returns of the bets that hit, which can never exceed the largest
// single return, a specific triple at 181×. MAX_MULTIPLIER = 181.

export type Dice = [number, number, number];

export type BetKind = 'small' | 'big' | 'odd' | 'even' | 'total' | 'single' | 'combo' | 'double' | 'triple' | 'anyTriple';

export interface BetDef {
  id: string;
  kind: BetKind;
  /** Short name, e.g. "Small", "Total 9", "Double 4", "1 · 2". */
  name: string;
  /** Payout "to one" for a plain win (single number: the 1-die rate). */
  pays: number;
  /** Faces the bet is about (number, pair, total). */
  a?: number;
  b?: number;
}

/** Totals pay (to one), symmetric around 10.5. */
export const TOTAL_PAYS: Record<number, number> = { 4: 60, 5: 30, 6: 17, 7: 12, 8: 8, 9: 6, 10: 6, 11: 6, 12: 6, 13: 8, 14: 12, 15: 17, 16: 30, 17: 60 };
export const SINGLE_PAYS = [0, 1, 2, 3] as const; // by number of matching dice
export const COMBO_PAYS = 5;
export const DOUBLE_PAYS = 10;
export const TRIPLE_PAYS = 180;
export const ANY_TRIPLE_PAYS = 30;

export const MAX_MULTIPLIER = TRIPLE_PAYS + 1;

const FACES = [1, 2, 3, 4, 5, 6] as const;

function buildBets(): BetDef[] {
  const out: BetDef[] = [
    { id: 'small', kind: 'small', name: 'Small', pays: 1 },
    { id: 'odd', kind: 'odd', name: 'Odd', pays: 1 },
    { id: 'anyTriple', kind: 'anyTriple', name: 'Any triple', pays: ANY_TRIPLE_PAYS },
    { id: 'even', kind: 'even', name: 'Even', pays: 1 },
    { id: 'big', kind: 'big', name: 'Big', pays: 1 },
  ];
  for (const n of FACES) out.push({ id: `double-${n}`, kind: 'double', name: `Double ${n}`, pays: DOUBLE_PAYS, a: n });
  for (const n of FACES) out.push({ id: `triple-${n}`, kind: 'triple', name: `Triple ${n}`, pays: TRIPLE_PAYS, a: n });
  for (let t = 4; t <= 17; t++) out.push({ id: `total-${t}`, kind: 'total', name: `Total ${t}`, pays: TOTAL_PAYS[t], a: t });
  for (let a = 1; a <= 6; a++) for (let b = a + 1; b <= 6; b++) out.push({ id: `combo-${a}-${b}`, kind: 'combo', name: `${a} · ${b}`, pays: COMBO_PAYS, a, b });
  for (const n of FACES) out.push({ id: `single-${n}`, kind: 'single', name: `Single ${n}`, pays: 1, a: n });
  return out;
}

export const BETS: BetDef[] = buildBets();
export const BET_BY_ID: Record<string, BetDef> = Object.fromEntries(BETS.map((b) => [b.id, b]));

export const isTriple = (d: Dice) => d[0] === d[1] && d[1] === d[2];
export const sumOf = (d: Dice) => d[0] + d[1] + d[2];
const countOf = (d: Dice, n: number) => (d[0] === n ? 1 : 0) + (d[1] === n ? 1 : 0) + (d[2] === n ? 1 : 0);

/** What one unit staked on `bet` returns on roll `d` (stake included; 0 = lost). */
export function returnOf(bet: BetDef, d: Dice): number {
  const s = sumOf(d);
  const triple = isTriple(d);
  switch (bet.kind) {
    case 'small':
      return !triple && s >= 4 && s <= 10 ? 2 : 0;
    case 'big':
      return !triple && s >= 11 && s <= 17 ? 2 : 0;
    case 'odd':
      return !triple && s % 2 === 1 ? 2 : 0;
    case 'even':
      return !triple && s % 2 === 0 ? 2 : 0;
    case 'total':
      return s === bet.a ? TOTAL_PAYS[s] + 1 : 0;
    case 'single': {
      const k = countOf(d, bet.a!);
      return k > 0 ? SINGLE_PAYS[k] + 1 : 0;
    }
    case 'combo':
      return countOf(d, bet.a!) > 0 && countOf(d, bet.b!) > 0 ? COMBO_PAYS + 1 : 0;
    case 'double':
      return countOf(d, bet.a!) >= 2 ? DOUBLE_PAYS + 1 : 0;
    case 'triple':
      return countOf(d, bet.a!) === 3 ? TRIPLE_PAYS + 1 : 0;
    case 'anyTriple':
      return triple ? ANY_TRIPLE_PAYS + 1 : 0;
  }
}

/** All 216 ordered rolls. */
export const ALL_ROLLS: Dice[] = (() => {
  const out: Dice[] = [];
  for (const a of FACES) for (const b of FACES) for (const c of FACES) out.push([a, b, c]);
  return out;
})();

interface BetStats {
  /** Outcomes (of 216) where the bet returns anything. */
  wins: number;
  /** Σ returns over the 216 outcomes; RTP = sum / 216. */
  sum: number;
  rtp: number;
  chance: number;
}

const statsCache = new Map<string, BetStats>();
/** Exact stats of one bet, by enumeration of the 216 rolls. */
export function betStats(id: string): BetStats {
  let s = statsCache.get(id);
  if (s) return s;
  const bet = BET_BY_ID[id];
  let wins = 0;
  let sum = 0;
  for (const d of ALL_ROLLS) {
    const r = returnOf(bet, d);
    if (r > 0) wins++;
    sum += r;
  }
  s = { wins, sum, rtp: sum / 216, chance: wins / 216 };
  statsCache.set(id, s);
  return s;
}

/** Big / Small: 210 / 216 = 35 / 36. */
export const RTP = betStats('big').rtp;

/** Bet id → stake. Absent or 0 means no chip. */
export type Layout = Record<string, number>;

const cents = (x: number) => Math.round(x * 100) / 100;

export const totalOf = (l: Layout) => cents(Object.values(l).reduce((a, b) => a + (b > 0 ? b : 0), 0));
export const placedIds = (l: Layout) => BETS.filter((b) => (l[b.id] ?? 0) > 0).map((b) => b.id);

/** Settles a layout on a roll: the amount paid, the multiplier on the total and which bets won. */
export function settle(l: Layout, d: Dice) {
  const total = totalOf(l);
  let paid = 0;
  const winners: string[] = [];
  for (const id of placedIds(l)) {
    const r = returnOf(BET_BY_ID[id], d);
    if (r > 0) {
      winners.push(id);
      paid += l[id] * r;
    }
  }
  paid = cents(paid);
  return { paid, winners, multiplier: total > 0 ? paid / total : 0 };
}

/** Exact stats of a whole layout by enumerating the 216 rolls. */
export function layoutStats(l: Layout) {
  const total = totalOf(l);
  const ids = placedIds(l);
  if (!(total > 0)) return { pHit: 0, pProfit: 0, rtp: 0, sd: 0, maxMult: 0 };
  let hit = 0;
  let profit = 0;
  let m1 = 0;
  let m2 = 0;
  let max = 0;
  for (const d of ALL_ROLLS) {
    let paid = 0;
    for (const id of ids) paid += l[id] * returnOf(BET_BY_ID[id], d);
    const m = paid / total;
    if (m > 0) hit++;
    if (m > 1 + 1e-12) profit++;
    m1 += m;
    m2 += m * m;
    if (m > max) max = m;
  }
  const mean = m1 / 216;
  return { pHit: hit / 216, pProfit: profit / 216, rtp: mean, sd: Math.sqrt(Math.max(0, m2 / 216 - mean * mean)), maxMult: max };
}

/** Exact RTP of a layout: Σ sᵢ·RTPᵢ / Σ sᵢ. */
export function layoutRtp(l: Layout): number {
  const total = Object.values(l).reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (!(total > 0)) return 0;
  let s = 0;
  for (const id of placedIds(l)) s += l[id] * betStats(id).rtp;
  return s / total;
}

export type Vol = 'low' | 'medium' | 'high' | 'extreme';
export const volatilityOf = (sd: number): Vol => (sd < 1.5 ? 'low' : sd < 3.5 ? 'medium' : sd < 8 ? 'high' : 'extreme');

/**
 * Scales a layout so its total is `target` (to the cent), keeping its
 * proportions; rounding error goes on the largest bet so the total is exact.
 * Auto-bet uses it for its on-win / on-loss stake changes.
 */
export function scaleLayout(base: Layout, target: number): Layout {
  const total = totalOf(base);
  if (!(total > 0) || !(target > 0)) return { ...base };
  const f = target / total;
  const out: Layout = {};
  for (const id of placedIds(base)) out[id] = Math.max(0.01, cents(base[id] * f));
  const diff = cents(cents(target) - totalOf(out));
  if (diff !== 0) {
    const ids = placedIds(out);
    const big = ids.reduce((a, b) => (out[b] > out[a] ? b : a));
    out[big] = Math.max(0.01, cents(out[big] + diff));
  }
  return out;
}

/** One die from a uniform u in [0, 1). */
export const dieOf = (u: number) => Math.min(6, Math.floor(u * 6) + 1);

/** Rolls three dice from three uniforms. */
export const rollDice = (u1: number, u2: number, u3: number): Dice => [dieOf(u1), dieOf(u2), dieOf(u3)];

/** Fraction for display, e.g. "25 / 216". */
export const outcomesLabel = (id: string) => `${betStats(id).wins} / 216`;

/** "1:1", "60:1", single number "1:1 · 2:1 · 3:1". */
export const paysLabel = (b: BetDef) => (b.kind === 'single' ? '1–3:1' : `${b.pays}:1`);
