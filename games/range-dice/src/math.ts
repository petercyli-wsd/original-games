// Range Dice (the "ultimate dice" format): a result n is drawn uniformly from
// the 10,000 integers 0…9999. The player sets a range [low, high] (inclusive)
// with a two-handle slider and bets either
//
//   In:  win when low ≤ n ≤ high       → W = high − low + 1 winning numbers
//   Out: win when n < low or n > high  → W = 10000 − (high − low + 1)
//
// The win chance is P = W / 10000 exactly, and a win pays
//
//   payout = RTP / P = 9900 / W        (RTP = 0.99, not rounded)
//
// so every range and direction has expected return
//
//   E[payout] = P · RTP / P = 0.99     (exact, closed form)
//
// The tests also check this by enumerating all 10,000 outcomes. The chance is
// limited to 0.01%–98% (W from 1 to 9800), so payouts run from 1.0102× to
// 9,900×; MAX_MULTIPLIER = 9900 is an honest bound. On the track, the win zone
// covers W of the 10,000 equal cells, so its length is the chance itself.

export const RTP = 0.99;
export const SIZE = 10_000;
export const MAX_N = SIZE - 1;
/** Winning numbers allowed: 1 (0.01%) to 9800 (98%). */
export const MIN_WIN = 1;
export const MAX_WIN = 9_800;
export const MIN_CHANCE = (MIN_WIN / SIZE) * 100;
export const MAX_CHANCE = (MAX_WIN / SIZE) * 100;
export const MAX_MULTIPLIER = (RTP * SIZE) / MIN_WIN;

export type Direction = 'in' | 'out';

export interface Range {
  low: number;
  high: number;
  dir: Direction;
}

const clampInt = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(x)));

/** Numbers covered by [low, high]. */
export const width = (r: Pick<Range, 'low' | 'high'>) => r.high - r.low + 1;

/** Winning numbers for a range and direction. */
export const winCount = (r: Range) => (r.dir === 'in' ? width(r) : SIZE - width(r));

/** Win chance as a probability. */
export const chanceOf = (r: Range) => winCount(r) / SIZE;

/** Payout multiplier for W winning numbers. */
export const multiplierForWins = (w: number) => (RTP * SIZE) / w;

export const multiplierOf = (r: Range) => multiplierForWins(winCount(r));

/** Range widths allowed for a direction (so that W stays in [MIN_WIN, MAX_WIN]). */
export function widthLimits(dir: Direction): [number, number] {
  return dir === 'in' ? [MIN_WIN, MAX_WIN] : [SIZE - MAX_WIN, SIZE - MIN_WIN];
}

export function isValid(r: Range): boolean {
  if (!Number.isInteger(r.low) || !Number.isInteger(r.high)) return false;
  if (r.low < 0 || r.high > MAX_N || r.low > r.high) return false;
  const w = winCount(r);
  return w >= MIN_WIN && w <= MAX_WIN;
}

/** Clamp a win count W to the allowed band. */
export const clampWins = (w: number) => clampInt(w, MIN_WIN, MAX_WIN);

/** Win count for a typed chance in percent (2 decimals → whole numbers of the 10,000). */
export const winsForChance = (pct: number) => clampWins(pct * 100);

/** Win count for a typed multiplier: the nearest W, so the payout shown is 9900 / W exactly. */
export const winsForMultiplier = (m: number) => clampWins((RTP * SIZE) / m);

/** Places a range of width w centred where `around` was centred, kept on the track. */
export function placeWidth(around: Pick<Range, 'low' | 'high'>, w: number): { low: number; high: number } {
  const ww = clampInt(w, 1, SIZE);
  const mid = (around.low + around.high) / 2;
  const low = clampInt(mid - (ww - 1) / 2, 0, SIZE - ww);
  return { low, high: low + ww - 1 };
}

/** The range (same centre, same direction) that has exactly W winning numbers. */
export function withWins(r: Range, w: number): Range {
  const wins = clampWins(w);
  return { ...placeWidth(r, r.dir === 'in' ? wins : SIZE - wins), dir: r.dir };
}

/**
 * Moves one end of the range (dragging a handle or typing low/high), keeping
 * the other end fixed and the width inside the direction's limits.
 */
export function setEnd(r: Range, end: 'low' | 'high', value: number): Range {
  const [minW, maxW] = widthLimits(r.dir);
  if (end === 'low') {
    const lo = Math.max(0, r.high - maxW + 1);
    const hi = r.high - minW + 1;
    if (hi < lo) return r;
    return { ...r, low: clampInt(value, lo, hi) };
  }
  const lo = r.low + minW - 1;
  const hi = Math.min(MAX_N, r.low + maxW - 1);
  if (hi < lo) return r;
  return { ...r, high: clampInt(value, lo, hi) };
}

/** Slides the whole range so it starts at `low`, keeping its width. */
export function shift(r: Range, low: number): Range {
  const w = width(r);
  const l = clampInt(low, 0, SIZE - w);
  return { ...r, low: l, high: l + w - 1 };
}

/** Flips In ↔ Out keeping the range where it is, trimmed if the new direction needs it. */
export function flip(r: Range): Range {
  const dir: Direction = r.dir === 'in' ? 'out' : 'in';
  const [minW, maxW] = widthLimits(dir);
  const w = width(r);
  if (w >= minW && w <= maxW) return { ...r, dir };
  return { ...placeWidth(r, Math.min(maxW, Math.max(minW, w))), dir };
}

/** Uniform integer in 0…9999 from a uniform u ∈ [0, 1). */
export const draw = (u: number) => Math.min(MAX_N, Math.floor(u * SIZE));

export const isWin = (r: Range, n: number) => (n >= r.low && n <= r.high) === (r.dir === 'in');

/** One complete bet: the drawn number and the payout multiplier (0 on a loss). */
export function playBet(r: Range, u: number) {
  const result = draw(u);
  const win = isWin(r, result);
  return { result, win, multiplier: win ? multiplierOf(r) : 0 };
}

/** Exact expected payout by enumerating all 10,000 outcomes. */
export function enumerateRtp(r: Range): number {
  let sum = 0;
  const m = multiplierOf(r);
  for (let n = 0; n < SIZE; n++) if (isWin(r, n)) sum += m;
  return sum / SIZE;
}

/** Quick-pick payouts offered as chips; each maps to a whole W (9900 / m is an integer). */
export const PRESETS = [1.5, 2, 3, 5, 10, 100] as const;

export type Level = 'low' | 'medium' | 'high' | 'extreme';
export function volatilityOf(p: number): Level {
  return p >= 0.4 ? 'low' : p >= 0.1 ? 'medium' : p >= 0.01 ? 'high' : 'extreme';
}

export const DEFAULT_RANGE: Range = { low: 2525, high: 7474, dir: 'in' };

/**
 * The winning stretches of the track, in cell units [from, to) of the 10,000
 * cells. The board paints exactly these, so their total length is W.
 */
export function winZones(r: Range): [number, number][] {
  if (r.dir === 'in') return [[r.low, r.high + 1]];
  const z: [number, number][] = [];
  if (r.low > 0) z.push([0, r.low]);
  if (r.high < MAX_N) z.push([r.high + 1, SIZE]);
  return z;
}
