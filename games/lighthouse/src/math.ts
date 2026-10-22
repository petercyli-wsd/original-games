// Lighthouse: a lamp at height h above a straight shore fires its beam at a
// uniformly random angle θ in (−90°, 90°), measured from straight down. The
// beam meets the shore at x = h·tan θ, so the landing point is Cauchy
// distributed with scale h (the classic "lighthouse problem"). The tail is
// heavy: far from the tower, a window of width w at distance x is lit with
// chance ≈ w·h / (π·x²), so twice as far is about four times as hard.
//
// The player places a window [a, b] on the shore. Seen from the lamp, the
// window spans the beam angles α = atan(a/h) to β = atan(b/h), so
//
//   P(win | h) = (β − α) / π,
//
// the window's share of the lamp's 180° fan. The board draws exactly that: the
// green sector from the lamp to the window, and the green arc of the fan dial.
//
// The round is a staged reveal (BUILDING-GAMES pattern 3):
//   1. The tower rises to h ~ U[H_MIN, H_MAX]. The headline chance is P(win | h)
//      averaged over h, in closed form, using
//        ∫ atan(c/h) dh = h·atan(c/h) + (c/2)·ln(h² + c²)      (F below),
//      so P₀ = [G(b) − G(a)] / (π·(H_MAX − H_MIN)), G(c) = F(c, H_MAX) − F(c, H_MIN).
//   2. Shutters (0 to 3, chosen before the bet): each one closes one half of the
//      lit wedge of directions. θ is uniform, so each half is kept with chance
//      exactly ½, θ stays uniform on the kept half, and
//        P(win | h, wedge) = |[α, β] ∩ wedge| / |wedge|.
//   3. The beam sweeps and stops at a uniform angle inside the lit wedge.
//
// Pricing (pattern 1 at every checkpoint): the full prize is RTP / P₀ and the
// cash-out in any state S is prize × P(win | S). P(win | S) is the conditional
// chance of one fixed event given more and more information, so it is a
// martingale: E_h[P(win | h)] = P₀ for the tower, ½·P(left) + ½·P(right) =
// P(wedge) for a shutter, and the beam lights the window with exactly
// P(win | h, wedge). The cash-out therefore starts at RTP and is a martingale,
// and by optional stopping every cash-out strategy returns exactly RTP. The
// settings (window, shutters) are fixed before the bet; the shutter count
// changes the pace and how the risk is spread, never P₀ or the prize.
//
// Tie rule: the beam lights the window when α ≤ θ ≤ β (closed in angle space;
// boundaries have probability zero). A shutter keeps the left half [L, M) when
// its uniform draw is < ½, else the right half [M, R). A state with
// P(win | S) = 0 (the shutter closed over the whole window) ends the round as
// a loss; P(win | S) = 1 (the lit wedge lies inside the window) fires at once.
//
// Max win: windows must lie on the shore [SHORE_MIN, SHORE_MAX] with width at
// least W_MIN. For each height, P(win | h) integrates a symmetric unimodal
// (Cauchy) density over the window, so it grows with the width and shrinks as
// the window's centre moves away from the tower. The hardest legal window is
// therefore the narrowest one at the far end, [SHORE_MAX − W_MIN, SHORE_MAX],
// and no payout can exceed RTP / P₀(that window) = MAX_MULTIPLIER (the
// cash-out never exceeds the prize).

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** The tower stops at a uniform height in [H_MIN, H_MAX] (shore units). */
export const H_MIN = 1;
export const H_MAX = 3;

/** The shore the player can place a window on, and the window's size limits. */
export const SHORE_MIN = -2;
export const SHORE_MAX = 7.5;
export const W_MIN = 0.5;
export const W_MAX = 5;
/** Window ends snap to this grid. */
export const SNAP = 0.1;

export interface Win {
  a: number;
  b: number;
}

/** A range of beam angles [lo, hi] in radians, measured from straight down. */
export type Wedge = readonly [number, number];
export const FAN: Wedge = [-Math.PI / 2, Math.PI / 2];

/** ∫ atan(c/h) dh. */
const F = (c: number, h: number) => h * Math.atan2(c, h) + (c / 2) * Math.log(h * h + c * c);
const G = (c: number) => F(c, H_MAX) - F(c, H_MIN);

/** Headline chance before the tower rises: P(win | h) averaged over h ~ U[H_MIN, H_MAX]. */
export function headlineChance(win: Win): number {
  return (G(win.b) - G(win.a)) / (Math.PI * (H_MAX - H_MIN));
}

/** The full prize for a window (the cash-out at the start is RTP). */
export function prizeFor(win: Win): number {
  return RTP / headlineChance(win);
}

/** The hardest window the shore allows: the narrowest one, at the far end. */
export const HARDEST: Win = { a: SHORE_MAX - W_MIN, b: SHORE_MAX };
/** Smallest headline chance any legal window has (≈ 0.554%), and the largest prize. */
export const P_MIN = headlineChance(HARDEST);
export const MAX_MULTIPLIER = RTP / P_MIN;

export type PresetId = 'near' | 'mid' | 'far' | 'vfar';

export const PRESETS: Record<PresetId, { label: string; win: Win }> = {
  near: { label: 'Near', win: { a: -1.5, b: 1.5 } },
  mid: { label: 'Mid', win: { a: 2, b: 3.5 } },
  far: { label: 'Far', win: { a: 4, b: 4.8 } },
  vfar: { label: 'Very far', win: { a: 6.6, b: 7.1 } },
};
export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

export const VOLATILITY: Record<Volatility, PresetId> = {
  low: 'near',
  medium: 'mid',
  high: 'far',
  extreme: 'vfar',
};

export function volatilityOf(win: Win): Volatility {
  const p = headlineChance(win);
  return p > 0.2 ? 'low' : p > 0.04 ? 'medium' : p > 0.012 ? 'high' : 'extreme';
}

/** Shutter stages per round. There is a checkpoint after the tower and after each shutter. */
export const SHUTTERS = [0, 1, 2, 3] as const;
export type Shutters = (typeof SHUTTERS)[number];

// ---------- Geometry ----------

/** Beam angle that hits shore point x from a lamp at height h. */
export const angleTo = (x: number, h: number) => Math.atan2(x, h);

/** Where a beam at angle θ from height h meets the shore. */
export const shoreX = (h: number, theta: number) => h * Math.tan(theta);

/** The window's angular span seen from height h: [α, β]. */
export const windowAngles = (win: Win, h: number): Wedge => [angleTo(win.a, h), angleTo(win.b, h)];

/** Angle (radians) of the part of the window's span inside the lit wedge. */
export function litOverlap(win: Win, h: number, wedge: Wedge = FAN): number {
  const [al, be] = windowAngles(win, h);
  return Math.max(0, Math.min(be, wedge[1]) - Math.max(al, wedge[0]));
}

/** P(win | tower height h, lit wedge): the green share of the lit arc. */
export function chanceAt(win: Win, h: number, wedge: Wedge = FAN): number {
  return litOverlap(win, h, wedge) / (wedge[1] - wedge[0]);
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

/** The two halves a shutter chooses between. */
export function halves([lo, hi]: Wedge): [Wedge, Wedge] {
  const mid = (lo + hi) / 2;
  return [
    [lo, mid],
    [mid, hi],
  ];
}

/** Stage 2: a shutter keeps the left half if u < ½, else the right half. */
export const shutter = (wedge: Wedge, u: number): Wedge => halves(wedge)[u < 0.5 ? 0 : 1];

/** Stage 3: the beam angle, uniform in the lit wedge. */
export const fireAngle = ([lo, hi]: Wedge, u: number) => lo + u * (hi - lo);

/** Whether a beam at angle θ from height h lights the window (closed in angle space). */
export function lands(win: Win, h: number, theta: number): boolean {
  const [al, be] = windowAngles(win, h);
  return theta >= al && theta <= be;
}

/** Chance the next shutter closes over the whole window (0 or ½ in a live round). */
export function shutterRisk(win: Win, h: number, wedge: Wedge): number {
  return halves(wedge).reduce((q, half) => q + (litOverlap(win, h, half) > 0 ? 0 : 0.5), 0);
}

/** Where the fan dial is green (lights the window), red (lit, misses) or dark (shuttered). */
export interface DialArcs {
  green: Wedge | null;
  red: Wedge[];
  shut: Wedge[];
}

export function dialArcs(win: Win, h: number, wedge: Wedge): DialArcs {
  const [al, be] = windowAngles(win, h);
  const lo = Math.max(al, wedge[0]);
  const hi = Math.min(be, wedge[1]);
  const green: Wedge | null = hi > lo ? [lo, hi] : null;
  const red: Wedge[] = [];
  if (green) {
    if (green[0] > wedge[0]) red.push([wedge[0], green[0]]);
    if (green[1] < wedge[1]) red.push([green[1], wedge[1]]);
  } else {
    red.push(wedge);
  }
  const shut: Wedge[] = [];
  if (wedge[0] > FAN[0]) shut.push([FAN[0], wedge[0]]);
  if (wedge[1] < FAN[1]) shut.push([wedge[1], FAN[1]]);
  return { green, red, shut };
}

// ---------- Window placement (presets, sliders and drag) ----------

const EPS = 1e-9;
const PER_UNIT = Math.round(1 / SNAP);
/** Rounds to the SNAP grid (dividing by an integer keeps 0.1-steps exact as decimals). */
const snap = (x: number) => Math.round(x * PER_UNIT) / PER_UNIT + 0;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Whether the player may bet on this window. */
export function windowOk(win: Win): boolean {
  const w = win.b - win.a;
  return win.a >= SHORE_MIN - EPS && win.b <= SHORE_MAX + EPS && w >= W_MIN - EPS && w <= W_MAX + EPS && headlineChance(win) >= P_MIN - 1e-12;
}

/** A window of the given width centred as close to `centre` as the shore allows. */
export function placeWindow(centre: number, width: number): Win {
  const w = snap(clamp(width, W_MIN, W_MAX));
  const a = clamp(snap(centre - w / 2), SHORE_MIN, snap(SHORE_MAX - w));
  return { a, b: snap(a + w) };
}

/** Moves the window so its centre is at x, keeping its width. */
export const moveWindow = (win: Win, centre: number) => placeWindow(centre, win.b - win.a);

/** Changes the width, keeping the centre where the shore allows. */
export const resizeWindow = (win: Win, width: number) => placeWindow((win.a + win.b) / 2, width);

/** Drags one end of the window to x, keeping the other end fixed. */
export function dragEnd(win: Win, end: 'a' | 'b', x: number): Win {
  if (end === 'a') return { a: clamp(snap(x), snap(Math.max(SHORE_MIN, win.b - W_MAX)), snap(win.b - W_MIN)), b: win.b };
  return { a: win.a, b: clamp(snap(x), snap(win.a + W_MIN), snap(Math.min(SHORE_MAX, win.a + W_MAX))) };
}

export const sameWindow = (x: Win, y: Win) => Math.abs(x.a - y.a) < EPS && Math.abs(x.b - y.b) < EPS;

export const presetOf = (win: Win): PresetId | 'custom' => PRESET_IDS.find((id) => sameWindow(PRESETS[id].win, win)) ?? 'custom';
