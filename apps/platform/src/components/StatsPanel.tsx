import { formatAmount, formatMultiplier, formatPercent, type GameManifest } from '@originals/game-sdk';
import { useStore } from '@originals/game-sdk/react';
import { EMPTY_STATS, resetStats, sessionStats } from '../host/session';

/** This session's numbers for one game: useful when judging a prototype. */
export function StatsPanel({ manifest }: { manifest: GameManifest }) {
  const s = useStore(sessionStats)[manifest.id] ?? EMPTY_STATS;
  const rows: [string, string][] = [
    ['Rounds', String(s.rounds)],
    ['Wagered', formatAmount(s.wagered, 2)],
    ['Net', formatAmount(s.returned - s.wagered, 2)],
    ['Observed RTP', s.wagered ? formatPercent(s.returned / s.wagered) : '—'],
    ['Hit rate', s.rounds ? formatPercent(s.wins / s.rounds) : '—'],
    ['Avg round', s.rounds ? `${(s.totalMs / s.rounds / 1000).toFixed(1)}s` : '—'],
    ['Checkpoints', String(s.checkpoints)],
    ['Best', s.bestMultiplier ? formatMultiplier(s.bestMultiplier) : '—'],
  ];

  return (
    <aside className="stats-panel">
      <div className="panel-head">
        <h2>Session</h2>
        <button className="btn-link" onClick={() => resetStats(manifest.id)} disabled={!s.rounds}>
          Reset
        </button>
      </div>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="panel-head">
        <h2>Game</h2>
      </div>
      <dl>
        <div>
          <dt>Target RTP</dt>
          <dd>{formatPercent(manifest.rtp)}</dd>
        </div>
        <div>
          <dt>Max win</dt>
          <dd>{formatMultiplier(manifest.maxMultiplier)}</dd>
        </div>
        <div>
          <dt>Volatility</dt>
          <dd className="caps">{manifest.volatility.join(' · ')}</dd>
        </div>
        <div>
          <dt>Checkpoints</dt>
          <dd>{manifest.checkpoints ? 'Yes' : 'No'}</dd>
        </div>
      </dl>
    </aside>
  );
}
