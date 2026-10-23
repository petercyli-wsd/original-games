import { rankScore } from '@originals/api/shared';
import type { Mechanic } from '@originals/game-sdk';
import { useStore } from '@originals/game-sdk/react';
import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BRAND } from '../brand';
import { GameTile } from '../components/GameTile';
import { evaluationSummaries } from '../lib/evaluator';
import { lobbyPath, reviewPrefs } from '../lib/preferences';
import { ratingSummaries, ratingsEnabled } from '../lib/ratings';
import { games, lobbySection, type GameEntry } from '../registry';

const SECTIONS: { title: string; subtitle: string; section: number }[] = [
  { title: `Core ${BRAND.product}`, subtitle: 'Click any game to play instantly', section: 0 },
  { title: 'Casino Classics', subtitle: 'Proven formats from the biggest crypto casinos, rebuilt to house standard', section: 1 },
  { title: 'Experimental', subtitle: 'Fresh probability prototypes and new mechanics', section: 2 },
  { title: 'Templates', subtitle: 'Starting points for new games (dev only)', section: 3 },
];

type Sort = 'featured' | 'ai' | 'team' | 'name';
const SORT_LABELS: Record<Sort, string> = { featured: 'Featured', ai: 'AI score', team: 'Team score', name: 'A–Z' };

const MECHANIC_LABELS: Record<Mechanic, string> = {
  mines: 'Mines',
  crash: 'Crash',
  'random-walk': 'Random walk',
  graph: 'Graph',
  urn: 'Urn',
  geometry: 'Geometry',
  combinatorics: 'Combinatorics',
  'number-theory': 'Number theory',
  process: 'Process',
  inference: 'Inference',
  dice: 'Dice',
  table: 'Table',
  slots: 'Slots',
  duel: 'Duel',
  other: 'Other',
};

export function Lobby() {
  // Filters live in the URL, so coming Back from a game restores the same view.
  const [params, setParams] = useSearchParams();
  const ai = useStore(evaluationSummaries);
  const ratings = useStore(ratingSummaries);
  const { showAi } = useStore(reviewPrefs);

  useEffect(() => {
    const search = params.toString();
    lobbyPath.set(search ? `/?${search}` : '/');
  }, [params]);

  const mechanic = (params.get('mechanic') as Mechanic | null) ?? null;
  const query = params.get('q') ?? '';
  const unrated = params.get('unrated') === '1';
  const picked = (params.get('sort') as Sort | null) ?? 'featured';
  const sorts = (Object.keys(SORT_LABELS) as Sort[]).filter((s) => (s !== 'ai' || showAi) && (s !== 'team' || ratingsEnabled));
  const sort: Sort = sorts.includes(picked) ? picked : 'featured';

  const update = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const mechanics = useMemo(() => [...new Set(games.map((g) => g.manifest.mechanic))], []);
  const needle = query.trim().toLowerCase();
  const visible = games.filter(
    (g) =>
      (!mechanic || g.manifest.mechanic === mechanic) &&
      (!needle || `${g.manifest.name} ${g.manifest.tagline}`.toLowerCase().includes(needle)) &&
      (!unrated || !ratings[g.manifest.id]?.mine),
  );
  const ordered = sortGames(
    visible,
    sort,
    (id) => ai[id]?.overall ?? null,
    (id) => {
      const r = ratings[id];
      return r?.count ? rankScore(r) : null;
    },
  );
  const filtered = Boolean(mechanic || needle || unrated);

  return (
    <main className="lobby">
      <section className="hero">
        <div className="hero-pulse" />
        <span className="hero-eyebrow">Provably fair · Instant play</span>
        <h1 className="hero-title">
          <span className="word-brand">{BRAND.name.toUpperCase()}</span>
          <span className="word-product">{BRAND.product.toUpperCase()}</span>
        </h1>
        <p className="hero-tagline">{BRAND.tagline}</p>
      </section>

      <div className="lobby-tools">
        <input
          type="search"
          className="lobby-search"
          placeholder={`Search ${games.length} games`}
          aria-label="Search games"
          value={query}
          onChange={(e) => update('q', e.target.value)}
        />
        <div className="segmented-mini" role="group" aria-label="Sort games">
          {sorts.map((s) => (
            <button key={s} className={sort === s ? 'on' : ''} aria-pressed={sort === s} onClick={() => update('sort', s === 'featured' ? null : s)}>
              {SORT_LABELS[s]}
            </button>
          ))}
        </div>
        {ratingsEnabled && (
          <button
            className={`chip ${unrated ? 'on' : ''}`}
            aria-pressed={unrated}
            onClick={() => update('unrated', unrated ? null : '1')}
            title="Only games you haven't rated yet"
          >
            Not rated by me
          </button>
        )}
      </div>

      {mechanics.length > 1 && (
        <nav className="filters" aria-label="Filter by mechanic">
          <button className={`chip ${mechanic === null ? 'on' : ''}`} onClick={() => update('mechanic', null)}>
            All
          </button>
          {mechanics.map((m) => (
            <button key={m} className={`chip ${mechanic === m ? 'on' : ''}`} onClick={() => update('mechanic', m)}>
              {MECHANIC_LABELS[m]}
            </button>
          ))}
        </nav>
      )}

      {visible.length === 0 &&
        (filtered ? (
          <p className="empty">
            No games match.{' '}
            <button className="link-button" onClick={() => setParams(sort === 'featured' ? {} : { sort }, { replace: true })}>
              Clear filters
            </button>
          </p>
        ) : (
          <p className="empty">No games yet. Run `npm run new-game` to add one.</p>
        ))}

      {SECTIONS.map((s) => (
        <Section key={s.title} title={s.title} subtitle={s.subtitle} entries={ordered.filter((g) => lobbySection(g.manifest) === s.section)} />
      ))}
    </main>
  );
}

/** Sorts within sections: scored games best first, unscored ones after in their usual order. */
function sortGames(entries: GameEntry[], sort: Sort, aiScore: (id: string) => number | null, teamScore: (id: string) => number | null) {
  if (sort === 'featured') return entries;
  if (sort === 'name') return [...entries].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  const score = sort === 'ai' ? aiScore : teamScore;
  return [...entries].sort((a, b) => {
    const sa = score(a.manifest.id);
    const sb = score(b.manifest.id);
    return Number(sb !== null) - Number(sa !== null) || (sb ?? 0) - (sa ?? 0);
  });
}

function Section({ title, subtitle, entries }: { title: string; subtitle: string; entries: GameEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="lobby-section">
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <span className="section-count">
          {entries.length} {entries.length === 1 ? 'game' : 'games'}
        </span>
      </div>
      <div className="lobby-grid">
        {entries.map((g, i) => (
          <GameTile key={g.manifest.id} manifest={g.manifest} index={i} />
        ))}
      </div>
    </section>
  );
}
