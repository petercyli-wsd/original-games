// Darts (the classic dart-board game): one dart lands uniformly at random on a
// disc, and the zone it lands in pays that zone's multiplier. The dart never
// misses: every throw returns something (at least 0.1×).
//
// The board has six kinds of zone, centre outwards: a bullseye, a band of 18
// equal angular cells (each one low, mid or high), a light ring (a near miss)
// and a dark ring. Area is chance, because a uniform point on a disc of radius
// R has P(r < ρ) = ρ² / R². So the landing point is drawn as
//   s = floor(u1 × T)   the squared radius in whole area units, r = R·√(s/T)
//   θ = 2π·u2           the angle, and the cell is floor(18·u2) (0–17)
// and the zone is read straight off s (and the cell, inside the band).
//
// The board is T = 120,000 units, so every zone is a whole number of units and
// every difficulty returns exactly 98%: Σ units × cents = 0.98 × T × 100
// = 11,760,000 (checked as integers in the tests). Difficulty changes the
// geometry (the bullseye shrinks, the cells shrink) and the multipliers.
//
//   zone     s range (half-open, a boundary belongs to the outer zone)
//   bull     [0, B)
//   band     [B, B + 18c), cell k has c units, split by cell index
//   light    [B + 18c, B + 18c + L)
//   dark     [B + 18c + L, T)

export const RTP = 0.98;

/** Board area in whole units; radius is BOARD_R·√(s/T). */
export const TOTAL_UNITS = 120_000;
export const BOARD_R = 100;
export const CELLS = 18;

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const DIFFICULTY_NAMES: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
export const DIFFICULTY_VOL = { easy: 'low', medium: 'medium', hard: 'high', expert: 'extreme' } as const;

/** Zones from the outside in; low, mid and high are the coloured cells. */
export const ZONES = ['dark', 'light', 'low', 'mid', 'high', 'bull'] as const;
export type Zone = (typeof ZONES)[number];
export const ZONE_NAMES: Record<Zone, string> = {
  dark: 'Outer ring',
  light: 'Near ring',
  low: 'Low cell',
  mid: 'Mid cell',
  high: 'High cell',
  bull: 'Bullseye',
};

interface Table {
  /** Bullseye units. */
  bull: number;
  /** Units in each of the 18 cells. */
  cell: number;
  /** Cells that are low, mid, high (sum 18). */
  cells: readonly [number, number, number];
  /** Light ring units. */
  light: number;
  /** Multipliers in whole cents. */
  cents: Record<Zone, number>;
}

export const TABLES: Record<Difficulty, Table> = {
  easy: { bull: 1875, cell: 1654, cells: [9, 5, 4], light: 31182, cents: { dark: 50, light: 80, low: 120, mid: 150, high: 270, bull: 850 } },
  medium: { bull: 1200, cell: 999, cells: [9, 5, 4], light: 34620, cents: { dark: 40, light: 60, low: 130, mid: 310, high: 600, bull: 1600 } },
  hard: { bull: 432, cell: 845, cells: [9, 6, 3], light: 33133, cents: { dark: 20, light: 50, low: 250, mid: 360, high: 880, bull: 6300 } },
  expert: { bull: 48, cell: 390, cells: [12, 4, 2], light: 30267, cents: { dark: 10, light: 50, low: 480, mid: 960, high: 4200, bull: 50000 } },
};

/** Whole units of each zone. */
export function unitsOf(d: Difficulty): Record<Zone, number> {
  const t = TABLES[d];
  const bandUnits = CELLS * t.cell;
  return {
    bull: t.bull,
    low: t.cells[0] * t.cell,
    mid: t.cells[1] * t.cell,
    high: t.cells[2] * t.cell,
    light: t.light,
    dark: TOTAL_UNITS - t.bull - bandUnits - t.light,
  };
}

/** Squared-radius boundaries (in units): bull ends at b0, band at b1, light ring at b2. */
export function bounds(d: Difficulty) {
  const t = TABLES[d];
  const b0 = t.bull;
  const b1 = b0 + CELLS * t.cell;
  const b2 = b1 + t.light;
  return { b0, b1, b2 };
}

/** Board radius (0–100) at a squared-radius boundary s. */
export const radiusAt = (s: number) => BOARD_R * Math.sqrt(s / TOTAL_UNITS);

export const payout = (d: Difficulty, z: Zone) => TABLES[d].cents[z] / 100;

/** Exact chance of a zone: its units over the board's units. */
export const zoneChance = (d: Difficulty, z: Zone) => unitsOf(d)[z] / TOTAL_UNITS;

/** Σ units × cents: exactly 0.98 × 120,000 × 100 = 11,760,000 on every table. */
export const weightedCents = (d: Difficulty) => ZONES.reduce((s, z) => s + unitsOf(d)[z] * TABLES[d].cents[z], 0);

export const rtpOf = (d: Difficulty) => weightedCents(d) / (TOTAL_UNITS * 100);

/** Chance the throw pays more than the stake. */
export const winChance = (d: Difficulty) => ZONES.reduce((s, z) => s + (payout(d, z) > 1 ? zoneChance(d, z) : 0), 0);

export const topPrize = (d: Difficulty) => Math.max(...ZONES.map((z) => payout(d, z)));
export const MAX_MULTIPLIER = Math.max(...DIFFICULTIES.map(topPrize));

/**
 * Which of the 18 cells are low, mid or high: high cells evenly spread first,
 * then mid cells evenly over what is left. Purely visual, since every cell has
 * the same area, but the paid cell is the drawn cell.
 */
export function cellPattern(d: Difficulty): ('low' | 'mid' | 'high')[] {
  const [, nMid, nHigh] = TABLES[d].cells;
  const out: ('low' | 'mid' | 'high')[] = Array(CELLS).fill('low');
  const place = (n: number, tier: 'mid' | 'high') => {
    const free = out.map((t, i) => (t === 'low' ? i : -1)).filter((i) => i >= 0);
    for (let k = 0; k < n; k++) out[free[Math.floor(((k + 0.5) * free.length) / n)]] = tier;
  };
  place(nHigh, 'high');
  place(nMid, 'mid');
  return out;
}

/** Zone for a squared-radius unit s (0 ≤ s < T) and a cell index. Boundaries go outwards. */
export function zoneAt(d: Difficulty, s: number, cell: number): Zone {
  const { b0, b1, b2 } = bounds(d);
  if (s < b0) return 'bull';
  if (s < b1) return cellPattern(d)[cell];
  return s < b2 ? 'light' : 'dark';
}

export interface Throw {
  zone: Zone;
  /** Squared-radius unit and cell that decided the zone. */
  s: number;
  cell: number;
  /** Landing point in board units, centre (0, 0), y down. */
  x: number;
  y: number;
  multiplier: number;
}

/** One throw from two uniforms: u1 sets the squared radius, u2 the angle and the cell. */
export function throwFrom(u1: number, u2: number, d: Difficulty): Throw {
  const s = Math.min(TOTAL_UNITS - 1, Math.floor(u1 * TOTAL_UNITS));
  const cell = Math.min(CELLS - 1, Math.floor(CELLS * u2));
  const zone = zoneAt(d, s, cell);
  const r = BOARD_R * Math.sqrt(u1);
  const a = 2 * Math.PI * u2;
  return { zone, s, cell, x: r * Math.cos(a), y: r * Math.sin(a), multiplier: payout(d, zone) };
}

/** One full round: exactly two random draws. */
export const throwDart = (next: () => number, d: Difficulty) => throwFrom(next(), next(), d);
