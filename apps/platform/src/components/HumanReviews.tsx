import { FACETS, MAX_COMMENT_LENGTH, MAX_REVIEWER_LENGTH, type FacetScores, type RatingDetail } from '@originals/api/shared';
import { useStore } from '@originals/game-sdk/react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { fetchRating, rate, ratingSummaries, ratingsEnabled, savedReviewer } from '../lib/ratings';
import { notify } from '../lib/toast';
import { findGame, nextGameWhere } from '../registry';
import { RatingBars, ReviewItem } from './ReviewItem';
import { StarInput } from './StarInput';

const PLACEHOLDER = `Pros: what works? Is the win condition clear, are the odds obvious on screen?
Cons: what's confusing, flat or too close to an existing game?`;

/**
 * The team's view of a game: the score breakdown, your own review (stars,
 * optional facet scores, pros and cons, name) and everyone else's reviews.
 * Other reviews stay folded until you've saved yours, so they don't sway it.
 */
export function HumanReviews({ gameId }: { gameId: string }) {
  const [detail, setDetail] = useState<RatingDetail | null>(null);
  const [error, setError] = useState('');
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [reviewer, setReviewer] = useState(savedReviewer);
  const [facets, setFacets] = useState<FacetScores>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const ratings = useStore(ratingSummaries);

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
        setFacets(d.myReview?.facets ?? {});
        if (d.myReview?.reviewer) setReviewer(d.myReview.reviewer);
      })
      .catch(() => !cancelled && setError("Can't reach the ratings server."));
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  if (!ratingsEnabled) return null;

  const edited = () => setSaved(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!stars) return;
    setSaving(true);
    setError('');
    try {
      const updated = await rate(gameId, stars, { comment: comment.trim(), reviewer: reviewer.trim(), facets });
      const first = !detail?.myReview;
      setDetail(updated);
      setSaved(true);
      setShowOthers(true);
      notify(`${first ? 'Review saved' : 'Review updated'} for ${findGame(gameId)?.manifest.name ?? gameId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save your review';
      setError(message);
      notify(message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const others = detail?.reviews ?? [];
  const hasMine = Boolean(detail?.myReview);

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
      {detail && detail.count > 1 && (hasMine || showOthers) && <RatingBars distribution={detail.distribution} />}

      <h3 className="review-subhead">{hasMine ? 'Your review' : 'Add your review'}</h3>
      <form className="review-form" onSubmit={(e) => void submit(e)}>
        <div className="review-form-row">
          <StarInput value={stars} onRate={(s) => (setStars(s), edited())} label="Your score" />
          <input
            className="review-name"
            placeholder="Your name, so the team knows who wrote it"
            aria-label="Your name"
            maxLength={MAX_REVIEWER_LENGTH}
            value={reviewer}
            onChange={(e) => (setReviewer(e.target.value), edited())}
          />
        </div>
        <details className="facet-form" open={Object.keys(facets).length > 0}>
          <summary>
            Rate each facet <span>(optional, {Object.keys(facets).length}/{FACETS.length})</span>
          </summary>
          <ul>
            {FACETS.map((f) => (
              <li key={f.key}>
                <span title={f.question}>{f.label}</span>
                <StarInput
                  size="sm"
                  value={facets[f.key] ?? 0}
                  label={`${f.label}: ${f.question}`}
                  onRate={(s) => {
                    // Clicking the current score again clears it.
                    setFacets((prev) => {
                      const next = { ...prev };
                      if (next[f.key] === s) delete next[f.key];
                      else next[f.key] = s;
                      return next;
                    });
                    edited();
                  }}
                />
                <small>{f.question}</small>
              </li>
            ))}
          </ul>
        </details>
        <textarea
          rows={4}
          placeholder={PLACEHOLDER}
          aria-label="Pros and cons"
          maxLength={MAX_COMMENT_LENGTH}
          value={comment}
          onChange={(e) => (setComment(e.target.value), edited())}
        />
        <div className="review-form-foot">
          <span className="rating-note">
            {error ? (
              <span className="rating-error">{error}</span>
            ) : saved ? (
              <SavedNote next={nextGameWhere(gameId, (g) => !ratings[g.manifest.id]?.mine)} />
            ) : stars ? (
              ''
            ) : (
              'Pick a score to save.'
            )}
          </span>
          <button type="submit" className="btn-primary" disabled={!stars || saving}>
            {saving ? 'Saving…' : hasMine ? 'Update review' : 'Save review'}
          </button>
        </div>
      </form>

      {detail && (
        <div className="other-reviews">
          <div className="other-reviews-head">
            <h3 className="review-subhead">
              Other reviews <span>({others.length})</span>
            </h3>
            <Link to="/rankings?view=reviews" className="other-reviews-all">
              All team reviews →
            </Link>
          </div>
          {others.length === 0 ? (
            <p className="rating-note">No one else has reviewed this game yet.</p>
          ) : hasMine || showOthers ? (
            <ul className="review-list">
              {others.map((r, i) => (
                <ReviewItem key={`${r.updatedAt}-${i}`} review={r} />
              ))}
            </ul>
          ) : (
            <div className="reviews-hidden">
              <p className="rating-note">Hidden until you save your own, so they don't sway your score.</p>
              <button type="button" className="btn-ghost" onClick={() => setShowOthers(true)}>
                Show {others.length} review{others.length === 1 ? '' : 's'}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Thanks the reviewer and points at the next game they haven't rated, to keep a review session moving. */
function SavedNote({ next }: { next: ReturnType<typeof nextGameWhere> }) {
  return (
    <>
      Saved. Thanks, this trains the AI reviewer.
      {next ? (
        <>
          {' '}
          <Link to={`/play/${next.manifest.id}`} className="next-to-rate">
            Next game to rate: {next.manifest.name} →
          </Link>
        </>
      ) : (
        ' You have rated every game.'
      )}
    </>
  );
}
