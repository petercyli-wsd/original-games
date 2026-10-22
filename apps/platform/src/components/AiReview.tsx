import type { EvaluationView, Job, PromptVersion } from '@originals/api/shared';
import { useStore } from '@originals/game-sdk/react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RECOMMENDATION_LABEL,
  adminKey,
  evaluatorEnabled,
  fetchEvaluation,
  fetchStatus,
  followJob,
  loadEvaluationSummaries,
  startEvaluate,
} from '../lib/evaluator';
import { reviewPrefs, setShowAi } from '../lib/preferences';
import { AdminUnlock, JobProgress } from './AdminUnlock';

const CARD_FIELDS: [keyof NonNullable<EvaluationView['rulesCard']>, string][] = [
  ['concept', 'Concept'],
  ['win_condition', 'Win condition'],
  ['odds_display', 'Odds on screen'],
  ['volatility_controls', 'Volatility'],
  ['checkpoints', 'Checkpoints'],
  ['round_flow', 'Round flow'],
  ['maths_family', 'Maths'],
  ['theme_dependence', 'Theme'],
];

/** The latest AI review of a game under the active prompt, with a button to (re)run it. */
export function AiReview({ gameId }: { gameId: string }) {
  const { showAi } = useStore(reviewPrefs);
  if (!evaluatorEnabled) return null;
  if (!showAi) {
    return (
      <section className="review-card ai-review ai-hidden">
        <div className="review-card-head">
          <h2>AI review</h2>
        </div>
        <p className="rating-note">Hidden so it doesn't influence your own review.</p>
        <button type="button" className="btn-ghost" onClick={() => setShowAi(true)}>
          Show AI reviews
        </button>
      </section>
    );
  }
  return <AiReviewPanel gameId={gameId} />;
}

function AiReviewPanel({ gameId }: { gameId: string }) {
  const key = useStore(adminKey);
  const [review, setReview] = useState<EvaluationView | null | undefined>(undefined);
  const [version, setVersion] = useState<PromptVersion | null>(null);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetchEvaluation(gameId)
      .then(setReview)
      .catch(() => setError("Can't reach the evaluator."));
  }, [gameId]);

  useEffect(() => {
    if (!evaluatorEnabled) return;
    setReview(undefined);
    setJob(null);
    load();
    fetchStatus()
      .then((s) => {
        setVersion(s.activeVersion);
        setAiEnabled(s.aiEnabled);
      })
      .catch(() => {});
  }, [gameId, load]);

  if (!evaluatorEnabled) return null;

  async function run() {
    setError('');
    try {
      const done = await followJob(await startEvaluate(gameId), setJob);
      if (done.status === 'done' && !done.failed) {
        load();
        loadEvaluationSummaries(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the review');
    }
  }

  const running = job?.status === 'running';
  const names = new Map(version?.criteria.map((c) => [c.key, c]) ?? []);

  return (
    <section className="review-card ai-review">
      <div className="review-card-head">
        <h2>AI review</h2>
        {review && (
          <span className={`ai-score rec-${review.recommendation}`}>
            {review.overall.toFixed(1)}
            <small>/5 · {RECOMMENDATION_LABEL[review.recommendation]}</small>
          </span>
        )}
      </div>

      {review === undefined && !error && <p className="rating-note">Loading…</p>}
      {review === null && <p className="rating-note">Not reviewed under the current prompt yet.</p>}
      {error && <p className="rating-note rating-error">{error}</p>}

      {review && (
        <>
          <p className="ai-verdict">{review.verdict}</p>
          {review.stale && <p className="ai-flag">The game's code changed since this review. Re-run it for a current score.</p>}
          {review.duplicateOf && (
            <p className="ai-flag">
              Looks like a reskin of <Link to={`/play/${review.duplicateOf}`}>{review.duplicateOf}</Link>.
            </p>
          )}

          <ul className="ai-criteria">
            {review.criteria.map((c) => (
              <li key={c.key}>
                <details>
                  <summary>
                    <span className="ai-crit-name">{names.get(c.key)?.name ?? c.key}</span>
                    <span className="ai-crit-bar" aria-hidden="true">
                      <span style={{ width: `${(c.score / 5) * 100}%` }} data-score={c.score} />
                    </span>
                    <b>{c.score}</b>
                  </summary>
                  <p>{c.reasoning}</p>
                </details>
              </li>
            ))}
          </ul>

          <div className="ai-proscons">
            <div>
              <h3>Pros</h3>
              <ul>
                {review.pros.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Cons</h3>
              <ul>
                {review.cons.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          </div>

          {review.checks.length > 0 && (
            <ul className="ai-checks">
              {review.checks.map((c) => (
                <li key={c.key} className={c.pass ? 'pass' : 'fail'} title={c.detail}>
                  {c.pass ? '✓' : '✗'} {c.label}
                </li>
              ))}
            </ul>
          )}

          {review.rulesCard && (
            <details className="ai-card">
              <summary>Rules card the AI judged from</summary>
              <dl>
                {CARD_FIELDS.map(([k, label]) => (
                  <div key={k}>
                    <dt>{label}</dt>
                    <dd>{String(review.rulesCard![k])}</dd>
                  </div>
                ))}
                <div>
                  <dt>Closest games</dt>
                  <dd>{review.closestExisting || review.rulesCard.closest_known_games.join(', ') || '—'}</dd>
                </div>
              </dl>
            </details>
          )}
          <p className="rating-note">
            Prompt v{review.versionId} · {review.model} · {new Date(review.createdAt).toLocaleString()}
          </p>
        </>
      )}

      {job && <JobProgress job={job} />}
      <div className="ai-actions">
        {!aiEnabled ? (
          <p className="rating-note">AI reviews are run from Claude Code.</p>
        ) : key ? (
          <button type="button" className="btn-primary" disabled={running} onClick={() => void run()} title="In development: calls the billed Anthropic API">
            {running ? 'Reviewing… (about a minute)' : review ? 'Re-run AI review (API, beta)' : 'Run AI review (API, beta)'}
          </button>
        ) : (
          <AdminUnlock compact />
        )}
        <Link to="/evaluator" className="btn-link">
          Evaluator →
        </Link>
      </div>
    </section>
  );
}
