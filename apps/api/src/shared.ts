// Types and helpers shared by the ratings API and the platform client.
// Keep this file free of imports so both can use it directly.

export interface RatingSummary {
  /** Mean stars, 0 when unrated. */
  average: number;
  count: number;
}

export interface RatingDetail extends RatingSummary {
  /** Number of 1..5 star ratings; index 0 is 1 star. */
  distribution: number[];
  /** This voter's stars, or null if they haven't rated the game. */
  mine: number | null;
}

export interface RatingInput {
  voterId: string;
  stars: number;
}

export function summarize(distribution: number[]): RatingSummary {
  let count = 0;
  let total = 0;
  distribution.forEach((n, i) => {
    count += n;
    total += n * (i + 1);
  });
  return { average: count ? total / count : 0, count };
}
