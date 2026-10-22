// Chords: random chords are drawn on a circle one at a time, each joining two
// uniform random points of the rim. The round is lost the moment two chords
// cross; draw the target number of chords with none crossing and it pays out.
//
// Positions are fractions of a turn in [0, 1), clockwise from the top.
//
// Regions. c chords that don't cross cut the disc into c + 1 regions (faces).
// Each region owns some arcs of the rim; call their total length L (a share
// of the circle, so the shares add up to 1). Two rim points are in the same
// region exactly when no chord separates them, and a new chord crosses no old
// chord exactly when its two ends land in the same region. So:
//
//   P(next chord is clear) = Σ L²        (both ends in one region)
//
// Drawn literally as the "pairs square": a point (first end, second end) of
// the unit square, with the rim unrolled region by region along each axis.
// The clear pairs are the squares of side L on the diagonal, so their total
// area is Σ L², and a chord's dot lands in a square exactly when it is clear.
//
// Staged reveal. The first end lands in region r with chance L_r; the chord
// is then clear exactly when the second end lands on r's arcs, chance L_r,
// drawn as those arcs glowing green on the rim (and as the green part of r's
// column in the pairs square).
//
// Pricing (per-step fair factor, in two stages). With cash-out V before a chord:
//   after the first end lands in r:   V · L_r / Σ L²
//   after the second end lands clear: V / Σ L²      (and 0 if it crosses)
// Both stages are fair bets: Σ_r L_r · (V L_r / Σ L²) = V, and
// L_r · (V / Σ L²) = V L_r / Σ L². So the cash-out is a martingale starting at
// RTP and, by optional stopping, every way of playing returns exactly RTP.
// The only player choice, whether to pause between a chord's two ends, adds
// or removes checkpoints: a stopping rule, so it cannot change the value.
//
// Max win. With j regions, Cauchy–Schwarz gives Σ L² ≥ 1/j, so chord j
// (drawn onto j regions) multiplies the cash-out by at most j, and a
// mid-chord value V L_r / Σ L² never exceeds V / Σ L². After N chords the
// cash-out is at most RTP · N!. Every factor is bounded, so no cap is needed.
//
// The theorem. The 2N ends of N random chords are in uniformly random order
// around the circle, so their pairing is a uniform perfect matching of 2N
// points: (2N − 1)!! of them, Catalan(N) non-crossing. Hence
//
//   P(N chords, none crossing) = Catalan(N) / (2N − 1)!! = 2^N / (N + 1)!
//
// and, given k − 1 clear chords, chord k is clear with average chance
// 2 / (k + 1). Within a region of share L the chords that land there behave
// like chords of a circle of circumference L (scale invariance), which gives
// the exact live chance of finishing via an exponential generating function
// (finishChance below). It is shown, not used for pricing.
//
// Tie rule: an end exactly on another chord's end counts as being on that
// chord's clockwise side (half-open arcs [a, b)). Ties have probability ~2^-32.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Chords to draw. The round auto-cashes when the last one lands clear. */
export const TARGETS = [3, 4, 5, 6, 8] as const;
export type Target = (typeof TARGETS)[number];

/** Where the round pauses: after every end (two checkpoints per chord) or only between chords. */
export const PACES = ['end', 'chord'] as const;
export type Pace = (typeof PACES)[number];

export const VOLATILITY: Record<Volatility, { target: Target }> = {
  low: { target: 3 },
  medium: { target: 4 },
  high: { target: 6 },
  extreme: { target: 8 },
};

export interface Chord {
  /** First end. */
  a: number;
  /** Second end. */
  b: number;
}

export interface Arc {
  /** Start position, as a fraction of a turn clockwise from the top. */
  start: number;
  length: number;
}

export const mod1 = (x: number) => ((x % 1) + 1) % 1;

/** Whether p lies on the half-open clockwise arc [start, start + length). */
export const onArc = (p: number, start: number, length: number) => mod1(p - start) < length;

/** Whether chord c separates rim points x and y (exactly one is on its clockwise side). */
export function separates(c: Chord, x: number, y: number): boolean {
  const len = mod1(c.b - c.a);
  return onArc(x, c.a, len) !== onArc(y, c.a, len);
}

/** Two chords cross exactly when their ends interleave around the rim. */
export const crosses = (c: Chord, d: Chord) => separates(c, d.a, d.b);

/** The side of every chord a rim point is on, as a bitmask. Same mask = same region. */
export function signature(chords: readonly Chord[], p: number): number {
  let s = 0;
  for (let j = 0; j < chords.length; j++) {
    const c = chords[j];
    if (onArc(p, c.a, mod1(c.b - c.a))) s |= 1 << j;
  }
  return s;
}

export interface Face {
  /** Side mask shared by every rim point of the face. */
  sig: number;
  /** The face's rim arcs, in boundary order: arc, chord, arc, chord, … */
  arcs: Arc[];
  /** Total rim share. */
  length: number;
}

/**
 * The regions of a set of non-crossing chords. Walk the boundary: follow a rim
 * arc clockwise to a chord end, cross the chord to its other end, and carry on
 * clockwise from there until the walk closes.
 */
export function faces(chords: readonly Chord[]): Face[] {
  if (chords.length === 0) return [{ sig: 0, arcs: [{ start: 0, length: 1 }], length: 1 }];
  const ends = chords.flatMap((c, j) => [{ p: mod1(c.a), j }, { p: mod1(c.b), j }]).sort((u, v) => u.p - v.p);
  const n = ends.length;
  const partner = ends.map((e, i) => ends.findIndex((f, k) => k !== i && f.j === e.j));
  const seen = new Array<boolean>(n).fill(false);
  const out: Face[] = [];
  for (let i0 = 0; i0 < n; i0++) {
    if (seen[i0]) continue;
    const arcs: Arc[] = [];
    for (let i = i0; !seen[i]; i = partner[(i + 1) % n]) {
      seen[i] = true;
      const next = ends[(i + 1) % n].p;
      arcs.push({ start: ends[i].p, length: i + 1 < n ? next - ends[i].p : 1 - ends[i].p + next });
    }
    const longest = arcs.reduce((m, a) => (a.length > m.length ? a : m));
    out.push({ sig: signature(chords, longest.start + longest.length / 2), arcs, length: arcs.reduce((s, a) => s + a.length, 0) });
  }
  return out;
}

export interface Region extends Face {
  /** Identity, stable for the round: 0 is the first region, chord k makes slot k. */
  slot: number;
  /** Display colour (0–8), stable for the round; neighbours get different hue families (tone % 3). */
  tone: number;
}

/** Colours available to regions: three hue families, interleaved. */
export const TONES = 9;

const REP0 = 0.5 + Math.SQRT2 / 1000;
const regionCache = new WeakMap<readonly Chord[], Region[]>();
const bitCount = (x: number) => {
  let c = 0;
  for (; x; x &= x - 1) c++;
  return c;
};

/**
 * The regions in a stable display order: when chord k splits a region, the
 * half holding the old region's marker keeps its colour and the other half
 * (slot k) is listed right after it, with a colour unlike its neighbours'
 * (two regions are neighbours when their side masks differ in one chord).
 */
export function regions(chords: readonly Chord[]): Region[] {
  const hit = regionCache.get(chords);
  if (hit) return hit;
  const keys: { rep: number; slot: number; tone: number }[] = [{ rep: REP0, slot: 0, tone: 0 }];
  for (let k = 1; k <= chords.length; k++) {
    const prev = chords.slice(0, k - 1);
    const cur = chords.slice(0, k);
    const c = chords[k - 1];
    const home = signature(prev, c.a);
    let parent = keys.findIndex((key) => signature(prev, key.rep) === home);
    if (parent < 0) parent = 0;
    const keep = signature(cur, keys[parent].rep);
    const bit = 1 << (k - 1);
    const born = faces(cur).find((f) => (f.sig & ~bit) === (keep & ~bit) && f.sig !== keep);
    if (!born) continue;
    const longest = born.arcs.reduce((m, a) => (a.length > m.length ? a : m));
    const near = new Set(keys.filter((key) => bitCount(signature(cur, key.rep) ^ born.sig) === 1).map((key) => key.tone % 3));
    const used = new Set(keys.map((key) => key.tone));
    const free = Array.from({ length: TONES }, (_, t) => t).filter((t) => !used.has(t));
    const tone = free.find((t) => !near.has(t % 3)) ?? free.find((t) => t % 3 !== keys[parent].tone % 3) ?? free[0] ?? k % TONES;
    keys.splice(parent + 1, 0, { rep: mod1(longest.start + longest.length / 2), slot: k, tone });
  }
  const fs = faces(chords);
  const used = new Set<Face>();
  const out: Region[] = [];
  for (const key of keys) {
    const s = signature(chords, key.rep);
    const f = fs.find((x) => x.sig === s && !used.has(x));
    if (!f) continue;
    used.add(f);
    out.push({ ...f, slot: key.slot, tone: key.tone });
  }
  // Degenerate ties only: keep every face on screen.
  for (const f of fs) if (!used.has(f)) out.push({ ...f, slot: out.length, tone: out.length % TONES });
  regionCache.set(chords, out);
  return out;
}

/** Index (in display order) of the region a rim point lands in. */
export function regionIndex(rs: readonly Region[], chords: readonly Chord[], p: number): number {
  const s = signature(chords, p);
  return Math.max(
    0,
    rs.findIndex((r) => r.sig === s),
  );
}

/** The region a rim point lands in. */
export const regionAt = (chords: readonly Chord[], p: number): Region => {
  const rs = regions(chords);
  return rs[regionIndex(rs, chords, p)];
};

/** Chance the next chord lands clear: both ends in one region, Σ L². */
export const clearChance = (rs: readonly { length: number }[]) => rs.reduce((s, r) => s + r.length ** 2, 0);

/** Whether a new chord from x to y crosses none of the chords. */
export const isClear = (chords: readonly Chord[], x: number, y: number) => chords.every((c) => !separates(c, x, y));

/** Cash-out once the first end has landed in a region of share L (S = Σ L² before the chord). */
export const afterFirstEnd = (cash: number, S: number, L: number) => (cash * L) / S;
/** Cash-out once the chord has landed clear. */
export const afterClearChord = (cash: number, S: number) => cash / S;

// ---------- The pairs square ----------

/** Where each region's block starts on the unrolled rim (display order). */
export function blockStarts(rs: readonly { length: number }[]): number[] {
  const out: number[] = [];
  let u = 0;
  for (const r of rs) {
    out.push(u);
    u += r.length;
  }
  return out;
}

/**
 * Where a rim point sits when the region's arcs are laid end to end (in
 * boundary order): a number in [0, L).
 */
export function offsetIn(region: Face, p: number): number {
  let before = 0;
  for (const a of region.arcs) {
    const d = mod1(p - a.start);
    if (d < a.length) return before + d;
    before += a.length;
  }
  return Math.min(before, region.length) * 0.999999;
}

/**
 * Where a rim point sits on the unrolled rim: the regions laid end to end in
 * display order, each region's arcs in boundary order. A measure-preserving
 * map of the circle onto [0, 1), so a uniform end gives a uniform coordinate.
 */
export function unroll(rs: readonly Region[], chords: readonly Chord[], p: number): number {
  const i = regionIndex(rs, chords, p);
  return Math.min(blockStarts(rs)[i] + offsetIn(rs[i], p), 1 - 1e-12);
}

/**
 * A chord's dot in the pairs square: (first end, second end), both unrolled.
 * It lands inside one of the diagonal squares exactly when the chord is clear.
 */
export function dart(rs: readonly Region[], chords: readonly Chord[], x: number, y: number | null) {
  return { u: unroll(rs, chords, x), v: y === null ? null : unroll(rs, chords, y), region: regionIndex(rs, chords, x) };
}

/** Whether a dot (u, v) of the pairs square lies in a diagonal block. */
export function inBlock(rs: readonly { length: number }[], u: number, v: number): boolean {
  const starts = blockStarts(rs);
  return rs.some((r, i) => u >= starts[i] && u < starts[i] + r.length && v >= starts[i] && v < starts[i] + r.length);
}

// ---------- Exact chances ----------

const FACT = [1];
for (let i = 1; i <= 20; i++) FACT[i] = FACT[i - 1] * i;

/** P(n random chords are pairwise non-crossing) = Catalan(n) / (2n − 1)!! = 2^n / (n + 1)!. */
export const allClear = (n: number) => 2 ** n / FACT[n + 1];

export const catalan = (n: number) => FACT[2 * n] / (FACT[n] * FACT[n + 1]);
export const doubleFactorial = (n: number) => {
  let p = 1;
  for (let k = n; k > 1; k -= 2) p *= k;
  return p;
};

/** Average chance chord k is clear, given the k − 1 before it were: 2 / (k + 1). */
export const typicalClear = (k: number) => 2 / (k + 1);

/** Polynomial product, truncated after degree k. */
function mul(p: number[], q: number[], k: number): number[] {
  const out = new Array<number>(k + 1).fill(0);
  for (let i = 0; i <= k; i++) {
    if (!p[i]) continue;
    for (let j = 0; i + j <= k; j++) out[i + j] += p[i] * (q[j] ?? 0);
  }
  return out;
}

/** g(L² z) = Σ_m allClear(m) (L² z)^m / m!, the EGF of one region of share L. */
const regionSeries = (L: number, k: number) => Array.from({ length: k + 1 }, (_, m) => (allClear(m) * L ** (2 * m)) / FACT[m]);

/**
 * Exact chance that k more random chords all land clear, given regions of
 * shares `lengths`. Each chord falls inside region r with chance L_r² (else it
 * crosses something); the m chords inside a region are non-crossing with
 * chance allClear(m), independently of the other regions. So
 *   P = k! [z^k] Π_r g(L_r² z).
 */
export function finishChance(lengths: readonly number[], k: number): number {
  if (k <= 0) return 1;
  let poly = [1];
  for (const L of lengths) poly = mul(poly, regionSeries(L, k), k);
  return FACT[k] * poly[k];
}

/**
 * The same, after the first end of the next chord has landed in region r
 * (k chords left, counting this one):
 *   P = (k − 1)! [z^(k−1)] L_r g'(L_r² z) Π_{s≠r} g(L_s² z).
 */
export function finishChanceMid(lengths: readonly number[], r: number, k: number): number {
  const L = lengths[r];
  const deriv = Array.from({ length: k }, (_, m) => (allClear(m + 1) * L ** (2 * m)) / FACT[m]);
  let poly = deriv;
  lengths.forEach((Ls, s) => {
    if (s !== r) poly = mul(poly, regionSeries(Ls, k - 1), k - 1);
  });
  return FACT[k - 1] * L * (poly[k - 1] ?? 0);
}

/**
 * Upper bound on any reachable cash-out: chord j multiplies it by at most j
 * (Cauchy–Schwarz on j regions), the first chord is free, and mid-chord
 * values never exceed the value after the chord lands.
 */
export const maxMultiplier = (target: Target) => RTP * FACT[target];

export const MAX_MULTIPLIER = Math.max(...TARGETS.map(maxMultiplier));

export function volatilityOf(target: Target): Volatility {
  const p = allClear(target);
  return p > 0.3 ? 'low' : p > 0.08 ? 'medium' : p > 0.005 ? 'high' : 'extreme';
}
