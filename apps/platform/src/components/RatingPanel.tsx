import type { RatingDetail } from '@originals/api/shared';
import { useEffect, useState } from 'react';
import { fetchRating, rate, ratingsEnabled } from '../lib/ratings';
import { StarInput } from './StarInput';

type Status = 'loading' | 'ready' | 'saving' | 'error';

const STARS = [1, 2, 3, 4, 5];

/** Star rating for one game: the team's average plus this browser's own vote. */
export function RatingPanel({ gameId }: { gameId: string }) {
  const [detail, setDetail] = useState<RatingDetail | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ratingsEnabled) return;
    let cancelled = false;
    setStatus('loading');
    setDetail(null);
    // Render's free tier sleeps when idle; say so if the first request is slow.
    const slowTimer = setTimeout(() => setSlow(true), 2500);
    fetchRating(gameId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setStatus('ready');
      })
      .catch(() => !cancelled && setStatus('error'))
      .finally(() => {
        clearTimeout(slowTimer);
        setSlow(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
    };
  }, [gameId]);

  if (!ratingsEnabled) return null;

  async function submit(stars: number) {
    setStatus('saving');
    setError('');
    try {
      setDetail(await rate(gameId, stars));
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      setStatus('ready');
    }
  }

  const mine = detail?.mine ?? 0;
  const max = detail ? Math.max(1, ...detail.distribution) : 1;

  return (
    <section className="rating-panel">
      <div className="panel-head">
        <h2>Rating</h2>
        {detail && detail.count > 0 && (
          <span className="rating-avg">
            ★ {detail.average.toFixed(1)} <span>· {detail.count}</span>
          </span>
        )}
      </div>

      {status === 'loading' && <p className="rating-note">{slow ? 'Waking the ratings server…' : 'Loading…'}</p>}
      {status === 'error' && <p className="rating-note rating-error">Can't reach the ratings server.</p>}

      {detail && (
        <>
          <StarInput value={mine} onRate={(s) => void submit(s)} disabled={status === 'saving'} />
          <p className="rating-note">
            {error || (status === 'saving' ? 'Saving…' : mine ? `You rated it ${mine}/5. Click to change.` : 'Tap a star to rate.')}
          </p>

          {detail.count > 0 && (
            <dl className="rating-bars">
              {[...STARS].reverse().map((s) => (
                <div key={s}>
                  <dt>{s}★</dt>
                  <dd>
                    <span style={{ width: `${(detail.distribution[s - 1] / max) * 100}%` }} />
                  </dd>
                  <dd className="rating-bar-count">{detail.distribution[s - 1]}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </section>
  );
}
