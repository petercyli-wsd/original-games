// Darts (the classic from Stake): one dart lands uniformly at random on the
// board disc, and the ring it lands in pays that ring's multiplier.
//
// Why the area is the odds. A uniform point on a disc of radius R has
// P(r < ρ) = ρ² / R², so ring k (between radii a and b) is hit with chance
// (b² − a²) / R², its share of the board's area. The landing point is drawn
// as r = R·√u₁, θ = 2π·u₂ (u₁, u₂ uniform), which is exactly uniform on the
// disc, and the zone is read straight off u₁ = r²/R².
//
// The board (R = 100) has seven zones whose squared radii are whole numbers,
// so every chance is an exact multiple of 1/10,000 (and of 1/400):
//
//   zone       radii      area units /10,000   chance    weight /400
//   bullseye   0 – 5          25               0.25%         1
//   bull       5 – 10         75               0.75%         3
//   inner     10 – 45       1925              19.25%        77
//   triple    45 – 50        475               4.75%        19
//   outer     50 – 80       3900              39.00%       156
//   double    80 – 85        825               8.25%        33
//   miss      85 – 100      2775              27.75%       111
//
// Difficulty only changes the multipliers. Each table is in whole cents with
//   Σ weight × cents = 39,600 = 0.99 × 400 × 100,
// so its return is exactly 99% (checked as integers in the tests):
//
//   difficulty  bullseye  bull  inner  triple  outer  double  miss
//   easy           6      2.5    1.4     2      1.2    1.5     0
//   medium        20      8      1.5     4      0.5    2.5     0
//   hard          50     25      1       5      0      3       0
//   expert       200     40      0       4      0      0       0
//
// Tie rule: a point exactly on a boundary belongs to the outer zone (r² < b²
// is inside). Boundaries have probability zero, so this does not move the RTP.

export const RTP = 0.99;

export const BOARD_R = 100;

export const ZONES = ['bullseye', 'bull', 'inner', 'triple', 'outer', 'double', 'miss'] as const;
export type Zone = (typeof ZONES)[number];

/** Outer radius of each zone, centre outwards. */
export const OUTER_R: Record<Zone, number> = { bullseye: 5, bull: 10, inner: 45, triple: 50, outer: 80, double: 85, miss: 100 };

export const INNER_R: Record<Zone, number> = { bullseye: 0, bull: 5, inner: 10, triple: 45, outer: 50, double: 80, miss: 85 };

export const ZONE_NAMES: Record<Zone, string> = {
  bullseye: 'Bullseye',
  bull: 'Bull',
  inner: 'Inner',
  triple: 'Triple',
  outer: 'Outer',
  double: 'Double',
  miss: 'Miss',
};

/** Area of each zone in units of 1/10,000 of the board. */
export const AREA_UNITS: Record<Zone, number> = Object.fromEntries(
  ZONES.map((z) => [z, OUTER_R[z] ** 2 - INNER_R[z] ** 2]),
) as Record<Zone, number>;

export const TOTAL_UNITS = BOARD_R ** 2;

/** Exact chance of landing in a zone: its share of the board's area. */
export const zoneChance = (z: Zone) => AREA_UNITS[z] / TOTAL_UNITS;

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_NAMES: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };

export const DIFFICULTY_VOL = { easy: 'low', medium: 'medium', hard: 'high', expert: 'extreme' } as const;

/** Multipliers in whole cents, per difficulty and zone. */
export const PAY_CENTS: Record<Difficulty, Record<Zone, number>> = {
  easy: { bullseye: 600, bull: 250, inner: 140, triple: 200, outer: 120, double: 150, miss: 0 },
  medium: { bullseye: 2000, bull: 800, inner: 150, triple: 400, outer: 50, double: 250, miss: 0 },
  hard: { bullseye: 5000, bull: 2500, inner: 100, triple: 500, outer: 0, double: 300, miss: 0 },
  expert: { bullseye: 20000, bull: 4000, inner: 0, triple: 400, outer: 0, double: 0, miss: 0 },
};

export const payout = (d: Difficulty, z: Zone) => PAY_CENTS[d][z] / 100;

/** Σ area units × cents: exactly 0.99 × 10,000 × 100 for every table. */
export const weightedCents = (d: Difficulty) => ZONES.reduce((s, z) => s + AREA_UNITS[z] * PAY_CENTS[d][z], 0);

/** The exact return of a table, as a ratio of integers. */
export const rtpOf = (d: Difficulty) => weightedCents(d) / (TOTAL_UNITS * 100);

/** Chance the throw pays more than the stake. */
export const winChance = (d: Difficulty) => ZONES.reduce((s, z) => s + (payout(d, z) > 1 ? zoneChance(z) : 0), 0);

/** Chance the throw pays anything back. */
export const returnChance = (d: Difficulty) => ZONES.reduce((s, z) => s + (payout(d, z) > 0 ? zoneChance(z) : 0), 0);

export const topPrize = (d: Difficulty) => Math.max(...ZONES.map((z) => payout(d, z)));

export const MAX_MULTIPLIER = Math.max(...DIFFICULTIES.map(topPrize));

/** Zone for a squared radius in area units (0 ≤ r² < 10,000). Boundaries go outwards. */
export function zoneAtSq(rSq: number): Zone {
  for (const z of ZONES) if (rSq < OUTER_R[z] ** 2) return z;
  return 'miss';
}

export const zoneAt = (r: number) => zoneAtSq(r * r);

export interface Throw {
  zone: Zone;
  /** Landing point in board units, centre (0, 0), y down. */
  x: number;
  y: number;
  r: number;
  multiplier: number;
}

/** One throw from two uniforms: u1 sets the area fraction r²/R², u2 the angle. */
export function throwFrom(u1: number, u2: number, d: Difficulty): Throw {
  const rSq = u1 * TOTAL_UNITS;
  const zone = zoneAtSq(rSq);
  const r = Math.sqrt(rSq);
  const a = 2 * Math.PI * u2;
  return { zone, x: r * Math.cos(a), y: r * Math.sin(a), r, multiplier: payout(d, zone) };
}

/** One full round: exactly two random draws. */
export const throwDart = (next: () => number, d: Difficulty) => throwFrom(next(), next(), d);

/**
 * Colour tier of each zone on a difficulty: paying zones are ranked by
 * multiplier (top = gold, then pink, violet, sky, lime, teal), partial
 * refunds are "part" and zeros are "zero". The ranking keeps every zone its
 * colour across difficulties until it stops paying.
 */
export const TIER_RANKS = ['top', 'second', 'third', 'fourth', 'fifth', 'sixth'] as const;
export type Tier = 'zero' | 'part' | (typeof TIER_RANKS)[number];

export function tiersFor(d: Difficulty): Record<Zone, Tier> {
  const paying = [...new Set(ZONES.map((z) => payout(d, z)).filter((m) => m >= 1))].sort((a, b) => b - a);
  return Object.fromEntries(
    ZONES.map((z) => {
      const m = payout(d, z);
      return [z, m <= 0 ? 'zero' : m < 1 ? 'part' : TIER_RANKS[Math.min(paying.indexOf(m), TIER_RANKS.length - 1)]];
    }),
  ) as Record<Zone, Tier>;
}
