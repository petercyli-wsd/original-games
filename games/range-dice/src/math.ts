// Range Dice (Stake Prime Dice / Roobet range modes): a result n is drawn
// uniformly from the 10,000 integers 0…9999 (shown as 0.00…99.99). The player
// picks one of three modes and sets the handles:
//
//   Roll in:          one range [low, high], win when low ≤ n ≤ high
//   Roll out:         one range [low, high], win when n < low or n > high
//   Roll between two: two separate ranges, win when n is in either one
//
// W is the number of winning numbers. The win chance is P = W / 10,000 exactly,
// and a win pays
//
//   payout = RTP / P = 9900 / W        (RTP = 0.99, not rounded)
//
// so every set-up in every mode has expected return
//
//   E[payout] = P · RTP / P = 0.99     (exact, closed form)
//
// The tests also check this by enumerating all 10,000 outcomes. Limits as on
// Prime Dice: Roll in may have W = 1 (0.01%, 9,900×); Roll out and Roll between
// two need a winning number on each side or in each piece, so W ≥ 2 (0.02%,
// 4,950×). All modes stop at W = 9800 (98%, 1.0102×). MAX_MULTIPLIER = 9900 is an
// honest bound. On the track the win zones cover W of the 10,000 equal cells,
// so their total length is the chance itself.

export const RTP = 0.99;
export const SIZE = 10_000;
export const MAX_N = SIZE - 1;
export const MAX_WIN = 9_800;
export const MIN_CHANCE = 0.01;
export const MAX_CHANCE = (MAX_WIN / SIZE) * 100;
export const MAX_MULTIPLIER = (RTP * SIZE) / 1;

export type Mode = 'in' | 'out' | 'two';
export type EndKey = 'low' | 'high' | 'low2' | 'high2';

export interface Config {
  mode: Mode;
  low: number;
  high: number;
  /** Second range: used only in 'two' mode. */
  low2: number;
  high2: number;
}

export const ENDS: Record<Mode, EndKey[]> = {
  in: ['low', 'high'],
  out: ['low', 'high'],
  two: ['low', 'high', 'low2', 'high2'],
};

const clampInt = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(x)));

/** Smallest and largest number of winning numbers allowed in a mode. */
export const winLimits = (mode: Mode): [number, number] => [mode === 'in' ? 1 : 2, MAX_WIN];
export const maxMultiplierOf = (mode: Mode) => (RTP * SIZE) / winLimits(mode)[0];

/** The ranges the player sets, as inclusive [low, high] pairs. */
export function pieces(c: Config): [number, number][] {
  return c.mode === 'two'
    ? [
        [c.low, c.high],
        [c.low2, c.high2],
      ]
    : [[c.low, c.high]];
}

const w1Of = (c: Config) => c.high - c.low + 1;

/** Winning numbers for a set-up. */
export function winCount(c: Config): number {
  if (c.mode === 'in') return w1Of(c);
  if (c.mode === 'out') return SIZE - w1Of(c);
  return w1Of(c) + (c.high2 - c.low2 + 1);
}

export const chanceOf = (c: Config) => winCount(c) / SIZE;
export const multiplierForWins = (w: number) => (RTP * SIZE) / w;
export const multiplierOf = (c: Config) => multiplierForWins(winCount(c));

export function isValid(c: Config): boolean {
  for (const k of ENDS[c.mode]) if (!Number.isInteger(c[k])) return false;
  const [lo, hi] = [c.mode === 'out' ? 1 : 0, c.mode === 'out' ? MAX_N - 1 : MAX_N];
  if (c.low < lo || c.high > hi || c.low > c.high) return false;
  if (c.mode === 'two' && (c.low2 < c.high + 2 || c.high2 > MAX_N || c.low2 > c.high2)) return false;
  const [minW, maxW] = winLimits(c.mode);
  const w = winCount(c);
  return w >= minW && w <= maxW;
}

export const clampWins = (mode: Mode, w: number) => {
  const [minW, maxW] = winLimits(mode);
  return clampInt(w, minW, maxW);
};

/** Win count for a typed chance in percent (2 decimals → whole numbers of the 10,000). */
export const winsForChance = (mode: Mode, pct: number) => clampWins(mode, pct * 100);

/** Win count for a typed multiplier: the nearest W, so the payout shown is 9900 / W exactly. */
export const winsForMultiplier = (mode: Mode, m: number) => clampWins(mode, (RTP * SIZE) / m);

/** A range of w cells centred where [lo, hi] was centred, kept inside [minCell, maxCell]. */
function place(lo: number, hi: number, w: number, minCell: number, maxCell: number): [number, number] {
  const ww = clampInt(w, 1, maxCell - minCell + 1);
  const mid = (lo + hi) / 2;
  const l = clampInt(mid - (ww - 1) / 2, minCell, maxCell - ww + 1);
  return [l, l + ww - 1];
}

/** Evenly spaces two ranges of a1 and a2 cells over the track, with equal outer and middle gaps. */
function respace(c: Config, a1: number, a2: number): Config {
  const g = Math.floor((SIZE - a1 - a2) / 3);
  const low = g;
  const high = low + a1 - 1;
  const low2 = high + 1 + g;
  return { ...c, low, high, low2, high2: low2 + a2 - 1 };
}

/** The set-up (same centres, same mode) that has exactly W winning numbers. */
export function withWins(c: Config, w: number): Config {
  const wins = clampWins(c.mode, w);
  if (c.mode === 'in') {
    const [low, high] = place(c.low, c.high, wins, 0, MAX_N);
    return { ...c, low, high };
  }
  if (c.mode === 'out') {
    const [low, high] = place(c.low, c.high, SIZE - wins, 1, MAX_N - 1);
    return { ...c, low, high };
  }
  // Split W between the two ranges in proportion to their widths (largest remainder, each ≥ 1).
  const w1 = w1Of(c);
  const w2 = c.high2 - c.low2 + 1;
  const tot = w1 + w2;
  let a1 = Math.floor((wins * w1) / tot);
  let a2 = Math.floor((wins * w2) / tot);
  if (a1 + a2 < wins) {
    if ((wins * w1) % tot >= (wins * w2) % tot) a1++;
    else a2++;
  }
  if (a1 < 1) {
    a1 = 1;
    a2 = wins - 1;
  } else if (a2 < 1) {
    a2 = 1;
    a1 = wins - 1;
  }
  const [low, high] = place(c.low, c.high, a1, 0, MAX_N);
  const [low2, high2] = place(c.low2, c.high2, a2, 0, MAX_N);
  const next = { ...c, low, high, low2, high2 };
  return isValid(next) ? next : respace(c, a1, a2);
}

/**
 * Moves one handle (dragging or typing Low / High), keeping the others fixed
 * and the set-up inside its mode's limits.
 */
export function setEnd(c: Config, end: EndKey, value: number): Config {
  if (!ENDS[c.mode].includes(end)) return c;
  const out = c.mode === 'out';
  const bounds: Record<EndKey, [number, number]> = {
    low: [out ? 1 : 0, c.high],
    high: [c.low, c.mode === 'two' ? c.low2 - 2 : out ? MAX_N - 1 : MAX_N],
    low2: [c.high + 2, c.high2],
    high2: [c.low2, MAX_N],
  };
  let [lo, hi] = bounds[end];
  // W moves one-for-one with the handle: up when a high handle grows (down in Roll out).
  const s = (end === 'high' || end === 'high2' ? 1 : -1) * (out ? -1 : 1);
  const [minW, maxW] = winLimits(c.mode);
  const w0 = winCount(c);
  const cur = c[end];
  if (s === 1) {
    lo = Math.max(lo, cur + minW - w0);
    hi = Math.min(hi, cur + maxW - w0);
  } else {
    lo = Math.max(lo, cur - (maxW - w0));
    hi = Math.min(hi, cur - (minW - w0));
  }
  if (hi < lo) return c;
  return { ...c, [end]: clampInt(value, lo, hi) };
}

/** Slides one range (0 = first, 1 = second) so it starts at `low`, keeping its width. */
export function shift(c: Config, piece: 0 | 1, low: number): Config {
  const [lk, hk]: [EndKey, EndKey] = piece === 0 ? ['low', 'high'] : ['low2', 'high2'];
  const span = c[hk] - c[lk];
  const minLow = c.mode === 'out' ? 1 : piece === 1 ? c.high + 2 : 0;
  const maxHigh = c.mode === 'out' ? MAX_N - 1 : c.mode === 'two' && piece === 0 ? c.low2 - 2 : MAX_N;
  const maxLow = maxHigh - span;
  if (maxLow < minLow) return c;
  const l = clampInt(low, minLow, maxLow);
  return { ...c, [lk]: l, [hk]: l + span };
}

/** Changes mode, keeping the first range where it is and trimming to the new mode's limits. */
export function setMode(c: Config, mode: Mode): Config {
  if (mode === c.mode) return c;
  const base = { ...c, mode };
  if (mode === 'in') {
    const [low, high] = place(c.low, c.high, clampInt(w1Of(c), 1, MAX_WIN), 0, MAX_N);
    return { ...base, low, high };
  }
  if (mode === 'out') {
    const [low, high] = place(c.low, c.high, clampInt(w1Of(c), SIZE - MAX_WIN, SIZE - 2), 1, MAX_N - 1);
    return { ...base, low, high };
  }
  // To two ranges: a first range up to 25% stays put and a second goes beside it in the roomier side;
  // a wider one is replaced by two evenly spaced ranges of 25%.
  if (c.mode === 'out' || w1Of(c) > 2500) return respace(base, 2500, 2500);
  const { low, high } = c;
  const w = high - low + 1;
  const leftLen = low - 1;
  const rightLen = MAX_N - high - 1;
  const left = leftLen > rightLen;
  const w2 = Math.min(w, left ? leftLen : rightLen);
  const [low2, high2] = left ? place(0, low - 2, w2, 0, low - 2) : place(high + 2, MAX_N, w2, high + 2, MAX_N);
  return left ? { ...base, low: low2, high: high2, low2: low, high2: high } : { ...base, low, high, low2, high2 };
}

/** The next mode in the tab order (hotkey X). */
export const nextMode = (m: Mode): Mode => (m === 'in' ? 'out' : m === 'out' ? 'two' : 'in');

/** Uniform integer in 0…9999 from a uniform u ∈ [0, 1). */
export const draw = (u: number) => Math.min(MAX_N, Math.floor(u * SIZE));

export function isWin(c: Config, n: number): boolean {
  const inside = n >= c.low && n <= c.high;
  if (c.mode === 'in') return inside;
  if (c.mode === 'out') return !inside;
  return inside || (n >= c.low2 && n <= c.high2);
}

/** One complete bet: the drawn number and the payout multiplier (0 on a loss). */
export function playBet(c: Config, u: number) {
  const result = draw(u);
  const win = isWin(c, result);
  return { result, win, multiplier: win ? multiplierOf(c) : 0 };
}

/** Exact expected payout by enumerating all 10,000 outcomes. */
export function enumerateRtp(c: Config): number {
  let sum = 0;
  const m = multiplierOf(c);
  for (let n = 0; n < SIZE; n++) if (isWin(c, n)) sum += m;
  return sum / SIZE;
}

export type Level = 'low' | 'medium' | 'high' | 'extreme';
export function volatilityOf(p: number): Level {
  return p >= 0.4 ? 'low' : p >= 0.1 ? 'medium' : p >= 0.01 ? 'high' : 'extreme';
}

export const DEFAULT_CONFIG: Config = { mode: 'in', low: 2525, high: 7474, low2: 8000, high2: 8999 };

/**
 * The winning stretches of the track, in cell units [from, to) of the 10,000
 * cells. The board paints exactly these, so their total length is W.
 */
export function winZones(c: Config): [number, number][] {
  if (c.mode === 'in') return [[c.low, c.high + 1]];
  if (c.mode === 'out') return [[0, c.low], [c.high + 1, SIZE]];
  return [[c.low, c.high + 1], [c.low2, c.high2 + 1]];
}
