// Last Light: n lamps sit on a ring. A walker starts on lamp 0 (lit) and
// steps one lamp clockwise or anticlockwise at random, ½ each, lighting every
// lamp the first time it lands on it. You back s lamps; you win if the LAST
// lamp to light is one of yours.
//
// The theorem (a classic of cover times; Lovász, "Random walks on graphs"):
// for the simple random walk on a cycle, the last vertex to be visited is
// uniform over the n − 1 vertices other than the start. So backing s lamps
// wins with probability s/(n − 1), whichever lamps you choose: the start's
// neighbour is exactly as likely to be last as the lamp opposite it.
//
// Live odds, and why they are a picture. The lit lamps always form one arc
// lo..hi (unwrapped onto the integers, lo ≤ 0 ≤ hi) with the walker x on it.
// Lamp j, still dark, is last iff the walker reaches both of j's neighbours
// before j itself. Gambler's ruin on the unwrapped line gives:
//   - a dark lamp strictly inside the dark arc:  exactly 1/(n − 1), always;
//   - the dark lamp at the clockwise end of the light, R = hi + 1:
//       dR/(n − 1), where dR = hi + 1 − x is the walker's distance to R;
//   - the anticlockwise end L = lo − 1:  dL/(n − 1), dL = x − lo + 1.
// (Check: (u − 2) + dR + dL = n − 1 with u dark lamps.) So give every lamp
// except the walker's one SLOT. A dark lamp owns its own slot; the lit lamps
// between the walker and a dark end belong to that end. Then
//     P(lamp j is last | now) = (slots j owns) / (n − 1),
// a literal count on the board. Each step moves exactly one slot from the
// end the walker steps towards to the end it walks away from.
//
// Pricing (fixed prize): prize = RTP·(n − 1)/s and
//     cash-out = prize · P(win | now) = RTP · (your slots) / s.
// A step changes your slot count by +1 or −1 with probability ½ each (or not
// at all), so the cash-out is a martingale starting at RTP. By optional
// stopping, every cash-out rule and every choice of lamps returns exactly
// RTP; the choice of lamps only changes when the drama happens. Payouts never
// exceed the prize, so maxMultiplier = RTP·(36 − 1)/1.
//
// Tie rule: a step goes clockwise iff rng.next() < ½. rng.next() is uniform on
// a 2^32 grid in [0, 1), so each direction has probability exactly ½.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Lamps on the ring. More lamps: each one is less likely to be last. */
export const RINGS = [6, 10, 16, 24, 36] as const;
export type Ring = (typeof RINGS)[number];

/** How many lamps you back. */
export const PICK_COUNTS = [1, 2, 3, 4] as const;
export type PickCount = (typeof PICK_COUNTS)[number];

export const VOLATILITY: Record<Volatility, { n: Ring; s: PickCount }> = {
  low: { n: 6, s: 3 },
  medium: { n: 10, s: 2 },
  high: { n: 16, s: 1 },
  extreme: { n: 36, s: 1 },
};

export const mod = (a: number, n: number) => ((a % n) + n) % n;

/** The walk so far, unwrapped onto the integers: lamp y is lamp mod(y, n). Lamps lo..hi are lit; the walker stands on x. */
export interface Walk {
  readonly n: number;
  readonly lo: number;
  readonly hi: number;
  readonly x: number;
}

export const startWalk = (n: number): Walk => ({ n, lo: 0, hi: 0, x: 0 });
export const litCount = (w: Walk) => w.hi - w.lo + 1;
export const darkCount = (w: Walk) => w.n - litCount(w);
export const isLit = (w: Walk, lamp: number) => mod(lamp - w.lo, w.n) <= w.hi - w.lo;

/** The dark lamp at each end of the light: next in line. They coincide when one dark lamp is left. */
export const ends = (w: Walk) => ({ right: mod(w.hi + 1, w.n), left: mod(w.lo - 1, w.n) });

/** Steps from the walker to each dark end, through the light. */
export const reach = (w: Walk) => ({ right: w.hi + 1 - w.x, left: w.x - w.lo + 1 });

/** Slots lamp j owns, so its chance to light last is slots / (n − 1). */
export function slots(w: Walk, lamp: number): number {
  if (isLit(w, lamp)) return 0;
  if (darkCount(w) === 1) return w.n - 1;
  const e = ends(w);
  const d = reach(w);
  if (lamp === e.right) return d.right;
  if (lamp === e.left) return d.left;
  return 1;
}

/**
 * Who each lamp's slot belongs to (the dark lamp it would make last), by lamp
 * index; null for the walker's own lamp. This is what the board draws.
 */
export function owners(w: Walk): (number | null)[] {
  const { n } = w;
  const e = ends(w);
  const out: (number | null)[] = Array.from({ length: n }, (_, j) => j);
  for (let y = w.lo; y <= w.hi; y++) out[mod(y, n)] = y === w.x ? null : y > w.x ? e.right : e.left;
  return out;
}

export const yourSlots = (w: Walk, picks: readonly number[]) => picks.reduce((t, j) => t + slots(w, j), 0);
export const winChance = (w: Walk, picks: readonly number[]) => yourSlots(w, picks) / (w.n - 1);
export const startChance = (n: number, s: number) => s / (n - 1);
export const prize = (n: number, s: number) => (RTP * (n - 1)) / s;
/** Fair cash-out multiplier: prize × P(win | now) = RTP × your slots / s. */
export const cashValue = (w: Walk, picks: readonly number[]) => (RTP * yourSlots(w, picks)) / picks.length;

/** Chance each dark end is the next lamp to light (gambler's ruin: the nearer end is likelier). */
export function nextLight(w: Walk): { right: number; left: number } {
  if (darkCount(w) <= 1) return { right: 1, left: 1 };
  const d = reach(w);
  const span = litCount(w) + 1;
  return { right: d.left / span, left: d.right / span };
}

/** Chance the next lamp to light is one of yours. */
export function nextRisk(w: Walk, picks: readonly number[]): number {
  const e = ends(w);
  const p = nextLight(w);
  if (darkCount(w) <= 1) return picks.includes(e.right) ? 1 : 0;
  return (picks.includes(e.right) ? p.right : 0) + (picks.includes(e.left) ? p.left : 0);
}

/** Chance the next lamp to light is your last dark one, ending the round with a loss. */
export function bustRisk(w: Walk, picks: readonly number[]): number {
  const dark = picks.filter((j) => !isLit(w, j));
  return dark.length === 1 ? nextRisk(w, dark) : 0;
}

/** Whether one of your dark lamps is next in line, so the next walk can light it. */
export function exposed(w: Walk, picks: readonly number[]): boolean {
  const e = ends(w);
  return picks.some((j) => j === e.right || j === e.left);
}

export type Status = 'live' | 'won' | 'lost';

/** Lost once all your lamps are lit; won once every dark lamp left is yours (one of them must be last). */
export function status(w: Walk, picks: readonly number[]): Status {
  let dark = 0;
  for (const j of picks) if (!isLit(w, j)) dark++;
  if (dark === 0) return 'lost';
  if (dark === darkCount(w)) return 'won';
  return 'live';
}

export interface Segment {
  /** Walker positions, from where it stood to where it stops (only when recorded). */
  xs: number[];
  /** Step numbers (indices into xs) at which a lamp lit. */
  lights: number[];
  end: Walk;
  result: 'checkpoint' | Exclude<Status, 'live'>;
  steps: number;
}

/**
 * Walks until the next lamp that matters lights: one of yours, or one that
 * puts one of yours next in line (or the round ends). Lamps lit while none of
 * yours is next in line cannot change your slots, so the walk runs through
 * them without stopping; stopping there would be worth the same anyway.
 */
export function walkSegment(w0: Walk, picks: readonly number[], rand: () => number, record = true): Segment {
  const { n } = w0;
  let { lo, hi, x } = w0;
  const xs: number[] = record ? [x] : [];
  const lights: number[] = [];
  let steps = 0;
  for (;;) {
    x += rand() < 0.5 ? 1 : -1;
    steps++;
    if (record) xs.push(x);
    if (x >= lo && x <= hi) continue;
    if (x > hi) hi = x;
    else lo = x;
    if (record) lights.push(steps);
    const w: Walk = { n, lo, hi, x };
    const s = status(w, picks);
    if (s !== 'live') return { xs, lights, end: w, result: s, steps };
    if (picks.includes(mod(x, n)) || exposed(w, picks)) return { xs, lights, end: w, result: 'checkpoint', steps };
  }
}

/**
 * Reference for the tests: the exact distribution of the last lamp, by
 * recursion over which end lights next (gambler's ruin), with no slot
 * picture involved. Index = lamp, value = P(that lamp lights last).
 */
export function lastLampExact(w: Walk): number[] {
  const { n } = w;
  const memo = new Map<string, number[]>();
  const from = (lo: number, hi: number, x: number): number[] => {
    const m = hi - lo + 1;
    if (n - m === 1) {
      const out = new Array<number>(n).fill(0);
      out[mod(hi + 1, n)] = 1;
      return out;
    }
    const pRight = (x - lo + 1) / (m + 1);
    const a = atEnd(lo, hi + 1, true);
    const b = atEnd(lo - 1, hi, false);
    return a.map((v, j) => pRight * v + (1 - pRight) * b[j]);
  };
  const atEnd = (lo: number, hi: number, right: boolean): number[] => {
    const key = `${lo},${hi},${right ? 1 : 0}`;
    let v = memo.get(key);
    if (!v) memo.set(key, (v = from(lo, hi, right ? hi : lo)));
    return v;
  };
  return from(w.lo, w.hi, w.x);
}

/** Evenly spaced picks, the first one opposite the start for a single lamp. */
export function defaultPicks(n: number, s: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < s; k++) {
    let j = Math.min(n - 1, Math.max(1, Math.round(((k + 1) * n) / (s + 1))));
    while (out.includes(j)) j = (j % (n - 1)) + 1;
    out.push(j);
  }
  return out;
}

export function volatilityOf(n: number, s: number): Volatility {
  const p = startChance(n, s);
  return p >= 0.4 ? 'low' : p >= 0.15 ? 'medium' : p >= 0.05 ? 'high' : 'extreme';
}

/** No payout exceeds the prize, and the biggest prize is one lamp on the largest ring. */
export const MAX_MULTIPLIER = Math.max(...RINGS.map((n) => prize(n, 1)));
