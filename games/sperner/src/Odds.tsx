import { fmtChance } from '@originals/game-sdk/ui';
import type { ReactNode } from 'react';
import { PALETTE } from './Board';
import { COLOUR_NAMES, type Column } from './math';

/** A bar's chance, short enough to sit above a narrow bar. */
function pct(p: number): string {
  if (p <= 0) return '–';
  if (p >= 0.9995) return '100%';
  if (p < 0.001) return '<0.1%';
  if (p < 0.1) return `${(p * 100).toFixed(1)}%`;
  return `${Math.round(p * 100)}%`;
}

export interface OddsProps {
  columns: Column[];
  /** Total of the green bars: the live win chance. */
  p: number;
  found: number;
  /** Where the chance goes for each colour of the next vertex (checkpoints only). */
  swing: { colour: number; p: number }[] | null;
  idle: boolean;
  /** Fades the panel under the round-over card. */
  over: boolean;
  children?: ReactNode;
}

export default function Odds({ columns, p, found, swing, idle, over, children }: OddsProps) {
  return (
    <div className={'sp-odds' + (over ? ' over' : '')}>
      <div className="sp-odds-body">
      <div className="sp-odds-head">
        <span>Final rainbow count</span>
        <span className={'sp-found' + (found > 0 ? ' on' : '')}>
          <svg viewBox="0 0 20 18" aria-hidden="true">
            <polygon points="10,1 1,17 19,17" fill={PALETTE[0]} />
            <polygon points="1,17 19,17 10,9" fill={PALETTE[1]} />
            <polygon points="19,17 10,1 10,9" fill={PALETTE[2]} />
          </svg>
          {found} found
        </span>
      </div>

      <div className="sp-bars" role="list" aria-label="Chance of each final rainbow count">
        {columns.map((c) => (
          <div
            key={c.label}
            role="listitem"
            className={'sp-col ' + (c.win ? 'win' : 'lose') + (c.to < found ? ' gone' : '')}
            aria-label={`${c.label} rainbows: ${fmtChance(c.p)}${c.win ? ', a win' : ''}`}
          >
            <span className="sp-pct">{pct(c.p)}</span>
            <span className="sp-track">
              <i style={{ height: `${Math.min(1, c.p) * 100}%`, minHeight: c.p > 0 ? 2 : 0 }} />
            </span>
            <span className="sp-k">{c.label}</span>
          </div>
        ))}
      </div>

      <p className="sp-odds-note">
        Bar height is the exact chance of each final count. <b className="sp-g">Green bars</b> win your bet and add up to <b>{fmtChance(p)}</b>.
        {idle && ' Even counts never happen: that is Sperner’s lemma.'}
      </p>

      {swing && (
        <div className="sp-swing">
          <span>Next vertex</span>
          {swing.map((o) => (
            <span key={o.colour} className={'sp-opt ' + (o.p > p + 1e-12 ? 'up' : o.p < p - 1e-12 ? 'down' : 'flat')}>
              <i style={{ background: PALETTE[o.colour] }} />
              {COLOUR_NAMES[o.colour]}
              <b>
                {o.p > p + 1e-12 ? '▲' : o.p < p - 1e-12 ? '▼' : '•'} {fmtChance(o.p)}
              </b>
            </span>
          ))}
        </div>
      )}
      </div>

      {children}
    </div>
  );
}
