import { useStore } from '@originals/game-sdk/react';
import type { CSSProperties } from 'react';
import { ratingSummaries, ratingsEnabled, ratingsStatus } from '../lib/ratings';

/**
 * A lobby tile's rating row: five stars filled to the average, the average and
 * vote count, and this browser's own stars. Unrated games say so, so every
 * tile shows where it stands. Hidden only when ratings are switched off.
 */
export function RatingChip({ gameId }: { gameId: string }) {
  const summary = useStore(ratingSummaries)[gameId];
  const status = useStore(ratingsStatus);
  if (!ratingsEnabled) return null;

  if (!summary && (status === 'idle' || status === 'loading')) {
    return <div className="tile-rating loading" aria-hidden="true" />;
  }
  if (!summary && status === 'error') {
    return <div className="tile-rating muted">Ratings unavailable</div>;
  }

  const count = summary?.count ?? 0;
  const average = summary?.average ?? 0;
  const mine = summary?.mine ?? null;
  const label = count
    ? `Rated ${average.toFixed(1)} out of 5 from ${count} ${count === 1 ? 'rating' : 'ratings'}`
    : 'No ratings yet';

  return (
    <div className={'tile-rating' + (count ? '' : ' unrated')} role="img" aria-label={label + (mine ? `; you rated it ${mine}` : '')} title={label}>
      <span className="tile-stars" style={{ '--fill': `${(average / 5) * 100}%` } as CSSProperties} aria-hidden="true">
        <span className="tile-stars-base">★★★★★</span>
        <span className="tile-stars-fill">★★★★★</span>
      </span>
      {count ? (
        <>
          <b>{average.toFixed(1)}</b>
          <span className="tile-rating-count">
            {count} {count === 1 ? 'rating' : 'ratings'}
          </span>
        </>
      ) : (
        <span className="tile-rating-count">No ratings yet</span>
      )}
      {mine ? <span className="tile-rating-mine">You ★{mine}</span> : null}
    </div>
  );
}
