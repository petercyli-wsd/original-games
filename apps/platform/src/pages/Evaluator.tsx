import type { AgreementRow, BacktestMetrics, EvaluatorStatus, Job, PromptVersion } from '@originals/api/shared';
import { useStore } from '@originals/game-sdk/react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminUnlock, JobProgress } from '../components/AdminUnlock';
import {
  adminKey,
  evaluatorEnabled,
  fetchAgreement,
  fetchJobs,
  fetchStatus,
  fetchVersions,
  followJob,
  loadEvaluationSummaries,
  promote,
  startBacktest,
  startEvaluate,
  startRefine,
} from '../lib/evaluator';
import { reviewPrefs, setShowAi } from '../lib/preferences';
import { findGame } from '../registry';

const nameOf = (id: string) => findGame(id)?.manifest.name ?? id;
const fmt = (x: number | null | undefined, digits = 2) => (x === null || x === undefined ? '—' : x.toFixed(digits));

function MetricsTable({ rows }: { rows: { label: string; metrics: BacktestMetrics | null }[] }) {
  const line = (label: string, get: (m: BacktestMetrics) => string, hint: string) => (
    <tr>
      <th title={hint}>{label}</th>
      {rows.map((r) => (
        <td key={r.label}>{r.metrics ? get(r.metrics) : '—'}</td>
      ))}
    </tr>
  );
  return (
    <table className="ev-metrics">
      <thead>
        <tr>
          <th />
          {rows.map((r) => (
            <th key={r.label}>{r.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {line(
          'Holdout agreement',
          (m) => (m.holdout ? `${fmt(m.holdout.spearman)} (${m.holdout.games})` : '—'),
          'Spearman correlation with the team on held-out games the refiner never saw. The number to compare versions on. Needs 3+ held-out games.',
        )}
        {line('Holdout gap', (m) => (m.holdout?.mae == null ? '—' : `${m.holdout.mae.toFixed(2)}★`), 'Mean absolute difference from the team on held-out games.')}
        {line('Agreement, all games', (m) => fmt(m.spearman), 'Spearman correlation on every reviewed game, including those the refiner learned from (optimistic).')}
        {line('Gap, all games', (m) => (m.mae === null ? '—' : `${m.mae.toFixed(2)}★`), 'Mean absolute difference from the team on every reviewed game.')}
        {line('Benchmarks passed', (m) => `${m.anchorsPassed}/${m.anchorsTotal}`, 'Core classics must score 4+, classics must average 3.8+, and games the team rated low must score low.')}
        {line('Games compared', (m) => String(m.humanGames), 'Games with human reviews in the backtest.')}
      </tbody>
    </table>
  );
}

function VersionDetails({ version, parent }: { version: PromptVersion; parent?: PromptVersion }) {
  const changed = version.criteria.filter((c) => {
    const p = parent?.criteria.find((x) => x.key === c.key);
    return !p || p.weight !== c.weight || p.descriptors[1] !== c.descriptors[1] || p.descriptors[3] !== c.descriptors[3] || p.descriptors[5] !== c.descriptors[5];
  });
  return (
    <>
      <table className="ev-weights">
        <thead>
          <tr>
            <th>Criterion</th>
            <th>Weight</th>
          </tr>
        </thead>
        <tbody>
          {version.criteria.map((c) => {
            const before = parent?.criteria.find((x) => x.key === c.key)?.weight;
            return (
              <tr key={c.key} className={parent && changed.includes(c) ? 'changed' : ''}>
                <td title={c.question}>{c.name}</td>
                <td>
                  {parent && before !== undefined && before !== c.weight && <s>{before}</s>} {c.weight}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <details className="ev-details">
        <summary>Guidance{parent && parent.guidance !== version.guidance ? ' (changed)' : ''}</summary>
        <p className="ev-guidance">{version.guidance}</p>
      </details>
      {parent && changed.some((c) => parent.criteria.find((x) => x.key === c.key)?.descriptors[1] !== c.descriptors[1]) && (
        <details className="ev-details">
          <summary>Changed score descriptions</summary>
          {changed.map((c) => (
            <div key={c.key} className="ev-desc">
              <b>{c.name}</b>
              <p>1: {c.descriptors[1]}</p>
              <p>3: {c.descriptors[3]}</p>
              <p>5: {c.descriptors[5]}</p>
            </div>
          ))}
        </details>
      )}
      <details className="ev-details">
        <summary>Reference games ({version.exemplars.length})</summary>
        {version.exemplars.length ? (
          <ul>
            {version.exemplars.map((x) => (
              <li key={x.gameId}>
                <Link to={`/play/${x.gameId}`}>{nameOf(x.gameId)}</Link>: {x.note}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rating-note">None yet. Refining picks them from the team's reviews.</p>
        )}
      </details>
    </>
  );
}

export function Evaluator() {
  const key = useStore(adminKey);
  const { showAi } = useStore(reviewPrefs);
  const [status, setStatus] = useState<EvaluatorStatus | null>(null);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [agreement, setAgreement] = useState<{ rows: AgreementRow[]; spearman: number | null; mae: number | null } | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([fetchStatus(), fetchVersions(), fetchAgreement()])
      .then(([s, v, a]) => {
        setStatus(s);
        setVersions(v);
        setAgreement(a);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Can't reach the evaluator."));
  }, []);

  useEffect(() => {
    if (!evaluatorEnabled) return;
    load();
    // Resume watching a job started earlier (e.g. before a page reload).
    fetchJobs()
      .then((jobs) => {
        const running = jobs.find((j) => j.status === 'running');
        if (running) void track(Promise.resolve(running));
      })
      .catch(() => {});
  }, [load]);

  async function track(start: Promise<Job>) {
    setError('');
    try {
      await followJob(await start, setJob);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      load();
      loadEvaluationSummaries(true);
    }
  }

  async function doPromote(id: number) {
    try {
      await promote(id);
      load();
      loadEvaluationSummaries(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not promote');
    }
  }

  if (evaluatorEnabled && !showAi) {
    return (
      <main className="evaluator">
        <p className="rankings-banner">
          AI reviews are hidden in this browser, so they don't influence your own reviews.{' '}
          <button type="button" className="btn-link" onClick={() => setShowAi(true)}>
            Show AI reviews
          </button>
        </p>
      </main>
    );
  }

  if (!evaluatorEnabled) {
    return (
      <main className="evaluator">
        <p className="rankings-banner">The evaluator isn't configured for this site (VITE_RATINGS_API_URL is not set).</p>
      </main>
    );
  }

  const active = status?.activeVersion ?? null;
  const candidates = versions.filter((v) => v.status === 'candidate');
  const history = versions.filter((v) => v.status === 'retired');
  const running = job?.status === 'running';
  // In-app runs are behind the server's IN_APP_AI_REVIEWS flag; when it's off the buttons are hidden.
  const inApp = Boolean(status?.aiEnabled);
  const canAct = Boolean(key && inApp && !running);
  const reviewedGames = agreement?.rows.length ?? 0;

  return (
    <main className="evaluator">
      <div className="section-head">
        <div>
          <h2>AI evaluator</h2>
          <p>
            Claude reviews each game against the Originals brief. The team's reviews train it: refining proposes a new prompt, backtests it against your
            scores, and you decide whether to promote it.
          </p>
        </div>
        <AdminUnlock />
      </div>

      {error && <p className="rankings-banner error">{error}</p>}
      {status && !inApp && (
        <p className="rankings-banner">
          In-app AI reviews are switched off. Reviews are run from Claude Code and stored here; this page shows them, tracks agreement with the
          team and promotes prompt versions.
        </p>
      )}
      {inApp && (
        <p className="rankings-banner">
          <b>In development.</b> In-app AI reviews are switched on (IN_APP_AI_REVIEWS): the run buttons call the Anthropic API with a billed key.
        </p>
      )}
      {status && !status.adminConfigured && <p className="rankings-banner">Admin actions are off: set ADMIN_KEY on the API service.</p>}

      <div className="ev-grid">
        <article className="review-card">
          <div className="review-card-head">
            <h2>Active prompt {active ? `v${active.id}` : ''}</h2>
            {status && <span className="rating-note">{status.model || 'no model'} · {status.evidenceGames} games</span>}
          </div>
          {active ? (
            <>
              {active.changelog && <p className="ev-changelog">{active.changelog}</p>}
              <MetricsTable rows={[{ label: `v${active.id}`, metrics: active.metrics }]} />
              {!active.metrics && <p className="rating-note">Not backtested yet. Refine or backtest to measure agreement with the team.</p>}
              <VersionDetails version={active} />
            </>
          ) : (
            <p className="rating-note">Loading…</p>
          )}
        </article>

        <article className="review-card">
          <div className="review-card-head">
            <h2>Run</h2>
          </div>
          <ol className="ev-steps">
            <li>Play games and write reviews: a score plus pros and cons.</li>
            <li>Review the games with AI: rules card from the code, measured stats, then a score per criterion.</li>
            <li>Refine: Claude studies where it disagrees with you and proposes a better prompt, which is backtested automatically.</li>
            <li>Promote the candidate if it agrees with the team better.</li>
          </ol>
          {inApp && (
            <div className="ev-actions">
              <button type="button" className="btn-primary" disabled={!canAct} onClick={() => void track(startEvaluate('missing'))}>
                Review unreviewed games
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={!canAct}
                onClick={() => {
                  if (window.confirm(`Re-review all ${status?.evidenceGames ?? ''} games with Claude Opus? Each takes one or two calls.`)) {
                    void track(startEvaluate('all'));
                  }
                }}
              >
                Review all games
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={!canAct || reviewedGames < 3}
                title={reviewedGames < 3 ? 'Needs team reviews on at least 3 games' : undefined}
                onClick={() => void track(startRefine())}
              >
                Refine prompt from reviews
              </button>
            </div>
          )}
          {inApp && !key && <p className="rating-note">Unlock with the admin passphrase to run reviews.</p>}
          {reviewedGames < 3 && <p className="rating-note">Refining needs team reviews on at least 3 games ({reviewedGames} so far).</p>}
          {job && <JobProgress job={job} />}
          {job?.kind === 'refine' && job.status === 'done' && <p className="rating-note">A candidate prompt is ready below.</p>}
        </article>
      </div>

      {candidates.map((c) => {
        const parent = versions.find((v) => v.id === c.parentId);
        return (
          <article key={c.id} className="review-card ev-candidate">
            <div className="review-card-head">
              <h2>
                Candidate v{c.id} <small>from v{c.parentId}</small>
              </h2>
              <div className="ev-actions">
                {inApp && (
                  <button type="button" className="btn-ghost" disabled={!canAct} onClick={() => void track(startBacktest(c.id))}>
                    Backtest again
                  </button>
                )}
                <button type="button" className="btn-primary" disabled={!key || running} onClick={() => void doPromote(c.id)}>
                  Promote to active
                </button>
              </div>
            </div>
            <p className="ev-changelog">{c.changelog}</p>
            <MetricsTable
              rows={[
                { label: `Active v${active?.id ?? '?'}`, metrics: active?.metrics ?? null },
                { label: `Candidate v${c.id}`, metrics: c.metrics },
              ]}
            />
            {c.metrics?.anchorFailures.length ? <p className="ai-flag">Benchmark failures: {c.metrics.anchorFailures.join('; ')}</p> : null}
            <VersionDetails version={c} parent={parent} />
          </article>
        );
      })}

      <article className="review-card">
        <div className="review-card-head">
          <h2>Humans vs AI</h2>
          {agreement && (
            <span className="rating-note">
              Rank agreement {fmt(agreement.spearman)} · average gap {agreement.mae === null ? '—' : `${agreement.mae.toFixed(2)}★`}
            </span>
          )}
        </div>
        {agreement?.rows.length ? (
          <table className="ev-agree">
            <thead>
              <tr>
                <th>Game</th>
                <th>Team</th>
                <th>AI</th>
                <th>Gap</th>
              </tr>
            </thead>
            <tbody>
              {agreement.rows.map((r) => {
                const gap = r.aiOverall === null ? null : r.aiOverall - r.humanAverage;
                return (
                  <tr key={r.gameId}>
                    <td>
                      <Link to={`/play/${r.gameId}`}>{nameOf(r.gameId)}</Link>
                    </td>
                    <td>
                      ★ {r.humanAverage.toFixed(1)} <small>({r.humanCount})</small>
                    </td>
                    <td>{r.aiOverall === null ? '—' : r.aiOverall.toFixed(1)}</td>
                    <td className={gap === null ? '' : Math.abs(gap) >= 1 ? 'gap-big' : ''}>{gap === null ? '—' : `${gap > 0 ? '+' : ''}${gap.toFixed(1)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="rating-note">No team reviews yet. Rate games on their pages or on the Rankings page.</p>
        )}
      </article>

      {history.length > 0 && (
        <details className="review-card ev-history">
          <summary>Earlier versions ({history.length})</summary>
          <ul>
            {history.map((v) => (
              <li key={v.id}>
                <b>v{v.id}</b> {new Date(v.createdAt).toLocaleDateString()}: {v.changelog}
                {v.metrics && ` (agreement ${fmt(v.metrics.spearman)}, benchmarks ${v.metrics.anchorsPassed}/${v.metrics.anchorsTotal})`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
