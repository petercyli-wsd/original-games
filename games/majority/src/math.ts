// Majority: the maths.
//
// A map of n regions (12–18). Region i carries an integer weight wᵢ (the
// weights sum to 100) and goes Blue with probability pᵢ, independently of
// every other region. The regions are called one at a time in a uniformly
// random order. The player backs a side (Blue or Red) to reach a line: a
// majority (51+) or a landslide (65+). Blue's final total is
//
//   S = Σᵢ wᵢ·Xᵢ,  Xᵢ ~ Bernoulli(pᵢ) independent,
//
// and the bet "Blue reaches L" wins iff S ≥ L; "Red reaches L" wins iff
// 100 − S ≥ L. A total of exactly 50 is a hung map: neither majority wins.
//
// Live odds. After some regions are called, Blue has B locked and the rest is
// U = 100 − B − R. The final total is B + T, where T is Blue's share of the
// uncalled regions. T has an exact distribution by subset-sum convolution:
//
//   D₀ = δ₀,  Dₖ(t) = (1 − pₖ)·Dₖ₋₁(t) + pₖ·Dₖ₋₁(t − wₖ),
//
// over the uncalled regions (at most 18 × 101 cells). P(win | state) is the
// mass of D on the winning totals. The order of the calls is independent of
// the colours, so announcing which region is called next does not change the
// odds, and the odds are a martingale call by call:
//
//   P(now) = pⱼ·P(j goes Blue) + (1 − pⱼ)·P(j goes Red)  for the next region j.
//
// Pricing (contract pattern 1, fixed prize): prize = RTP / P(win at start),
// cash-out = prize × P(win | state), a martingale from RTP, so every stopping
// rule returns RTP exactly. Switching side or line at a checkpoint keeps the
// cash-out and relocks the prize at cash / P(new bet); switches that would
// push the prize over MAX_WIN, or onto a decided bet, are refused.

export const RTP = 0.99;
export const MAX_WIN = 1000;
export const MAX_MULTIPLIER = MAX_WIN;
export const TOTAL = 100;

export type Side = 'blue' | 'red';
export type Line = 51 | 65;
export type MapKey = 'heartland' | 'tossup' | 'faultline';
/** A called region's colour, or null while uncalled. */
export type Call = 'B' | 'R' | null;

export interface Bet {
  side: Side;
  line: Line;
}

export interface Region {
  id: string;
  /** Offset hex coordinates (pointy-top, odd rows shifted right). */
  col: number;
  row: number;
  /** Weight (seats); the map's weights sum to 100. */
  w: number;
  /** Chance it goes Blue. */
  p: number;
}

export interface MapDef {
  key: MapKey;
  label: string;
  blurb: string;
  regions: Region[];
}

export const SIDES: readonly Side[] = ['blue', 'red'];
export const LINES: readonly Line[] = [51, 65];
export const SIDE_LABEL: Record<Side, string> = { blue: 'Blue', red: 'Red' };
export const LINE_LABEL: Record<Line, string> = { 51: 'Majority', 65: 'Landslide' };

/** Builds a map from rows of [col, weight, pBlue]; ids run A, B, C… in reading order. */
function build(key: MapKey, label: string, blurb: string, rows: [number, number, number][][]): MapDef {
  const regions: Region[] = [];
  rows.forEach((cells, row) =>
    cells.forEach(([col, w, p]) => regions.push({ id: String.fromCharCode(65 + regions.length), col, row, w, p })),
  );
  return { key, label, blurb, regions };
}

export const MAPS: Record<MapKey, MapDef> = {
  heartland: build('heartland', 'Heartland', 'Leans Blue: 16 regions, most of them blue-ish.', [
    [[1, 6, 0.7], [2, 9, 0.65], [3, 5, 0.45], [4, 4, 0.75]],
    [[0, 4, 0.8], [1, 7, 0.6], [2, 12, 0.55], [3, 6, 0.5], [4, 5, 0.7]],
    [[0, 5, 0.65], [1, 8, 0.45], [2, 6, 0.75], [3, 7, 0.6], [4, 4, 0.5]],
    [[1, 4, 0.85], [2, 8, 0.45]],
  ]),
  tossup: build('tossup', 'Toss-up', 'Dead even: 18 regions, every one a coin flip or close.', [
    [[1, 5, 0.55], [2, 6, 0.45], [3, 4, 0.6], [4, 3, 0.4]],
    [[0, 3, 0.65], [1, 7, 0.5], [2, 11, 0.5], [3, 6, 0.35], [4, 5, 0.55], [5, 3, 0.5]],
    [[0, 4, 0.4], [1, 6, 0.6], [2, 9, 0.5], [3, 7, 0.45], [4, 5, 0.6]],
    [[1, 4, 0.5], [2, 5, 0.55], [3, 7, 0.45]],
  ]),
  faultline: build('faultline', 'Fault Line', 'Polarised, leans Red: safe regions, and two giant swing regions decide it.', [
    [[0, 4, 0.9], [1, 6, 0.12], [2, 5, 0.88], [3, 4, 0.1]],
    [[0, 7, 0.9], [1, 15, 0.5], [2, 8, 0.08], [3, 6, 0.85], [4, 3, 0.1]],
    [[0, 5, 0.1], [1, 7, 0.88], [2, 13, 0.5], [3, 8, 0.12]],
    [[1, 9, 0.1]],
  ]),
};
export const MAP_KEYS: readonly MapKey[] = ['heartland', 'tossup', 'faultline'];

export const emptyCalls = (m: MapDef): Call[] => m.regions.map(() => null);

export interface Tally {
  blue: number;
  red: number;
  /** Weight still to be called. */
  left: number;
  called: number;
}

export function tally(m: MapDef, calls: readonly Call[]): Tally {
  let blue = 0;
  let red = 0;
  let called = 0;
  m.regions.forEach((r, i) => {
    if (calls[i] === 'B') blue += r.w;
    else if (calls[i] === 'R') red += r.w;
    if (calls[i] !== null) called++;
  });
  return { blue, red, left: TOTAL - blue - red, called };
}

/** Whether Blue finishing on `blueTotal` wins the bet. */
export function winsAt(blueTotal: number, bet: Bet): boolean {
  return bet.side === 'blue' ? blueTotal >= bet.line : TOTAL - blueTotal >= bet.line;
}

/** Exact distribution of Blue's final total (index 0..100) given the calls so far. */
export function finalDist(m: MapDef, calls: readonly Call[]): Float64Array {
  const { blue } = tally(m, calls);
  // In-place 0/1-knapsack style convolution over T, Blue's share of the uncalled weight.
  const d = new Float64Array(TOTAL + 1);
  d[0] = 1;
  let hi = 0;
  m.regions.forEach((r, i) => {
    if (calls[i] !== null) return;
    for (let t = hi; t >= 0; t--) {
      const v = d[t];
      if (v === 0) continue;
      d[t + r.w] += r.p * v;
      d[t] = (1 - r.p) * v;
    }
    hi += r.w;
  });
  const out = new Float64Array(TOTAL + 1);
  for (let t = 0; t <= hi; t++) out[blue + t] = d[t];
  return out;
}

/** 'win' / 'lose' once no uncalled region can change the bet, else null. Exact integer logic. */
export function decided(m: MapDef, calls: readonly Call[], bet: Bet): 'win' | 'lose' | null {
  const { blue, left } = tally(m, calls);
  const lo = blue;
  const hi = blue + left;
  if (winsAt(lo, bet) && winsAt(hi, bet)) return 'win'; // the winning set is an interval, so both ends suffice
  if (bet.side === 'blue' ? hi < bet.line : TOTAL - lo < bet.line) return 'lose';
  return null;
}

// Cache of the four bets' chances per (map, calls). States repeat a lot (the
// eval replays many rounds), and the DP is the only real work per call. The
// key is the calls read as a base-3 number, then the map as the last digit (3^19 < 2^53).
const cache = new Map<number, Float64Array>();
const betIndex = (bet: Bet) => (bet.side === 'blue' ? 0 : 2) + (bet.line === 51 ? 0 : 1);
const MAP_OFFSET: Record<MapKey, number> = { heartland: 0, tossup: 1, faultline: 2 };

/** The exact chance the bet wins, given the calls so far. */
export function winChance(m: MapDef, calls: readonly Call[], bet: Bet): number {
  const dec = decided(m, calls, bet);
  if (dec) return dec === 'win' ? 1 : 0;
  let key = 0;
  for (let i = calls.length - 1; i >= 0; i--) key = key * 3 + (calls[i] === null ? 0 : calls[i] === 'B' ? 1 : 2);
  key = key * 3 + MAP_OFFSET[m.key];
  let row = cache.get(key);
  if (!row) {
    const d = finalDist(m, calls);
    row = new Float64Array(4);
    for (const side of SIDES)
      for (const line of LINES) {
        let p = 0;
        for (let t = 0; t <= TOTAL; t++) if (d[t] > 0 && winsAt(t, { side, line })) p += d[t];
        row[betIndex({ side, line })] = p;
      }
    if (cache.size > 300_000) cache.clear();
    cache.set(key, row);
  }
  return row[betIndex(bet)];
}

export const startChance = (key: MapKey, bet: Bet) => winChance(MAPS[key], emptyCalls(MAPS[key]), bet);
export const startPrize = (key: MapKey, bet: Bet) => RTP / startChance(key, bet);

/** The largest prize any fresh bet can lock (must sit under the cap). */
export function maxStartPrize(): number {
  let max = 0;
  for (const k of MAP_KEYS) for (const side of SIDES) for (const line of LINES) max = Math.max(max, startPrize(k, { side, line }));
  return max;
}

export interface NextOdds {
  /** The region called next. */
  index: number;
  /** Chance it goes Blue. */
  pBlue: number;
  /** Your odds if it goes Blue / Red. */
  ifBlue: number;
  ifRed: number;
}

/** What calling region j would do to your odds. pBlue·ifBlue + (1 − pBlue)·ifRed equals the odds now. */
export function nextOdds(m: MapDef, calls: readonly Call[], j: number, bet: Bet): NextOdds {
  const withCall = (c: Call) => {
    const next = calls.slice();
    next[j] = c;
    return winChance(m, next, bet);
  };
  return { index: j, pBlue: m.regions[j].p, ifBlue: withCall('B'), ifRed: withCall('R') };
}

/** Calls region j: Blue iff u < pⱼ. */
export const callRegion = (u: number, p: number): Call => (u < p ? 'B' : 'R');

/**
 * Switching bets at a checkpoint: the cash-out is kept and the prize relocks
 * at cash / P(new). Null when the new bet is already decided or the prize
 * would exceed the cap.
 */
export function relock(cash: number, m: MapDef, calls: readonly Call[], bet: Bet): number | null {
  if (decided(m, calls, bet)) return null;
  const p = winChance(m, calls, bet);
  const prize = cash / p;
  return prize > MAX_WIN ? null : prize;
}

export type Vol = 'low' | 'medium' | 'high' | 'extreme';
export function volatilityOf(p0: number): Vol {
  return p0 >= 0.5 ? 'low' : p0 >= 0.2 ? 'medium' : p0 >= 0.03 ? 'high' : 'extreme';
}

/** Pixel centre of an offset-hex cell, for a hex of circumradius r. */
export function hexCentre(col: number, row: number, r: number): { x: number; y: number } {
  const w = Math.sqrt(3) * r;
  return { x: col * w + (row % 2 === 1 ? w / 2 : 0), y: row * 1.5 * r };
}
