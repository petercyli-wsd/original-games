// Prime Time: a hidden whole number N is drawn uniformly from the d-digit
// numbers 10^(d−1) … 10^d − 1 (d = 2…5). You back a property of N (Prime,
// Not prime or Perfect square), then its digits are revealed one at a time,
// in whatever order you choose.
//
// The candidates still consistent with the digits shown form a product set:
// every hidden position can be any of its 10 values (9 for the leading digit,
// which is never 0). The live chance is a literal count,
//
//   P(win | S) = #{winning candidates} / #{candidates},
//
// drawn on the board as the lit share of a dot grid of the candidates. The
// counts are exact: a sieve of Eratosthenes marks the primes below 10^5, and
// one wildcard-sum pass over the digit lattice counts the winners for every
// pattern of shown and hidden digits (11^d patterns, at most 146,410), built
// once per setting and cached.
//
// The prime number theorem puts the density of primes near x at about 1/ln x,
// so the share falls slowly with d: 21/90, 143/900, 1061/9000, 8363/90000
// (differences of π(10^d) = 4, 25, 168, 1229, 9592). Squares thin out much
// faster: ⌊√(10^d − 1)⌋ − ⌈√10^(d−1)⌉ + 1 of the 9·10^(d−1) numbers.
//
// Pricing (fixed prize). A win pays prize = RTP / P(win), fixed when you bet,
// and the cash-out in any state S is prize × P(win | S). Revealing a hidden
// position cuts the candidates into equal slices, one per value it can take
// (the set is a product), so every value is equally likely and the chance
// after the reveal averages exactly to the chance before (law of total
// probability). The cash-out is therefore a martingale that starts at RTP,
// whichever digit the player picks: the choice changes how far the odds can
// jump (volatility), never the value. By optional stopping every cash-out rule
// returns exactly RTP. A reveal that leaves no winning candidate ends the
// round lost; one that leaves only winners pays the prize at once. Both are
// stopping rules, so RTP is unchanged. No payout can exceed the prize, so
// maxMultiplier is the largest prize over all settings.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** How many digits the hidden number has. */
export const DIGITS = [2, 3, 4, 5] as const;
export type Digits = (typeof DIGITS)[number];

/** What you can back, from safest to wildest. `composite` is "Not prime" (every N ≥ 10 that isn't prime is composite). */
export const BETS = ['composite', 'prime', 'square'] as const;
export type Bet = (typeof BETS)[number];

export const BET_LABEL: Record<Bet, string> = { composite: 'Not prime', prime: 'Prime', square: 'Square' };
/** Completes "N is …". */
export const BET_PHRASE: Record<Bet, string> = { composite: 'not prime', prime: 'prime', square: 'a perfect square' };
/** The winning numbers, plural, for counts like "143 primes". */
export const BET_PLURAL: Record<Bet, string> = { composite: 'non-primes', prime: 'primes', square: 'squares' };

export const VOLATILITY: Record<Volatility, { bet: Bet; digits: Digits }> = {
  low: { bet: 'composite', digits: 4 },
  medium: { bet: 'prime', digits: 3 },
  high: { bet: 'square', digits: 3 },
  extreme: { bet: 'square', digits: 5 },
};

/** A partly revealed number: one entry per position (leading digit first), null while hidden. */
export type Revealed = readonly (number | null)[];

export const lowest = (d: number) => 10 ** (d - 1);
export const highest = (d: number) => 10 ** d - 1;
export const rangeSize = (d: number) => 9 * 10 ** (d - 1);

/** The digit of n at position pos (0 = leading). */
export const digitAt = (n: number, d: number, pos: number) => Math.floor(n / 10 ** (d - 1 - pos)) % 10;
export const digitsOf = (n: number, d: number) => Array.from({ length: d }, (_, i) => digitAt(n, d, i));

/** Values a position can take: the leading digit is never 0. */
export const valuesAt = (pos: number): number[] => (pos === 0 ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
export const radix = (pos: number) => (pos === 0 ? 9 : 10);

/** Nothing shown yet. */
export const allHidden = (d: number): Revealed => Array<null>(d).fill(null);
export const hiddenPositions = (r: Revealed) => r.flatMap((v, i) => (v === null ? [i] : []));
export const reveal = (r: Revealed, pos: number, v: number): Revealed => r.map((x, i) => (i === pos ? v : x));

/** The next hidden position after `pos`, wrapping round to the left (null when none is left). */
export function nextHidden(r: Revealed, pos: number): number | null {
  for (let k = 1; k <= r.length; k++) {
    const i = (pos + k) % r.length;
    if (r[i] === null) return i;
  }
  return null;
}

const PLACE = ['units', 'tens', 'hundreds', 'thousands', 'ten-thousands'];
/** "tens", "units", … for position pos of a d-digit number. */
export const placeName = (d: number, pos: number) => PLACE[d - 1 - pos];

// ---------- Number theory ----------

const LIMIT = 10 ** 5;
let sieve: Uint8Array | null = null;

/** Sieve of Eratosthenes below 10^5: 1 marks a prime. */
function primeSieve(): Uint8Array {
  if (sieve) return sieve;
  const s = new Uint8Array(LIMIT).fill(1);
  s[0] = 0;
  s[1] = 0;
  for (let p = 2; p * p < LIMIT; p++) if (s[p]) for (let m = p * p; m < LIMIT; m += p) s[m] = 0;
  sieve = s;
  return s;
}

export const isPrime = (n: number) => n >= 2 && n < LIMIT && primeSieve()[n] === 1;
export function isSquare(n: number) {
  const r = Math.round(Math.sqrt(n));
  return r * r === n;
}
export function wins(bet: Bet, n: number) {
  if (bet === 'prime') return isPrime(n);
  if (bet === 'square') return isSquare(n);
  return !isPrime(n);
}

/** Prime factorisation by trial division: [prime, exponent] pairs. */
export function factorize(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let p = 2; p * p <= n; p++) {
    let e = 0;
    while (n % p === 0) {
      n /= p;
      e++;
    }
    if (e) out.push([p, e]);
  }
  if (n > 1) out.push([n, 1]);
  return out;
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (e: number) => [...String(e)].map((c) => SUP[Number(c)]).join('');

/** What N turned out to be: "4729 is prime", "4761 = 69²", "4738 = 2 × 23 × 103". */
export function describe(n: number): string {
  if (isPrime(n)) return `${n} is prime`;
  if (isSquare(n)) return `${n} = ${Math.round(Math.sqrt(n))}²`;
  return `${n} = ${factorize(n)
    .map(([p, e]) => (e > 1 ? `${p}${sup(e)}` : `${p}`))
    .join(' × ')}`;
}

// ---------- Exact counts for every pattern ----------

interface Table {
  d: number;
  stride: number[];
  counts: Int32Array;
}

const tables = new Map<string, Table>();

/**
 * Winning counts for every pattern of shown/hidden digits. Coordinate i runs
 * over the digit values at position i plus one extra "hidden" slot. Fill in
 * the winners, then for each position write the sum over its values into its
 * hidden slot: afterwards every pattern holds its exact count.
 */
function table(bet: Bet, d: number): Table {
  const id = `${bet}:${d}`;
  const cached = tables.get(id);
  if (cached) return cached;
  const base = Array.from({ length: d }, (_, i) => radix(i) + 1);
  const stride = new Array<number>(d).fill(1);
  for (let i = d - 2; i >= 0; i--) stride[i] = stride[i + 1] * base[i + 1];
  const size = stride[0] * base[0];
  const counts = new Int32Array(size);
  for (let n = lowest(d); n <= highest(d); n++) {
    if (!wins(bet, n)) continue;
    let idx = 0;
    for (let i = 0; i < d; i++) idx += (digitAt(n, d, i) - (i === 0 ? 1 : 0)) * stride[i];
    counts[idx] = 1;
  }
  for (let i = 0; i < d; i++) {
    const k = radix(i);
    const span = base[i] * stride[i];
    for (let hi = 0; hi < size; hi += span) {
      for (let lo = 0; lo < stride[i]; lo++) {
        const at = hi + lo;
        let s = 0;
        for (let v = 0; v < k; v++) s += counts[at + v * stride[i]];
        counts[at + k * stride[i]] = s;
      }
    }
  }
  const t = { d, stride, counts };
  tables.set(id, t);
  return t;
}

function indexOf(t: Table, r: Revealed) {
  let idx = 0;
  for (let i = 0; i < t.d; i++) {
    const v = r[i];
    idx += (v === null ? radix(i) : i === 0 ? v - 1 : v) * t.stride[i];
  }
  return idx;
}

/** How many numbers are still consistent with the digits shown. */
export function candidates(r: Revealed) {
  let c = 1;
  for (let i = 0; i < r.length; i++) if (r[i] === null) c *= radix(i);
  return c;
}

/** How many of those candidates win. */
export function hits(bet: Bet, r: Revealed) {
  const t = table(bet, r.length);
  return t.counts[indexOf(t, r)];
}

/** The live win chance: winners among the candidates. */
export const winChance = (bet: Bet, r: Revealed) => hits(bet, r) / candidates(r);

/** Integer square root: the largest r with r² ≤ n. */
function isqrt(n: number) {
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

const primeCounts = new Map<number, number>();
/** π(x): primes up to x, counted on the sieve. */
export function primePi(x: number) {
  const hit = primeCounts.get(x);
  if (hit !== undefined) return hit;
  let c = 0;
  for (let n = 2; n <= x; n++) if (isPrime(n)) c++;
  primeCounts.set(x, c);
  return c;
}

/** Winners among all d-digit numbers, in closed form: π differences, or ⌊√hi⌋ − ⌈√lo⌉ + 1 squares. */
export function startHits(bet: Bet, d: number) {
  const primes = primePi(highest(d)) - primePi(lowest(d) - 1);
  if (bet === 'prime') return primes;
  if (bet === 'composite') return rangeSize(d) - primes;
  return isqrt(highest(d)) - isqrt(lowest(d) - 1);
}

/** The chance before any digit is shown. */
export const startChance = (bet: Bet, d: number) => startHits(bet, d) / rangeSize(d);

/** A full win pays this multiple of the stake. */
export const prize = (bet: Bet, d: number) => RTP / startChance(bet, d);

/** The fair cash-out: prize × P(win | digits shown). */
export const cashOut = (bet: Bet, r: Revealed) => prize(bet, r.length) * winChance(bet, r);

/** Whether the round is decided: no winners left, or nothing but winners. */
export function decided(bet: Bet, r: Revealed): 'won' | 'lost' | null {
  const h = hits(bet, r);
  if (h === 0) return 'lost';
  if (h === candidates(r)) return 'won';
  return null;
}

/** The win chance after revealing position pos, for each value it can show (all equally likely). */
export const fan = (bet: Bet, r: Revealed, pos: number) => valuesAt(pos).map((v) => winChance(bet, reveal(r, pos, v)));

export interface FanStat {
  pos: number;
  values: number[];
  /** Win chance after each value (all values equally likely). Their mean is the chance now. */
  chances: number[];
  /** Chance this reveal ends the round lost (no winner left). */
  bust: number;
  /** Chance this reveal wins outright (only winners left). */
  sure: number;
}

/** What revealing position pos next could do, value by value. */
export function fanStat(bet: Bet, r: Revealed, pos: number): FanStat {
  const values = valuesAt(pos);
  const chances = fan(bet, r, pos);
  const share = (f: (c: number) => boolean) => chances.filter(f).length / values.length;
  return { pos, values, chances, bust: share((c) => c === 0), sure: share((c) => c === 1) };
}

// ---------- The dot grid ----------

export interface Cell {
  /** Stable id: the digits this dot pins down, '*' where hidden. */
  key: string;
  block: number;
  row: number;
  col: number;
  /** The digits this dot pins down (the view's axes filled in). */
  pattern: Revealed;
  /** Numbers in this dot and how many of them win. */
  size: number;
  hits: number;
  /** During a reveal: this dot is outside the slice that the revealed digit keeps. */
  dead?: boolean;
}

export interface GridView {
  /** Hidden positions drawn as [blocks, rows, columns], most significant first (null = unused). */
  block: number | null;
  row: number | null;
  col: number | null;
  /** Hidden positions folded inside each dot. */
  folded: number[];
  blocks: number;
  rows: number;
  cols: number;
  /** Numbers per dot. */
  size: number;
  cells: Cell[];
}

const keyOf = (p: Revealed) => p.map((v) => (v === null ? '*' : v)).join('');

/**
 * The candidates as a grid. The three most significant hidden digits become
 * blocks, rows and columns; any further hidden digits are folded into each
 * dot (10 or 100 numbers per dot). Every dot then stands for the same number
 * of candidates, so the lit share of the dots is exactly P(win | S).
 */
export function gridView(bet: Bet, r: Revealed): GridView {
  const hidden = hiddenPositions(r);
  const axes = hidden.slice(0, 3);
  const folded = hidden.slice(3);
  const [block, row, col] =
    axes.length === 3 ? axes : axes.length === 2 ? [null, axes[0], axes[1]] : axes.length === 1 ? [null, null, axes[0]] : [null, null, null];
  const vals = (axis: number | null): (number | null)[] => (axis === null ? [null] : valuesAt(axis));
  let size = 1;
  for (const f of folded) size *= radix(f);
  const cells: Cell[] = [];
  vals(block).forEach((b, bi) =>
    vals(row).forEach((w, ri) =>
      vals(col).forEach((c, ci) => {
        const pattern = r.map((x, i) => (i === block ? b : i === row ? w : i === col ? c : x));
        cells.push({ key: keyOf(pattern), block: bi, row: ri, col: ci, pattern, size, hits: hits(bet, pattern) });
      }),
    ),
  );
  const count = (axis: number | null) => (axis === null ? 1 : radix(axis));
  return { block, row, col, folded, blocks: count(block), rows: count(row), cols: count(col), size, cells };
}

/**
 * The grid mid-reveal: the dots of the old view, with those outside the
 * revealed digit's slice marked dead and, when the digit was folded inside
 * the dots, each dot recounted with it fixed. The live dots' lit share is
 * then exactly the chance after the reveal.
 */
export function focusView(bet: Bet, r: Revealed, pos: number, v: number): GridView {
  const view = gridView(bet, r);
  const cells = view.cells.map((c): Cell => {
    const at = c.pattern[pos];
    if (at !== null) return at === v ? c : { ...c, dead: true };
    const pattern = reveal(c.pattern, pos, v);
    return { ...c, pattern, size: c.size / radix(pos), hits: hits(bet, pattern) };
  });
  return { ...view, cells };
}

/** Whether the reveal of pos swaps the dots for a finer grid (a folded digit moves up to an axis). */
export const regrids = (r: Revealed, pos: number) => hiddenPositions(r).length > 3 && hiddenPositions(r).indexOf(pos) < 3;

/**
 * The lit core of a dot, as a fraction of the dot's radius. Its area is the
 * dot's winning share, so lit area over total area is exactly P(win | S).
 */
export const coreScale = (c: Cell) => Math.sqrt(c.hits / c.size);

/** Whether n fits a (partial) pattern of digits. */
export const matches = (pattern: Revealed, n: number) => pattern.every((v, i) => v === null || digitAt(n, pattern.length, i) === v);

/**
 * Largest payout under any setting: no cash-out exceeds the prize, and the
 * rarest event (a 5-digit square, 217 of 90,000) has the largest prize.
 */
export const MAX_MULTIPLIER = Math.max(...BETS.flatMap((b) => DIGITS.map((d) => prize(b, d))));
