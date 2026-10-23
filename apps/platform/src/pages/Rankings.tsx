import { FACETS, rankScore, type CriterionKey, type RatingRow, type RatingSummary } from '@originals/api/shared';
import { useStore } from '@originals/game-sdk/react';
import { useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Emblem } from '../components/Emblem';
import { ReviewFeed } from '../components/ReviewFeed';
import { StarInput } from '../components/StarInput';
import { RECOMMENDATION_LABEL, evaluationSummaries } from '../lib/evaluator';
import { reviewPrefs } from '../lib/preferences';
import { rate, ratingSummaries, ratingsEnabled, ratingsStatus } from '../lib/ratings';
import { notify } from '../lib/toast';
import { games } from '../registry';

const UNRATED: RatingRow = { average: 0, count: 0, mine: null };

type Facet = 'overall' | CriterionKey;
type SortBy = 'team' | 'ai';

/** Every game ranked overall or on one facet, by the team or by the AI, with inline voting; or the team's latest reviews. */
export function Rankings() {
  const summaries = useStore(ratingSummaries);
  const status = useStore(ratingsStatus);
  const ai = useStore(evaluationSummaries);
  const { showAi } = useStore(reviewPrefs);
  // Facet and sort live in the URL, so Back from a game returns to the same ranking.
  const [params, setParams] = useSearchParams();
  const facetParam = params.get('facet');
  const facet: Facet = FACETS.some((f) => f.key === facetParam) ? (facetParam as CriterionKey) : 'overall';
  const sortPick: SortBy = params.get('sort') === 'team' ? 'team' : 'ai';
  const view = params.get('view') === 'reviews' ? 'reviews' : 'ranking';
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
  const setFacet = (f: Facet) => setParam('facet', f === 'overall' ? null : f);
  const setSortBy = (s: SortBy) => setParam('sort', s === 'ai' ? null : s);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const sortBy: SortBy = showAi ? sortPick : 'team';
  const facetMeta = FACETS.find((f) => f.key === facet);

  const teamScore = (rating: RatingRow): RatingSummary | null => {
    const s = facet === 'overall' ? rating : rating.facets?.[facet];
    return s && s.count ? s : null;
  };
  const aiScore = (id: string): number | null => {
    const s = ai[id];
    if (!s) return null;
    return facet === 'overall' ? s.overall : (s.facets?.[facet] ?? null);
  };

  const rows = games
    .map((g) => {
      const rating = summaries[g.manifest.id] ?? UNRATED;
      return { manifest: g.manifest, rating, team: teamScore(rating), ai: aiScore(g.manifest.id) };
    })
    // Scored games first (best first), then the rest alphabetically.
    .sort((a, b) => {
      if (sortBy === 'ai') {
        return Number(b.ai !== null) - Number(a.ai !== null) || (b.ai ?? 0) - (a.ai ?? 0) || a.manifest.name.localeCompare(b.manifest.name);
      }
      return (
        Number(b.team !== null) - Number(a.team !== null) ||
        (b.team ? rankScore(b.team) : 0) - (a.team ? rankScore(a.team) : 0) ||
        (b.team?.count ?? 0) - (a.team?.count ?? 0) ||
        a.manifest.name.localeCompare(b.manifest.name)
      );
    });

  async function vote(gameId: string, stars: number) {
    setSaving(gameId);
    setError('');
    try {
      await rate(gameId, stars);
      notify(`Rated ${games.find((g) => g.manifest.id === gameId)?.manifest.name ?? gameId} ${stars}★`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save your rating';
      setError(message);
      notify(message, 'error');
    } finally {
      setSaving(null);
    }
  }

  const ranked = (r: (typeof rows)[number]) => (sortBy === 'ai' ? r.ai !== null : r.team !== null);

  return (
    <main className="rankings">
      <div className="section-head">
        <div>
          <h2>{view === 'reviews' ? 'Team reviews' : 'Rankings'}</h2>
          <p>
            {view === 'reviews'
              ? "Everyone's latest reviews across every game. Write your own on each game's page."
              : "Rank every game overall or on one facet. Team scores weigh each average by how many people voted; write full facet reviews on each game's page."}
          </p>
        </div>
        {ratingsEnabled && (
          <div className="segmented-mini" role="group" aria-label="View">
            <button className={view === 'ranking' ? 'on' : ''} aria-pressed={view === 'ranking'} onClick={() => setParam('view', null)}>
              Ranking
            </button>
            <button className={view === 'reviews' ? 'on' : ''} aria-pressed={view === 'reviews'} onClick={() => setParam('view', 'reviews')}>
              Latest reviews
            </button>
          </div>
        )}
      </div>

      {view === 'reviews' ? (
        <ReviewFeed />
      ) : (
      <>
      <div className="rank-controls">
        <nav className="filters rank-facets" aria-label="Rank by">
          <button className={`chip ${facet === 'overall' ? 'on' : ''}`} onClick={() => setFacet('overall')}>
            Overall
          </button>
          {FACETS.map((f) => (
            <button key={f.key} className={`chip ${facet === f.key ? 'on' : ''}`} onClick={() => setFacet(f.key)} title={f.question}>
              {f.label}
            </button>
          ))}
        </nav>
        {showAi && (
          <div className="segmented-mini" role="group" aria-label="Sort by">
            <button className={sortBy === 'ai' ? 'on' : ''} onClick={() => setSortBy('ai')}>
              Sort by AI
            </button>
            <button className={sortBy === 'team' ? 'on' : ''} onClick={() => setSortBy('team')}>
              Sort by team
            </button>
          </div>
        )}
      </div>
      {facetMeta && <p className="rank-facet-question">{facetMeta.question}</p>}

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

      <ol className={`rank-list${showAi ? '' : ' no-ai'}`}>
        {rows.map((row, i) => {
          const { manifest, rating, team } = row;
          const aiRow = ai[manifest.id];
          return (
            <li key={manifest.id} className="rank-row" style={{ '--accent': manifest.accent } as CSSProperties}>
              <span className="rank-pos">{ranked(row) ? i + 1 : '–'}</span>
              <Link to={`/play/${manifest.id}`} className="rank-game">
                <Emblem mechanic={manifest.mechanic} />
                <span>
                  <strong>
                    {manifest.name}
                    {manifest.collection === 'classics' && <em className="rank-tag">Classic</em>}
                  </strong>
                  <small>{manifest.tagline}</small>
                </span>
              </Link>
              <span className="rank-score">
                {team ? (
                  <>
                    <b>★ {team.average.toFixed(1)}</b>
                    <small>
                      Team · {team.count} vote{team.count === 1 ? '' : 's'}
                    </small>
                  </>
                ) : (
                  <small>No team score</small>
                )}
              </span>
              {showAi && (
                <span className="rank-ai">
                  {row.ai !== null && aiRow ? (
                    <>
                      <b className={facet === 'overall' ? `rec-${aiRow.recommendation}` : ''}>
                        ✦ {facet === 'overall' ? row.ai.toFixed(1) : row.ai}
                      </b>
                      <small>{facet === 'overall' ? `AI · ${RECOMMENDATION_LABEL[aiRow.recommendation]}` : 'AI'}</small>
                    </>
                  ) : (
                    <small>No AI review</small>
                  )}
                </span>
              )}
              <span className="rank-mine">
                <small>{rating.mine ? 'Your overall' : 'Rate overall'}</small>
                <StarInput
                  size="sm"
                  value={rating.mine ?? 0}
                  label={`Rate ${manifest.name}`}
                  disabled={!ratingsEnabled || status === 'error' || saving === manifest.id}
                  onRate={(s) => void vote(manifest.id, s)}
                />
              </span>
            </li>
          );
        })}
      </ol>
      </>
      )}
    </main>
  );
}
