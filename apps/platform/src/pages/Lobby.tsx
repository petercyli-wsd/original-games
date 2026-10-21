import type { GameStatus, Mechanic } from '@originals/game-sdk';
import { useMemo, useState } from 'react';
import { BRAND } from '../brand';
import { GameTile } from '../components/GameTile';
import { games, type GameEntry } from '../registry';

const SECTIONS: { title: string; subtitle: string; statuses: GameStatus[] }[] = [
  { title: `Core ${BRAND.product}`, subtitle: 'Click any game to play instantly', statuses: ['live', 'beta'] },
  { title: 'Experimental', subtitle: 'Fresh probability prototypes and new mechanics', statuses: ['prototype'] },
  { title: 'Templates', subtitle: 'Starting points for new games (dev only)', statuses: ['template'] },
];

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
  duel: 'Duel',
  other: 'Other',
};

export function Lobby() {
  const [mechanic, setMechanic] = useState<Mechanic | null>(null);
  const mechanics = useMemo(() => [...new Set(games.map((g) => g.manifest.mechanic))], []);
  const visible = mechanic ? games.filter((g) => g.manifest.mechanic === mechanic) : games;

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

      {mechanics.length > 1 && (
        <nav className="filters" aria-label="Filter by mechanic">
          <button className={`chip ${mechanic === null ? 'on' : ''}`} onClick={() => setMechanic(null)}>
            All
          </button>
          {mechanics.map((m) => (
            <button key={m} className={`chip ${mechanic === m ? 'on' : ''}`} onClick={() => setMechanic(m)}>
              {MECHANIC_LABELS[m]}
            </button>
          ))}
        </nav>
      )}

      {visible.length === 0 && <p className="empty">No games yet. Run `npm run new-game` to add one.</p>}

      {SECTIONS.map((section) => (
        <Section key={section.title} {...section} entries={visible.filter((g) => section.statuses.includes(g.manifest.status))} />
      ))}
    </main>
  );
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
