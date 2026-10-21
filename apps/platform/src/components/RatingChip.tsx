import { useStore } from '@originals/game-sdk/react';
import { ratingSummaries, ratingsEnabled } from '../lib/ratings';

/** "★ 4.3 · 12" for a lobby tile; nothing until the game has a rating. */
export function RatingChip({ gameId }: { gameId: string }) {
  const summary = useStore(ratingSummaries)[gameId];
  if (!ratingsEnabled || !summary?.count) return null;
  return (
    <span className="rating-chip" title={`${summary.average.toFixed(2)} average from ${summary.count} ratings`}>
      ★ {summary.average.toFixed(1)}
      <span className="rating-chip-count">· {summary.count}</span>
    </span>
  );
}
