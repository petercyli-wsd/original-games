import { useEffect, useMemo, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BRAND } from '../brand';
import { GameFrame } from '../components/GameFrame';
import { StatsPanel } from '../components/StatsPanel';
import { createHost } from '../host/session';
import { findGame } from '../registry';
import { NotFound } from './NotFound';

export function GamePage() {
  const { gameId } = useParams();
  const entry = findGame(gameId);
  const host = useMemo(() => (entry ? createHost(entry.manifest.id) : null), [entry]);

  useEffect(() => {
    if (!entry) return;
    document.title = `${entry.manifest.name} · ${BRAND.name} ${BRAND.product}`;
    return () => {
      document.title = `${BRAND.name} ${BRAND.product}`;
    };
  }, [entry]);

  if (!entry || !host) return <NotFound />;
  const { manifest } = entry;

  return (
    <main className="game-page" style={{ '--accent': manifest.accent } as CSSProperties}>
      <div className="game-heading">
        <Link to="/" className="back-link">
          ← Lobby
        </Link>
        <div>
          <h1>{manifest.name}</h1>
          <p>{manifest.tagline}</p>
        </div>
        {manifest.status !== 'live' && <span className={`status status-${manifest.status}`}>{manifest.status}</span>}
      </div>
      <div className="game-layout">
        <GameFrame entry={entry} host={host} />
        <StatsPanel manifest={manifest} />
      </div>
    </main>
  );
}
