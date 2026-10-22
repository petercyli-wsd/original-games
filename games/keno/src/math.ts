// Keno (Stake, BC.Game, Shuffle, Rainbet…): the board holds the numbers
// 1–40. The player picks n of them (1 ≤ n ≤ 10), then 10 distinct numbers are
// drawn uniformly at random. The number of hits k (picks that were drawn)
// follows the hypergeometric distribution:
//
//   P(k hits | n picks) = C(n, k) · C(40 − n, 10 − k) / C(40, 10),
//
// with C(40, 10) = 847,660,528 equally likely draws. Which numbers are picked
// is irrelevant by symmetry: only the count n matters.
//
// Each risk level (Classic, Low, Medium, High) has one paytable per picks
// count, giving a multiplier for every hit count. The tables are stored in
// integer hundredths (cents of a multiplier) and every one of the 40 tables
// satisfies, in exact integer arithmetic,
//
//   Σ_k  C(n, k) · C(40 − n, 10 − k) · cents(k)  =  99 · C(40, 10),
//
// i.e. RTP = Σ_k P(k) · multiplier(k) = 0.99 exactly, for every risk and every
// picks count. (The shapes follow the familiar crypto-casino keno tables; the
// entries were then solved to the cent so each table lands on exactly 99%.)
// The player's choices of risk and picks therefore only move the volatility.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const BOARD = 40;
export const DRAWS = 10;
export const MAX_PICKS = 10;

export type Risk = 'classic' | 'low' | 'medium' | 'high';
export const RISKS: Risk[] = ['classic', 'low', 'medium', 'high'];
export const RISK_LABEL: Record<Risk, string> = { classic: 'Classic', low: 'Low', medium: 'Medium', high: 'High' };
export const RISK_VOL: Record<Risk, Volatility> = { low: 'low', classic: 'medium', medium: 'high', high: 'extreme' };

/** PAYTABLE[risk][picks − 1][hits] = multiplier in hundredths. */
export const PAYTABLE: Record<Risk, readonly (readonly number[])[]> = {
  classic: [
    [0, 396],
    [0, 189, 456],
    [0, 99, 313, 1041],
    [0, 81, 178, 502, 2226],
    [0, 24, 140, 414, 1660, 3646],
    [0, 0, 100, 368, 700, 1667, 4000],
    [0, 0, 48, 298, 450, 1405, 3095, 5934],
    [0, 0, 0, 220, 400, 1300, 2180, 5520, 6987],
    [0, 0, 0, 155, 301, 796, 1504, 4420, 5990, 8520],
    [0, 0, 0, 139, 225, 456, 800, 1695, 4980, 7975, 10050],
  ],
  low: [
    [70, 186],
    [0, 201, 376],
    [0, 110, 138, 2611],
    [0, 0, 220, 789, 9051],
    [0, 0, 150, 421, 1300, 30046],
    [0, 0, 110, 200, 621, 9992, 69700],
    [0, 0, 110, 160, 351, 1497, 22600, 69900],
    [0, 0, 110, 150, 200, 550, 3900, 9910, 80057],
    [0, 0, 110, 130, 170, 247, 751, 5020, 24990, 100500],
    [0, 0, 111, 120, 129, 181, 355, 1300, 5015, 24970, 101100],
  ],
  medium: [
    [40, 276],
    [0, 180, 516],
    [0, 0, 280, 5001],
    [0, 0, 170, 1011, 9906],
    [0, 0, 140, 400, 1400, 39146],
    [0, 0, 0, 300, 898, 18100, 71292],
    [0, 0, 0, 200, 700, 3002, 40100, 78860],
    [0, 0, 0, 200, 400, 1105, 6720, 39700, 90227],
    [0, 0, 0, 200, 250, 502, 1505, 9960, 49900, 100200],
    [0, 0, 0, 160, 200, 401, 698, 2595, 9990, 50010, 99810],
  ],
  high: [
    [0, 396],
    [0, 0, 1716],
    [0, 0, 0, 8151],
    [0, 0, 0, 1000, 25941],
    [0, 0, 0, 449, 4820, 44996],
    [0, 0, 0, 0, 1100, 35000, 71022],
    [0, 0, 0, 0, 700, 9002, 40100, 78860],
    [0, 0, 0, 0, 500, 1995, 27100, 59800, 89987],
    [0, 0, 0, 0, 400, 1100, 5610, 50010, 80500, 99612],
    [0, 0, 0, 0, 350, 801, 1290, 6330, 50000, 79890, 101160],
  ],
};

/** Binomial coefficient, exact for the small arguments used here. */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/** Number of equally likely draws: C(40, 10) = 847,660,528. */
export const TOTAL_DRAWS = choose(BOARD, DRAWS);

/** How many of the C(40,10) draws give exactly `hits` hits with `picks` picks. */
export const drawsWithHits = (picks: number, hits: number) => choose(picks, hits) * choose(BOARD - picks, DRAWS - hits);

/** P(hits | picks), hypergeometric. */
export const hitChance = (picks: number, hits: number) => drawsWithHits(picks, hits) / TOTAL_DRAWS;

/** Payout multiplier for a result. */
export const payout = (risk: Risk, picks: number, hits: number) => (picks >= 1 ? (PAYTABLE[risk][picks - 1][hits] ?? 0) / 100 : 0);

export interface PayRow {
  hits: number;
  multiplier: number;
  chance: number;
}

const rowsCache = new Map<string, PayRow[]>();
/** The table under the board: payout and exact chance for each hit count 0…picks. */
export function payRows(risk: Risk, picks: number): PayRow[] {
  const key = `${risk}:${picks}`;
  let rows = rowsCache.get(key);
  if (!rows) {
    rows = [];
    for (let k = 0; k <= picks; k++) rows.push({ hits: k, multiplier: payout(risk, picks, k), chance: hitChance(picks, k) });
    rowsCache.set(key, rows);
  }
  return rows;
}

/** Exact RTP of one table as a fraction num / den (integers, no rounding). */
export function tableRtpFraction(risk: Risk, picks: number): { num: bigint; den: bigint } {
  let num = 0n;
  PAYTABLE[risk][picks - 1].forEach((cents, k) => {
    num += BigInt(cents) * BigInt(drawsWithHits(picks, k));
  });
  return { num, den: 100n * BigInt(TOTAL_DRAWS) };
}

export const tableRtp = (risk: Risk, picks: number) => payRows(risk, picks).reduce((a, r) => a + r.chance * r.multiplier, 0);

/** Chance that a round returns more than the stake. */
export const profitChance = (risk: Risk, picks: number) => payRows(risk, picks).reduce((a, r) => a + (r.multiplier > 1 ? r.chance : 0), 0);

/** Standard deviation of the payout multiplier. */
export function stdDev(risk: Risk, picks: number): number {
  const rows = payRows(risk, picks);
  const m2 = rows.reduce((a, r) => a + r.chance * r.multiplier ** 2, 0);
  return Math.sqrt(Math.max(0, m2 - tableRtp(risk, picks) ** 2));
}

export const topPayout = (risk: Risk, picks: number) => payout(risk, picks, picks);

export const MAX_MULTIPLIER = Math.max(...RISKS.flatMap((r) => PAYTABLE[r].flat())) / 100;

/** 10 distinct numbers from 1…40, in draw order (partial Fisher–Yates). */
export function drawNumbers(rng: Rng): number[] {
  const pool = Array.from({ length: BOARD }, (_, i) => i + 1);
  for (let i = 0; i < DRAWS; i++) {
    const j = i + rng.int(BOARD - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, DRAWS);
}

/** `count` distinct random numbers from 1…40 (the Auto pick button). */
export function randomPicks(rng: Rng, count: number): number[] {
  const pool = Array.from({ length: BOARD }, (_, i) => i + 1);
  const n = Math.min(MAX_PICKS, Math.max(1, count));
  for (let i = 0; i < n; i++) {
    const j = i + rng.int(BOARD - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).sort((a, b) => a - b);
}

export const countHits = (picks: readonly number[], drawn: readonly number[]) => drawn.filter((d) => picks.includes(d)).length;

export interface KenoRound {
  picks: number[];
  drawn: number[];
  hits: number;
  multiplier: number;
}

/**
 * One complete round, as Manual and Auto both play it. With `repick`, the
 * round first replaces the picks with `repick` fresh random numbers (Auto's
 * "new numbers every bet"). The draw is decided here, before any animation.
 */
export function playKeno(rng: Rng, risk: Risk, picks: readonly number[], repick = 0): KenoRound {
  const chosen = repick > 0 ? randomPicks(rng, repick) : [...picks];
  const drawn = drawNumbers(rng);
  const hits = countHits(chosen, drawn);
  return { picks: chosen, drawn, hits, multiplier: payout(risk, chosen.length, hits) };
}
