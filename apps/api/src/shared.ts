// Types and helpers shared by the ratings API and the platform client.
// Keep this file free of imports so both can use it directly.

export interface RatingSummary {
  /** Mean stars, 0 when unrated. */
  average: number;
  count: number;
}

/** A summary plus this voter's own stars, when the request names a voter. */
export interface RatingRow extends RatingSummary {
  mine?: number | null;
}

/**
 * Ranking score: the average pulled toward 3 stars by two phantom votes, so a
 * single 5-star rating doesn't outrank a game with many 4.5s.
 */
export function rankScore({ average, count }: RatingSummary): number {
  const PRIOR_MEAN = 3;
  const PRIOR_VOTES = 2;
  return (average * count + PRIOR_MEAN * PRIOR_VOTES) / (count + PRIOR_VOTES);
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
