import { rankScore, type RatingRow } from '@originals/api/shared';
import { useStore } from '@originals/game-sdk/react';
import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Emblem } from '../components/Emblem';
import { StarInput } from '../components/StarInput';
import { rate, ratingSummaries, ratingsEnabled, ratingsStatus } from '../lib/ratings';
import { games } from '../registry';

const UNRATED: RatingRow = { average: 0, count: 0, mine: null };

/** Every game ranked by its team rating, with inline voting. */
export function Rankings() {
  const summaries = useStore(ratingSummaries);
  const status = useStore(ratingsStatus);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const rows = games
    .map((g) => ({ manifest: g.manifest, rating: summaries[g.manifest.id] ?? UNRATED }))
    // Rated games first (best score first), then unrated ones alphabetically.
    .sort(
      (a, b) =>
        Number(b.rating.count > 0) - Number(a.rating.count > 0) ||
        rankScore(b.rating) - rankScore(a.rating) ||
        b.rating.count - a.rating.count ||
        a.manifest.name.localeCompare(b.manifest.name),
    );

  async function vote(gameId: string, stars: number) {
    setSaving(gameId);
    setError('');
    try {
      await rate(gameId, stars);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your rating');
    } finally {
      setSaving(null);
    }
  }

  return (
    <main className="rankings">
      <div className="section-head">
        <div>
          <h2>Rankings</h2>
          <p>Rate every game you've played. Rankings weigh each average by how many people voted.</p>
        </div>
      </div>

      {!ratingsEnabled && <p className="rankings-banner">Ratings aren't configured for this site (VITE_RATINGS_API_URL is not set).</p>}
      {ratingsEnabled && status === 'loading' && (
        <p className="rankings-banner">Loading ratings… the server can take up to a minute to wake up.</p>
      )}
      {ratingsEnabled && status === 'error' && (
        <p className="rankings-banner error">
          Can't reach the ratings server, so votes won't save. Check the API is running and that its CORS_ORIGINS allows this site.
        </p>
      )}
      {error && <p className="rankings-banner error">{error}</p>}

      <ol className="rank-list">
        {rows.map(({ manifest, rating }, i) => (
          <li key={manifest.id} className="rank-row" style={{ '--accent': manifest.accent } as CSSProperties}>
            <span className="rank-pos">{rating.count ? i + 1 : '–'}</span>
            <Link to={`/play/${manifest.id}`} className="rank-game">
              <Emblem mechanic={manifest.mechanic} />
              <span>
                <strong>{manifest.name}</strong>
                <small>{manifest.tagline}</small>
              </span>
            </Link>
            <span className="rank-score">
              {rating.count ? (
                <>
                  <b>★ {rating.average.toFixed(1)}</b>
                  <small>
                    {rating.count} vote{rating.count === 1 ? '' : 's'}
                  </small>
                </>
              ) : (
                <small>Not rated yet</small>
              )}
            </span>
            <span className="rank-mine">
              <small>{rating.mine ? 'Your rating' : 'Rate it'}</small>
              <StarInput
                size="sm"
                value={rating.mine ?? 0}
                label={`Rate ${manifest.name}`}
                disabled={!ratingsEnabled || status === 'error' || saving === manifest.id}
                onRate={(s) => void vote(manifest.id, s)}
              />
            </span>
          </li>
        ))}
      </ol>
    </main>
  );
}
