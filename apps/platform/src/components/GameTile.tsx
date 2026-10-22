import { formatMultiplier, formatPercent, type GameManifest } from '@originals/game-sdk';
import type { CSSProperties, PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { Emblem } from './Emblem';
import { RatingChip } from './RatingChip';

// Moves the accent aura to follow the pointer.
function trackPointer(e: PointerEvent<HTMLAnchorElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`);
}

export function GameTile({ manifest, index }: { manifest: GameManifest; index: number }) {
  const style = { '--accent': manifest.accent, animationDelay: `${0.05 + index * 0.05}s` } as CSSProperties;
  return (
    <Link to={`/play/${manifest.id}`} className="game-tile" style={style} onPointerMove={trackPointer} aria-label={`Play ${manifest.name}`}>
      <span className="tile-aura" />
      <span className="tile-sheen" />
      <Emblem mechanic={manifest.mechanic} />
      <div className="tile-body">
        <h3 className="tile-name">{manifest.name}</h3>
        <p className="tile-tagline">{manifest.tagline}</p>
      </div>
      <RatingChip gameId={manifest.id} />
      <div className="tile-foot">
        <span className="tile-chip">RTP {formatPercent(manifest.rtp)}</span>
        <span className="tile-chip">Max {formatMultiplier(manifest.maxMultiplier)}</span>
        <span className="tile-play">Play →</span>
      </div>
    </Link>
  );
}
