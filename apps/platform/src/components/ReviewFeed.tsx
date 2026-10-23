import type { FeedReview } from '@originals/api/shared';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchFeed } from '../lib/ratings';
import { findGame } from '../registry';
import { Emblem } from './Emblem';
import { ReviewItem } from './ReviewItem';

const ANONYMOUS = 'Anonymous';
const YOU = '__you';

const authorOf = (r: FeedReview) => (r.mine ? `You${r.reviewer ? ` (${r.reviewer})` : ''}` : r.reviewer || ANONYMOUS);

/** The team's latest reviews across every game, filterable by reviewer and to written ones. */
export function ReviewFeed() {
  const [feed, setFeed] = useState<FeedReview[] | null>(null);
  const [error, setError] = useState('');
  // Filters live in the URL like the rest of the page, so Back from a game keeps them.
  const [params, setParams] = useSearchParams();
  const by = params.get('by') ?? '';
  const written = params.get('written') === '1';

  useEffect(() => {
    let cancelled = false;
    fetchFeed()
      .then((f) => !cancelled && setFeed(f))
      .catch(() => !cancelled && setError("Can't reach the ratings server. It can take up to a minute to wake up; try again shortly."));
    return () => {
      cancelled = true;
    };
  }, []);

  const setParam = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const reviewers = useMemo(
    () => [...new Set((feed ?? []).filter((r) => !r.mine).map((r) => r.reviewer || ANONYMOUS))].sort((a, b) => a.localeCompare(b)),
    [feed],
  );
  const hasMine = feed?.some((r) => r.mine) ?? false;

  if (error) return <p className="rankings-banner error">{error}</p>;
  if (!feed) return <p className="rankings-banner">Loading reviews…</p>;

  const shown = feed.filter(
    (r) =>
      (!written || r.comment) &&
      (!by || (by === YOU ? r.mine : !r.mine && (r.reviewer || ANONYMOUS) === by)),
  );

  return (
    <div className="review-feed">
      <div className="rank-controls">
        <div className="feed-filters">
          <select className="feed-select" aria-label="Reviewer" value={by} onChange={(e) => setParam('by', e.target.value || null)}>
            <option value="">Everyone</option>
            {hasMine && <option value={YOU}>You</option>}
            {reviewers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button className={`chip ${written ? 'on' : ''}`} aria-pressed={written} onClick={() => setParam('written', written ? null : '1')}>
            Written only
          </button>
        </div>
        <span className="section-count">
          {shown.length} review{shown.length === 1 ? '' : 's'}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="empty">{feed.length ? 'No reviews match these filters.' : 'No reviews yet. Open a game and be the first.'}</p>
      ) : (
        <ul className="review-list feed-list">
          {shown.map((r, i) => {
            const manifest = findGame(r.gameId)?.manifest;
            return (
              <ReviewItem
                key={`${r.gameId}-${r.updatedAt}-${i}`}
                review={r}
                author={authorOf(r)}
                game={
                  <Link
                    to={`/play/${r.gameId}#reviews`}
                    className="feed-game"
                    style={manifest ? ({ '--accent': manifest.accent } as CSSProperties) : undefined}
                  >
                    {manifest && <Emblem mechanic={manifest.mechanic} />}
                    <strong>{manifest?.name ?? r.gameId}</strong>
                  </Link>
                }
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
