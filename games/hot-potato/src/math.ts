// Hot Potato: n seats sit on a ring and a bomb starts on the top seat (seat
// 0). Every tick the bomb hops to one of its two neighbours, ½ each, and then
// its fuse blows with chance h (Long 5%, Medium 10%, Short 20%). You back 1–3
// seats, either "Blows on mine" (it goes off on one of your seats) or "Not on
// mine" (it goes off anywhere else).
//
// The theorem: a killed random walk. Let P be the hop matrix of the walk on
// the cycle and h the kill (blow) chance per tick. The bomb blows at seat s
// after exactly k ≥ 1 hops with probability h(1 − h)^(k−1)·(P^k)ₓₛ, so
//     G = Σₖ₌₁ h(1 − h)^(k−1) P^k = h · P · (I − (1 − h)P)⁻¹,
// the resolvent of the walk scaled by the kill rate. Row x of G is where the
// bomb goes off from seat x; it sums to 1 (Σu = 1/h). The ring is symmetric,
// so G depends only on the offset d = s − x (mod n): one vector g[d], found
// exactly by solving the n × n linear system (I − (1 − h)P)u = e₀ and taking
// g[d] = h·(u[d − 1] + u[d + 1])/2. No simulation anywhere.
//
// The heat ring draws g rotated to the bomb's seat: every seat's chance to be
// where it blows, summing to 1, sweeping round as the bomb moves. Your seats'
// share of it is your chance.
//
// Pricing (fixed prize): prize = RTP / P(win at the start) and
//     cash-out = prize · P(win | bomb at x).
// P(win | x) is a martingale over hops (it is a conditional probability of
// one fixed event), so the cash-out starts at RTP and every stopping rule
// returns exactly RTP (optional stopping; rounds end almost surely, after 1/h
// hops on average). The next hop has four outcomes, blow or pass on either
// neighbour, and the odds each leaves you with average back to the odds now.
//
// Switching (fair): at a checkpoint you may change your seats or your side.
// The cash-out value c is kept and the prize relocks at c / P(win | new bet),
// so the switch changes risk, never value. A switch whose relocked prize would
// exceed MAX_WIN is refused (refusing an EV-neutral choice changes nothing),
// so no payout can exceed MAX_WIN: that is the honest maxMultiplier.
//
// Tie rule: a hop goes clockwise iff rng.next() < ½ (exact on the 2^32 grid);
// the fuse blows iff rng.next() < h, exact to within 2^−32.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export const SEAT_COUNTS = [6, 8, 10, 12, 16] as const;
export type SeatCount = (typeof SEAT_COUNTS)[number];

export const FUSES = ['long', 'medium', 'short'] as const;
export type Fuse = (typeof FUSES)[number];
export const FUSE: Record<Fuse, { label: string; h: number }> = {
  long: { label: 'Long', h: 0.05 },
  medium: { label: 'Medium', h: 0.1 },
  short: { label: 'Short', h: 0.2 },
};

/** "on": it blows on one of your seats. "off": it blows anywhere else. */
export type Side = 'on' | 'off';
export const SIDE_LABEL: Record<Side, string> = { on: 'Blows on mine', off: 'Not on mine' };

export const MAX_PICKS = 3;
/** No prize (including one relocked by a switch) may exceed this. */
export const MAX_WIN = 1000;
export const MAX_MULTIPLIER = MAX_WIN;

export const mod = (a: number, n: number) => ((a % n) + n) % n;

const cache = new Map<string, Float64Array>();

/** g[d]: the chance the bomb, now on some seat, finally blows d seats clockwise of it. */
export function blowFromHere(n: number, fuse: Fuse): Float64Array {
  const key = `${n}:${fuse}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const h = FUSE[fuse].h;
  const keep = 1 - h;
  // (I − (1 − h)P) u = e₀, Gaussian elimination with partial pivoting.
  const A = Array.from({ length: n }, (_, i) => {
    const row = new Float64Array(n + 1);
    row[i] += 1;
    row[mod(i + 1, n)] -= keep / 2;
    row[mod(i - 1, n)] -= keep / 2;
    row[n] = i === 0 ? 1 : 0;
    return row;
  });
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || A[r][c] === 0) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  const u = A.map((row, i) => row[n] / row[i]);
  const g = new Float64Array(n);
  for (let d = 0; d < n; d++) g[d] = (h * (u[mod(d - 1, n)] + u[mod(d + 1, n)])) / 2;
  cache.set(key, g);
  return g;
}

/** Every seat's chance to be where the bomb blows, with the bomb on `seat`. Sums to 1. */
export function heat(n: number, fuse: Fuse, seat: number): number[] {
  const g = blowFromHere(n, fuse);
  return Array.from({ length: n }, (_, s) => g[mod(s - seat, n)]);
}

/** Chance it blows on one of `picks`, with the bomb on `seat`. */
export function blowChance(n: number, fuse: Fuse, seat: number, picks: readonly number[]): number {
  const g = blowFromHere(n, fuse);
  let p = 0;
  for (const s of picks) p += g[mod(s - seat, n)];
  return p;
}

export function winChance(n: number, fuse: Fuse, seat: number, picks: readonly number[], side: Side): number {
  const p = blowChance(n, fuse, seat, picks);
  return side === 'on' ? p : 1 - p;
}

/** Whether a blast on `seat` wins the bet. */
export const winsAt = (seat: number, picks: readonly number[], side: Side) => picks.includes(seat) === (side === 'on');

/** The fixed prize for a fresh bet (bomb on the top seat). */
export const startPrize = (n: number, fuse: Fuse, picks: readonly number[], side: Side) => RTP / winChance(n, fuse, 0, picks, side);

export interface NextEvent {
  dir: -1 | 1;
  blows: boolean;
  /** Chance of this outcome on the next hop. */
  prob: number;
  /** The seat the bomb lands on. */
  seat: number;
  /** Your chance to win after it: 1 or 0 if it blows there. */
  win: number;
}

/** The four outcomes of the next hop, anticlockwise first. Σ prob·win = winChance now. */
export function nextEvents(n: number, fuse: Fuse, seat: number, picks: readonly number[], side: Side): NextEvent[] {
  const h = FUSE[fuse].h;
  const out: NextEvent[] = [];
  for (const dir of [-1, 1] as const) {
    const to = mod(seat + dir, n);
    const blast: NextEvent = { dir, blows: true, prob: h / 2, seat: to, win: winsAt(to, picks, side) ? 1 : 0 };
    const pass: NextEvent = { dir, blows: false, prob: (1 - h) / 2, seat: to, win: winChance(n, fuse, to, picks, side) };
    if (dir === -1) out.push(blast, pass);
    else out.push(pass, blast);
  }
  return out;
}

/** One tick: a hop direction, then whether the fuse blows. Uses two uniforms. */
export function tick(next: () => number, fuse: Fuse): { dir: -1 | 1; blows: boolean } {
  const dir = next() < 0.5 ? 1 : -1;
  const blows = next() < FUSE[fuse].h;
  return { dir, blows };
}

/**
 * The prize after switching to a new bet at a checkpoint, keeping the cash-out
 * `cash` (a multiplier of the stake). Null if it would exceed MAX_WIN.
 */
export function relock(cash: number, n: number, fuse: Fuse, seat: number, picks: readonly number[], side: Side): number | null {
  const p = winChance(n, fuse, seat, picks, side);
  if (!(p > 0) || picks.length === 0) return null;
  const prize = cash / p;
  return prize > MAX_WIN ? null : prize;
}

export function volatilityOf(p: number): Volatility {
  return p > 0.4 ? 'low' : p > 0.12 ? 'medium' : p > 0.025 ? 'high' : 'extreme';
}

/** Quick picks for the panel. */
export const PRESETS = ['near', 'pair', 'far', 'trio'] as const;
export type Preset = (typeof PRESETS)[number];
export const PRESET_LABEL: Record<Preset, string> = { near: 'Near', pair: 'Pair', far: 'Far', trio: 'Far 3' };
export function presetPicks(preset: Preset, n: number): number[] {
  const half = n / 2;
  switch (preset) {
    case 'near':
      return [1];
    case 'pair':
      return [2, n - 2];
    case 'far':
      return [half];
    case 'trio':
      return [half - 1, half, half + 1];
  }
}

export const samePicks = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((s) => b.includes(s));

/** Toggles a seat in the picks (1 to MAX_PICKS seats); null if the change isn't allowed. */
export function togglePick(picks: readonly number[], seat: number): number[] | null {
  if (picks.includes(seat)) return picks.length > 1 ? picks.filter((s) => s !== seat) : null;
  if (picks.length >= MAX_PICKS) return null;
  return [...picks, seat].sort((a, b) => a - b);
}

/**
 * The largest fresh-bet prize over every setting: one seat, the least likely
 * one, backed to blow. ("Not on mine" always has P ≥ 1 − 3·max g, far larger.)
 */
export function maxStartPrize(): number {
  let best = 0;
  for (const n of SEAT_COUNTS) for (const f of FUSES) best = Math.max(best, RTP / Math.min(...blowFromHere(n, f)));
  return best;
}
