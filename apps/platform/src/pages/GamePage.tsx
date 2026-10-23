import { useEffect, useMemo, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BRAND } from '../brand';
import { GameFrame } from '../components/GameFrame';
import { AiReview } from '../components/AiReview';
import { HumanReviews } from '../components/HumanReviews';
import { StatsPanel } from '../components/StatsPanel';
import { createHost } from '../host/session';
import { lobbyPath } from '../lib/preferences';
import { ratingsEnabled } from '../lib/ratings';
import { adjacentGames, findGame } from '../registry';
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
  const adjacent = adjacentGames(manifest.id);

  return (
    <main key={manifest.id} className="game-page" style={{ '--accent': manifest.accent } as CSSProperties}>
      <div className="game-heading">
        <Link to={lobbyPath.get()} className="back-link">
          ← Lobby
        </Link>
        <div>
          <h1>{manifest.name}</h1>
          <p>{manifest.tagline}</p>
        </div>
        {manifest.status !== 'live' && <span className={`status status-${manifest.status}`}>{manifest.status}</span>}
        {adjacent && (
          <nav className="game-step" aria-label="Other games">
            <Link to={`/play/${adjacent.prev.manifest.id}`} title={`Previous: ${adjacent.prev.manifest.name}`}>
              ‹ <span>{adjacent.prev.manifest.name}</span>
            </Link>
            <Link to={`/play/${adjacent.next.manifest.id}`} title={`Next: ${adjacent.next.manifest.name}`}>
              <span>{adjacent.next.manifest.name}</span> ›
            </Link>
          </nav>
        )}
      </div>
      <div className="game-layout">
        <GameFrame entry={entry} host={host} />
        <div className="side-col">
          {ratingsEnabled && (
            <a href="#reviews" className="review-jump">
              ★ Review this game
            </a>
          )}
          <StatsPanel manifest={manifest} />
        </div>
      </div>
      <div className="review-grid">
        <HumanReviews gameId={manifest.id} />
        <AiReview gameId={manifest.id} />
      </div>
    </main>
  );
}
