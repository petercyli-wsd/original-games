import { FACETS, type Review } from '@originals/api/shared';
import type { ReactNode } from 'react';

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** One person's review: stars, name, date, facet scores and comment. `game` adds a link above it in feeds. */
export function ReviewItem({ review, author, game }: { review: Review; author?: string; game?: ReactNode }) {
  const scored = FACETS.filter((f) => review.facets?.[f.key]);
  return (
    <li className="review-item">
      {game}
      <div className="review-meta">
        <span className="review-stars" aria-label={`${review.stars} out of 5`}>
          {'★'.repeat(review.stars)}
          <span>{'★'.repeat(5 - review.stars)}</span>
        </span>
        <span className="review-author">{author ?? (review.reviewer || 'Anonymous')}</span>
        <span>{when(review.updatedAt)}</span>
      </div>
      {scored.length > 0 && (
        <div className="review-facets">
          {scored.map((f) => (
            <span key={f.key} title={f.question}>
              {f.label} {review.facets[f.key]}
            </span>
          ))}
        </div>
      )}
      {review.comment ? <p>{review.comment}</p> : <p className="review-empty">Scored without a written review.</p>}
    </li>
  );
}

/** How many ratings each star level got, as bars. */
export function RatingBars({ distribution }: { distribution: number[] }) {
  const most = Math.max(1, ...distribution);
  return (
    <dl className="rating-bars">
      {[5, 4, 3, 2, 1].map((s) => (
        <div key={s}>
          <dt>{s}★</dt>
          <dd>{distribution[s - 1] > 0 && <span style={{ width: `${(distribution[s - 1] / most) * 100}%` }} />}</dd>
          <dd className="rating-bar-count">{distribution[s - 1]}</dd>
        </div>
      ))}
    </dl>
  );
}
