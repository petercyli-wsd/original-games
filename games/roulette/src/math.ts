// Roulette (Stake, Shuffle, Roobet…): European single-zero roulette.
//
// One pocket of 37 (0–36) is drawn uniformly. Every bet on the table covers a
// set of k numbers and pays 36/k for 1 including the stake (the familiar
// "35 to 1" straight, "17 to 1" split, "11 to 1" street / trio, "8 to 1"
// corner / first four, "5 to 1" six line, "2 to 1" column / dozen and "1 to 1"
// even-money bets). Its expected return is therefore exactly
//
//     (k / 37) × (36 / k) = 36 / 37 = 97.297…%   for every bet,
//
// and by linearity of expectation every mix of chips returns 36/37 too: the
// layout only changes the volatility. The single green zero is the whole
// house edge (1/37 = 2.70%). Announced (racetrack) bets are bundles of ordinary
// table bets, so they inherit the same RTP. No payout multiplier can exceed
// 36: a pocket pays Σ a_s·36/k_s ≤ 36·Σ a_s.

export const RTP = 36 / 37;
export const POCKETS = 37;
export const MAX_MULTIPLIER = 36;

/** The single-zero wheel, clockwise from zero. */
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;

export const WHEEL_INDEX: number[] = (() => {
  const idx = new Array<number>(POCKETS);
  WHEEL_ORDER.forEach((n, i) => (idx[n] = i));
  return idx;
})();

const RED_SET = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export type Colour = 'red' | 'black' | 'green';
export const colourOf = (n: number): Colour => (n === 0 ? 'green' : RED_SET.has(n) ? 'red' : 'black');

export type SpotKind =
  | 'straight'
  | 'split'
  | 'street'
  | 'trio'
  | 'corner'
  | 'basket'
  | 'line'
  | 'column'
  | 'dozen'
  | 'red'
  | 'black'
  | 'odd'
  | 'even'
  | 'low'
  | 'high';

export interface Spot {
  id: string;
  kind: SpotKind;
  /** Numbers covered, ascending. */
  nums: number[];
  /** Payout multiplier including the stake: 36 / nums.length. */
  pays: number;
  /** Human name, e.g. "Split 17/20". */
  name: string;
}

export const KIND_NAMES: Record<SpotKind, string> = {
  straight: 'Straight',
  split: 'Split',
  street: 'Street',
  trio: 'Trio',
  corner: 'Corner',
  basket: 'First four',
  line: 'Six line',
  column: 'Column',
  dozen: 'Dozen',
  red: 'Red',
  black: 'Black',
  odd: 'Odd',
  even: 'Even',
  low: '1 to 18',
  high: '19 to 36',
};

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Canonical id of an inside bet: kind plus its numbers. */
export const insideId = (kind: SpotKind, nums: number[]) => `${kind}:${[...nums].sort((a, b) => a - b).join('-')}`;

function mk(kind: SpotKind, nums: number[], id?: string, name?: string): Spot {
  const sorted = [...nums].sort((a, b) => a - b);
  return {
    id: id ?? insideId(kind, sorted),
    kind,
    nums: sorted,
    pays: 36 / sorted.length,
    name: name ?? `${KIND_NAMES[kind]} ${sorted.join('/')}`,
  };
}

/** Every bet position on the table (157 of them). */
export const SPOTS: Spot[] = (() => {
  const s: Spot[] = [];
  for (let n = 0; n <= 36; n++) s.push(mk('straight', [n], undefined, `Straight ${n}`));
  for (const n of [1, 2, 3]) s.push(mk('split', [0, n]));
  for (let n = 1; n <= 36; n++) {
    if (n % 3 !== 0) s.push(mk('split', [n, n + 1]));
    if (n <= 33) s.push(mk('split', [n, n + 3]));
  }
  for (let c = 0; c < 12; c++) s.push(mk('street', range(3 * c + 1, 3 * c + 3), undefined, `Street ${3 * c + 1}–${3 * c + 3}`));
  s.push(mk('trio', [0, 1, 2]), mk('trio', [0, 2, 3]));
  for (let n = 1; n <= 32; n++) if (n % 3 !== 0) s.push(mk('corner', [n, n + 1, n + 3, n + 4]));
  s.push(mk('basket', [0, 1, 2, 3], undefined, 'First four 0–3'));
  for (let c = 0; c < 11; c++) s.push(mk('line', range(3 * c + 1, 3 * c + 6), undefined, `Six line ${3 * c + 1}–${3 * c + 6}`));
  for (const k of [1, 2, 3]) s.push(mk('column', range(1, 36).filter((n) => n % 3 === k % 3), `column:${k}`, `Column ${k}`));
  for (const d of [1, 2, 3]) s.push(mk('dozen', range(12 * d - 11, 12 * d), `dozen:${d}`, `Dozen ${12 * d - 11}–${12 * d}`));
  s.push(mk('low', range(1, 18), 'low', '1 to 18'));
  s.push(mk('even', range(1, 36).filter((n) => n % 2 === 0), 'even', 'Even'));
  s.push(mk('red', range(1, 36).filter((n) => colourOf(n) === 'red'), 'red', 'Red'));
  s.push(mk('black', range(1, 36).filter((n) => colourOf(n) === 'black'), 'black', 'Black'));
  s.push(mk('odd', range(1, 36).filter((n) => n % 2 === 1), 'odd', 'Odd'));
  s.push(mk('high', range(19, 36), 'high', '19 to 36'));
  return s;
})();

export const SPOT_BY_ID: Record<string, Spot> = Object.fromEntries(SPOTS.map((s) => [s.id, s]));

/** The payout table as players know it: "x to 1" per bet kind. */
export const PAYTABLE: { kind: SpotKind; covers: number; toOne: number }[] = (
  [
    ['straight', 1],
    ['split', 2],
    ['street', 3],
    ['trio', 3],
    ['corner', 4],
    ['basket', 4],
    ['line', 6],
    ['column', 12],
    ['dozen', 12],
    ['red', 18],
  ] as [SpotKind, number][]
).map(([kind, covers]) => ({ kind, covers, toOne: 36 / covers - 1 }));

// ---------- Layouts ----------

/** Chips on the table: spot id → amount. */
export type Layout = Record<string, number>;

export const cents = (x: number) => Math.round(x * 100) / 100;

export const totalOf = (layout: Layout) => Object.values(layout).reduce((a, b) => a + b, 0);

export const spotsOf = (layout: Layout) => Object.keys(layout).filter((k) => layout[k] > 0 && SPOT_BY_ID[k]);

/** Amount paid (stake included) by a layout when `pocket` comes up. */
export function payoutFor(layout: Layout, pocket: number): number {
  let paid = 0;
  for (const id of spotsOf(layout)) {
    const s = SPOT_BY_ID[id];
    if (s.nums.includes(pocket)) paid += layout[id] * s.pays;
  }
  return paid;
}

/** The pocket drawn from one uniform: every number 0–36 has chance 1/37. */
export const pocketOf = (u: number) => Math.min(POCKETS - 1, Math.max(0, Math.floor(u * POCKETS)));

export interface SpinResult {
  pocket: number;
  paid: number;
  multiplier: number;
  winners: string[];
}

export function spin(layout: Layout, u: number): SpinResult {
  const pocket = pocketOf(u);
  const total = totalOf(layout);
  const paid = payoutFor(layout, pocket);
  const winners = spotsOf(layout).filter((id) => SPOT_BY_ID[id].nums.includes(pocket));
  return { pocket, paid, multiplier: total > 0 ? paid / total : 0, winners };
}

export interface LayoutStats {
  total: number;
  /** Distinct numbers covered by at least one chip. */
  covered: number;
  /** P(any payout). */
  pHit: number;
  /** P(payout above the total stake). */
  pProfit: number;
  /** Exact expected multiplier (always RTP for a non-empty layout). */
  rtp: number;
  /** Std-dev of the multiplier. */
  sd: number;
  /** Largest multiplier any pocket pays. */
  maxMult: number;
}

/** Exact stats by enumerating the 37 pockets. */
export function layoutStats(layout: Layout): LayoutStats {
  const total = totalOf(layout);
  if (!(total > 0)) return { total: 0, covered: 0, pHit: 0, pProfit: 0, rtp: 0, sd: 0, maxMult: 0 };
  let hit = 0;
  let profit = 0;
  let m1 = 0;
  let m2 = 0;
  let maxMult = 0;
  for (let p = 0; p < POCKETS; p++) {
    const m = payoutFor(layout, p) / total;
    if (m > 0) hit++;
    if (m > 1 + 1e-12) profit++;
    m1 += m;
    m2 += m * m;
    maxMult = Math.max(maxMult, m);
  }
  m1 /= POCKETS;
  m2 /= POCKETS;
  return { total, covered: hit, pHit: hit / POCKETS, pProfit: profit / POCKETS, rtp: m1, sd: Math.sqrt(Math.max(0, m2 - m1 * m1)), maxMult };
}

export type Volatility = 'low' | 'medium' | 'high' | 'extreme';

/** Even money ≈ 1.0, dozen 1.4, six line 2.2, street 3.3, split 4.1, straight 5.8. */
export function volatilityOf(sd: number): Volatility {
  if (sd < 1.2) return 'low';
  if (sd < 2.5) return 'medium';
  if (sd < 4.5) return 'high';
  return 'extreme';
}

/** Adds `amount` to one spot. */
export function addTo(layout: Layout, id: string, amount: number): Layout {
  return { ...layout, [id]: cents((layout[id] ?? 0) + amount) };
}

/** Takes up to `amount` off one spot (removing it at zero). */
export function takeFrom(layout: Layout, id: string, amount: number): Layout {
  const cur = layout[id] ?? 0;
  const next = { ...layout };
  const left = cents(cur - amount);
  if (left > 0) next[id] = left;
  else delete next[id];
  return next;
}

/** Scales every chip so the total hits `target` to the cent, keeping the proportions. */
export function scaleLayout(base: Layout, target: number): Layout {
  const ids = spotsOf(base);
  const total = totalOf(base);
  if (!(total > 0) || !(target > 0)) return { ...base };
  const f = target / total;
  const out: Layout = {};
  for (const id of ids) out[id] = Math.max(0.01, cents(base[id] * f));
  const diff = cents(cents(target) - totalOf(out));
  if (diff !== 0) {
    const big = ids.reduce((a, b) => (out[b] > out[a] ? b : a));
    out[big] = Math.max(0.01, cents(out[big] + diff));
  }
  return out;
}

// ---------- Announced bets (the racetrack) ----------

export type CallBet = 'voisins' | 'tiers' | 'orphelins' | 'zero';

export const CALL_BETS: Record<CallBet, { name: string; sub: string; chips: [string, number][] }> = {
  voisins: {
    name: 'Voisins',
    sub: 'Neighbours of zero',
    chips: [
      [insideId('trio', [0, 2, 3]), 2],
      [insideId('split', [4, 7]), 1],
      [insideId('split', [12, 15]), 1],
      [insideId('split', [18, 21]), 1],
      [insideId('split', [19, 22]), 1],
      [insideId('split', [32, 35]), 1],
      [insideId('corner', [25, 26, 28, 29]), 2],
    ],
  },
  tiers: {
    name: 'Tiers',
    sub: 'Third of the wheel',
    chips: [
      [insideId('split', [5, 8]), 1],
      [insideId('split', [10, 11]), 1],
      [insideId('split', [13, 16]), 1],
      [insideId('split', [23, 24]), 1],
      [insideId('split', [27, 30]), 1],
      [insideId('split', [33, 36]), 1],
    ],
  },
  orphelins: {
    name: 'Orphelins',
    sub: 'The orphans',
    chips: [
      [insideId('straight', [1]), 1],
      [insideId('split', [6, 9]), 1],
      [insideId('split', [14, 17]), 1],
      [insideId('split', [17, 20]), 1],
      [insideId('split', [31, 34]), 1],
    ],
  },
  zero: {
    name: 'Zero game',
    sub: 'Zero spiel',
    chips: [
      [insideId('split', [0, 3]), 1],
      [insideId('split', [12, 15]), 1],
      [insideId('straight', [26]), 1],
      [insideId('split', [32, 35]), 1],
    ],
  },
};

export const CALL_KEYS = Object.keys(CALL_BETS) as CallBet[];

export const callChipCount = (c: CallBet) => CALL_BETS[c].chips.reduce((a, [, k]) => a + k, 0);

/** Numbers an announced bet covers. */
export function callNumbers(c: CallBet): number[] {
  const set = new Set<number>();
  for (const [id] of CALL_BETS[c].chips) for (const n of SPOT_BY_ID[id].nums) set.add(n);
  return [...set].sort((a, b) => a - b);
}

/** Adds an announced bet at `unit` per chip. */
export function addCall(layout: Layout, c: CallBet, unit: number): Layout {
  let next = layout;
  for (const [id, k] of CALL_BETS[c].chips) next = addTo(next, id, unit * k);
  return next;
}

/** The pocket `n` and its `k` neighbours on each side of the wheel. */
export function neighbours(n: number, k: number): number[] {
  const i = WHEEL_INDEX[n];
  const out: number[] = [];
  for (let d = -k; d <= k; d++) out.push(WHEEL_ORDER[(i + d + POCKETS) % POCKETS]);
  return out;
}

/** A neighbours bet: one straight-up chip on n and k pockets either side of it. */
export function addNeighbours(layout: Layout, n: number, k: number, unit: number): Layout {
  let next = layout;
  for (const m of neighbours(n, k)) next = addTo(next, insideId('straight', [m]), unit);
  return next;
}

/** Plain-language description of a pocket: "17 · Black · Odd · Low". */
export function describe(n: number): string {
  if (n === 0) return '0 · Green';
  const c = colourOf(n);
  return `${n} · ${c === 'red' ? 'Red' : 'Black'} · ${n % 2 ? 'Odd' : 'Even'} · ${n <= 18 ? 'Low' : 'High'}`;
}
