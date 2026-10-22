import { MAX_COMMENT_LENGTH, MAX_REVIEWER_LENGTH, type RatingDetail } from '@originals/api/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { fetchRating, rate, ratingsEnabled, savedReviewer } from '../lib/ratings';
import { StarInput } from './StarInput';

const PLACEHOLDER = `Pros: what works? Is the win condition clear, are the odds obvious on screen?
Cons: what's confusing, flat or too close to an existing game?`;

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** Write a review (stars, pros and cons, name) and read the team's reviews. */
export function HumanReviews({ gameId }: { gameId: string }) {
  const [detail, setDetail] = useState<RatingDetail | null>(null);
  const [error, setError] = useState('');
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [reviewer, setReviewer] = useState(savedReviewer);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!ratingsEnabled) return;
    let cancelled = false;
    setDetail(null);
    fetchRating(gameId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setStars(d.mine ?? 0);
        setComment(d.myReview?.comment ?? '');
        if (d.myReview?.reviewer) setReviewer(d.myReview.reviewer);
      })
      .catch(() => !cancelled && setError("Can't reach the ratings server."));
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  if (!ratingsEnabled) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!stars) return;
    setSaving(true);
    setError('');
    try {
      setDetail(await rate(gameId, stars, { comment: comment.trim(), reviewer: reviewer.trim() }));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your review');
    } finally {
      setSaving(false);
    }
  }

  const others = detail?.reviews ?? [];

  return (
    <section className="review-card" id="reviews">
      <div className="review-card-head">
        <h2>Team reviews</h2>
        {detail && detail.count > 0 && (
          <span className="rating-avg">
            ★ {detail.average.toFixed(1)} <span>· {detail.count} rating{detail.count === 1 ? '' : 's'}</span>
          </span>
        )}
      </div>

      <form className="review-form" onSubmit={(e) => void submit(e)}>
        <div className="review-form-row">
          <StarInput value={stars} onRate={(s) => (setStars(s), setSaved(false))} label="Your score" />
          <input
            className="review-name"
            placeholder="Your name (optional)"
            maxLength={MAX_REVIEWER_LENGTH}
            value={reviewer}
            onChange={(e) => (setReviewer(e.target.value), setSaved(false))}
          />
        </div>
        <textarea
          rows={4}
          placeholder={PLACEHOLDER}
          maxLength={MAX_COMMENT_LENGTH}
          value={comment}
          onChange={(e) => (setComment(e.target.value), setSaved(false))}
        />
        <div className="review-form-foot">
          <span className="rating-note">
            {error ? <span className="rating-error">{error}</span> : saved ? 'Saved. Thanks, this trains the AI reviewer.' : stars ? '' : 'Pick a score to save.'}
          </span>
          <button type="submit" className="btn-primary" disabled={!stars || saving}>
            {saving ? 'Saving…' : detail?.myReview?.comment ? 'Update review' : 'Save review'}
          </button>
        </div>
      </form>

      {others.length > 0 ? (
        <ul className="review-list">
          {others.map((r, i) => (
            <li key={i}>
              <div className="review-meta">
                <span className="review-stars">{'★'.repeat(r.stars)}<span>{'★'.repeat(5 - r.stars)}</span></span>
                <span>{r.reviewer || 'Anonymous'}</span>
                <span>{when(r.updatedAt)}</span>
              </div>
              <p>{r.comment}</p>
            </li>
          ))}
        </ul>
      ) : (
        detail && <p className="rating-note">No written reviews yet.</p>
      )}
    </section>
  );
}
