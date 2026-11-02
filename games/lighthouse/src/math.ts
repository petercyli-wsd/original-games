// Lighthouse: a lamp at height h above a straight shore fires its beam at a
// uniformly random angle θ in (−90°, 90°), measured from straight down. The
// beam meets the shore at x = h·tan θ, so the landing point is Cauchy
// distributed with scale h (the classic "lighthouse problem"). The tail is
// heavy: far from the tower, a window of width w at distance x is lit with
// chance ≈ w·h / (π·x²), so twice as far is about four times as hard.
//
// The player's one knob is the window's distance d from the foot of the tower.
// The window has a fixed width, [a, b] = [d − ½, d + ½]. Seen from the lamp it
// spans the beam angles α = atan(a/h) to β = atan(b/h), so
//
//   P(win | h) = (β − α) / π,
//
// the window's share of the lamp's 180° fan. The board draws exactly that: the
// green cone from the lamp to the window, and the green share of the fan dial.
//
// The round is a two-stage reveal (BUILDING-GAMES pattern 3):
//   1. The tower rises to h ~ U[H_MIN, H_MAX]. Before it stops the chance is
//      P(win | h) averaged over h, in closed form, using
//        ∫ atan(c/h) dh = h·atan(c/h) + (c/2)·ln(h² + c²)      (F below),
//      so P₀ = [G(b) − G(a)] / (π·(H_MAX − H_MIN)), G(c) = F(c, H_MAX) − F(c, H_MIN).
//      Checkpoint: cash out or fire.
//   2. The beam fires at a uniform angle in the fan.
//
// How the tower moves the odds: d/dh (β − α) has the sign of a·b − h² (for
// a < b). So a window that reaches the foot of the tower (a ≤ 0) always gets a
// narrower slice from a taller tower, a window with a·b ≥ H_MAX² always gets a
// wider one, and in between the slice is widest at h* = √(a·b).
//
// Pricing (pattern 1 at the checkpoint): the full prize is RTP / P₀ and the
// cash-out in any state S is prize × P(win | S). P(win | S) is the conditional
// chance of one fixed event given more information, so it is a martingale:
// E_h[P(win | h)] = P₀ for the tower, and the beam lights the window with
// exactly P(win | h). The cash-out therefore starts at RTP and is a martingale,
// and by optional stopping every cash-out strategy returns exactly RTP. The
// distance is fixed before the bet.
//
// Tie rule: the beam lights the window when α ≤ θ ≤ β (closed in angle space;
// boundaries have probability zero). Every tower height gives 0 < P(win | h) < 1,
// so the checkpoint is always live.
//
// Max win: for each height, P(win | h) integrates a symmetric unimodal (Cauchy)
// density over a window of fixed width, so it shrinks as the window's centre
// moves away from the tower. The hardest legal window is the farthest one,
// d = DIST_MAX, and no payout can exceed RTP / P₀(that window) = MAX_MULTIPLIER
// (the cash-out never exceeds the prize).

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** The tower stops at a uniform height in [H_MIN, H_MAX] (shore units). */
export const H_MIN = 0.5;
export const H_MAX = 2.5;

/** The window's fixed width, and the range of its distance (centre) from the tower. */
export const WIDTH = 1;
export const DIST_MIN = 0;
export const DIST_MAX = 8;
/** Distances snap to tenths. */
export const DIST_STEP = 0.1;

export interface Win {
  a: number;
  b: number;
}

/** A range of beam angles [lo, hi] in radians, measured from straight down. */
export type Wedge = readonly [number, number];
/** The lamp's fan: every direction that meets the shore. */
export const FAN: Wedge = [-Math.PI / 2, Math.PI / 2];

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
/** Tenths per unit; working in integer tenths keeps the window ends exact decimals. */
const TENTHS = Math.round(1 / DIST_STEP);

/** A legal distance: clamped to [DIST_MIN, DIST_MAX] and snapped to tenths. */
export const snapDist = (d: number) => Math.round(clamp(d, DIST_MIN, DIST_MAX) * TENTHS) / TENTHS + 0;

/** The window at distance d: [d − ½, d + ½]. */
export function windowAt(d: number): Win {
  const c = Math.round(snapDist(d) * TENTHS);
  const half = Math.round((WIDTH * TENTHS) / 2);
  return { a: (c - half) / TENTHS + 0, b: (c + half) / TENTHS + 0 };
}

/** ∫ atan(c/h) dh. */
const F = (c: number, h: number) => h * Math.atan2(c, h) + (c / 2) * Math.log(h * h + c * c);
const G = (c: number) => F(c, H_MAX) - F(c, H_MIN);

/** The chance before the tower stops: P(win | h) averaged over h ~ U[H_MIN, H_MAX]. */
export function headlineChance(win: Win): number {
  return (G(win.b) - G(win.a)) / (Math.PI * (H_MAX - H_MIN));
}

/** The full prize for a window (the cash-out at the start is RTP). */
export function prizeFor(win: Win): number {
  return RTP / headlineChance(win);
}

/** The hardest window: the farthest one. */
export const HARDEST: Win = windowAt(DIST_MAX);
/** Smallest headline chance any legal window has (≈ 0.71%), and the largest prize. */
export const P_MIN = headlineChance(HARDEST);
export const MAX_MULTIPLIER = RTP / P_MIN;

export type PresetId = 'near' | 'mid' | 'far' | 'vfar';

export const PRESETS: Record<PresetId, { label: string; dist: number }> = {
  near: { label: 'Near', dist: 0 },
  mid: { label: 'Mid', dist: 3 },
  far: { label: 'Far', dist: 5 },
  vfar: { label: 'Very far', dist: 8 },
};
export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];
export const presetOf = (d: number): PresetId | 'custom' => PRESET_IDS.find((id) => Math.abs(PRESETS[id].dist - d) < 1e-9) ?? 'custom';

export const VOLATILITY: Record<Volatility, PresetId> = {
  low: 'near',
  medium: 'mid',
  high: 'far',
  extreme: 'vfar',
};

export function volatilityOf(win: Win): Volatility {
  const p = headlineChance(win);
  return p > 0.12 ? 'low' : p > 0.03 ? 'medium' : p > 0.012 ? 'high' : 'extreme';
}

// ---------- Geometry ----------

/** Beam angle that hits shore point x from a lamp at height h. */
export const angleTo = (x: number, h: number) => Math.atan2(x, h);

/** Where a beam at angle θ from height h meets the shore. */
export const shoreX = (h: number, theta: number) => h * Math.tan(theta);

/** The window's angular span seen from height h: [α, β]. */
export const windowAngles = (win: Win, h: number): Wedge => [angleTo(win.a, h), angleTo(win.b, h)];

/** P(win | tower height h): the window's share of the 180° fan. */
export function chanceAt(win: Win, h: number): number {
  const [al, be] = windowAngles(win, h);
  return (be - al) / Math.PI;
}

/** Whether the window's slice is widening as the tower grows past height h. */
export const widening = (win: Win, h: number) => win.a * win.b > h * h;

/** How a taller tower changes the window's slice over [H_MIN, H_MAX]. */
export type HeightEffect = { kind: 'wider' } | { kind: 'narrower' } | { kind: 'peak'; at: number };

export function heightEffect(win: Win): HeightEffect {
  if (win.a <= 0) return { kind: 'narrower' };
  const peak = Math.sqrt(win.a * win.b);
  if (peak >= H_MAX) return { kind: 'wider' };
  if (peak <= H_MIN) return { kind: 'narrower' };
  return { kind: 'peak', at: peak };
}

/** The plain-words label for a height effect. */
export function heightEffectLabel(e: HeightEffect): string {
  return e.kind === 'wider' ? 'taller tower: wider slice' : e.kind === 'narrower' ? 'taller tower: narrower slice' : `widest slice at height ${e.at.toFixed(1)}`;
}

/**
 * Display only (the idle preview): a tower height in [H_MIN, H_MAX] where
 * P(win | h) equals the headline chance. It exists because P₀ is the average
 * of the continuous P(win | h) over that range. Found by a scan plus bisection.
 */
export function typicalHeight(win: Win): number {
  const p0 = headlineChance(win);
  const g = (h: number) => chanceAt(win, h) - p0;
  const N = 64;
  let lo = H_MIN;
  for (let i = 1; i <= N; i++) {
    const hi = H_MIN + ((H_MAX - H_MIN) * i) / N;
    if (g(lo) === 0) return lo;
    if (g(lo) * g(hi) <= 0) {
      let [l, r] = [lo, hi];
      for (let k = 0; k < 60; k++) {
        const m = (l + r) / 2;
        if (g(l) * g(m) <= 0) r = m;
        else l = m;
      }
      return (l + r) / 2;
    }
    lo = hi;
  }
  return (H_MIN + H_MAX) / 2;
}

/** Stage 1: the tower height from a uniform u in [0, 1). */
export const towerHeight = (u: number) => H_MIN + u * (H_MAX - H_MIN);

/** Stage 2: the beam angle, uniform in the fan. */
export const fireAngle = (u: number) => FAN[0] + u * (FAN[1] - FAN[0]);

/** Whether a beam at angle θ from height h lights the window (closed in angle space). */
export function lands(win: Win, h: number, theta: number): boolean {
  const [al, be] = windowAngles(win, h);
  return theta >= al && theta <= be;
}

/** Where the fan dial is green (lights the window) and red (misses). */
export interface DialArcs {
  green: Wedge;
  red: Wedge[];
}

export function dialArcs(win: Win, h: number): DialArcs {
  const green = windowAngles(win, h);
  const red: Wedge[] = [];
  if (green[0] > FAN[0]) red.push([FAN[0], green[0]]);
  if (green[1] < FAN[1]) red.push([green[1], FAN[1]]);
  return { green, red };
}
