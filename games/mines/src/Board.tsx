import { fmtMult } from '@originals/game-sdk/ui';
import { type CSSProperties } from 'react';
import { TILES, gemsFor, multiplier } from './math';

/** A faceted gem: geometric cut, house green. */
export function Gem() {
  return (
    <svg viewBox="0 0 64 64" className="mines-gem" aria-hidden="true">
      <polygon points="12,23 22,11 42,11 52,23 32,55" className="g-edge" />
      <polygon points="22,11 42,11 37,23 27,23" fill="#bbf7d0" />
      <polygon points="12,23 22,11 27,23" fill="#86efac" />
      <polygon points="42,11 52,23 37,23" fill="#22c55e" />
      <polygon points="12,23 27,23 32,55" fill="#4ade80" />
      <polygon points="27,23 37,23 32,55" fill="#86efac" />
      <polygon points="37,23 52,23 32,55" fill="#15803d" />
      <path d="M21 16.5 l1.3 3 3 1.3 -3 1.3 -1.3 3 -1.3 -3 -3 -1.3 3 -1.3 z" fill="#fff" className="g-spark" />
    </svg>
  );
}

/** A mine: a red core with eight studs. */
export function Mine() {
  const studs = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
  return (
    <svg viewBox="0 0 64 64" className="mines-mine" aria-hidden="true">
      {studs.map((a) => (
        <line key={a} x1={32 + 12 * Math.cos(a)} y1={32 + 12 * Math.sin(a)} x2={32 + 22 * Math.cos(a)} y2={32 + 22 * Math.sin(a)} className="m-stud" />
      ))}
      <circle cx="32" cy="32" r="16" fill="#e9113c" stroke="#8a0a25" strokeWidth="2.5" />
      <path d="M20.5 29 A12 12 0 0 1 35 20.5" fill="none" stroke="#ff8a9e" strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="32" r="6" className="m-eye" />
    </svg>
  );
}

export interface GridView {
  /** Mine layout, once a round exists. */
  board: readonly boolean[] | null;
  /** Revealed tiles, in order. */
  revealed: readonly number[];
  /** The mine that ended the round. */
  hit: number | null;
  /** Show every other tile (dimmed) at the end of a round. */
  showAll: boolean;
  /** The tile being flipped right now. */
  pending: number | null;
}

export interface GridProps extends GridView {
  /** Auto tiles, in the order they will be revealed. */
  selection: readonly number[];
  /** Whether a click on a hidden tile does something (reveal or select). */
  clickable: boolean;
  /** Paint the selection (Auto mode). */
  showSelection: boolean;
  onTile(tile: number): void;
  /** Bumped on a mine hit, to replay the shake. */
  shakeKey: number;
}

export function Grid({ board, revealed, hit, showAll, pending, selection, clickable, showSelection, onTile, shakeKey }: GridProps) {
  const open = new Set(revealed);
  return (
    <div key={shakeKey} className={'mines-grid' + (hit !== null ? ' shake' : '') + (clickable ? ' live' : '')} role="grid" aria-label="Mines board">
      {Array.from({ length: TILES }, (_, t) => {
        const isOpen = open.has(t) && t !== pending;
        const isMine = board ? board[t] : false;
        const ghost = !isOpen && showAll && board !== null;
        const selIndex = showSelection ? selection.indexOf(t) : -1;
        let cls = 'mines-tile';
        if (isOpen) cls += isMine ? ' mine' : ' gem';
        if (t === hit) cls += ' hit';
        if (ghost) cls += ' ghost ' + (isMine ? 'mine' : 'gem');
        if (t === pending) cls += ' pending';
        if (selIndex >= 0) cls += ' sel';
        const can = clickable && !isOpen && t !== pending;
        const label = isOpen || ghost ? (isMine ? 'mine' : 'gem') : selIndex >= 0 ? `selected ${selIndex + 1}` : 'hidden';
        return (
          <button
            key={t}
            type="button"
            className={cls}
            disabled={!can}
            aria-label={`Tile ${Math.floor(t / 5) + 1}-${(t % 5) + 1}: ${label}`}
            style={{ '--d': `${ghost ? (t % 5) * 18 + Math.floor(t / 5) * 18 : 0}ms` } as CSSProperties}
            onClick={() => onTile(t)}
          >
            <span className="mines-face">{(isOpen || ghost) && (isMine ? <Mine /> : <Gem />)}</span>
            {selIndex >= 0 && !isOpen && !ghost && <i className="mines-order">{selIndex + 1}</i>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The payout ladder: a window of the next few gem counts and what each pays,
 * with gems already found ticked off and the next one highlighted.
 */
export function Ladder({ mines, found, target, showNext }: { mines: number; found: number; target: number | null; showNext: boolean }) {
  const g = gemsFor(mines);
  const focus = target ?? found + 1;
  const width = 8;
  const start = Math.max(1, Math.min(focus - (target ? 3 : 2), g - width + 1));
  const steps = Array.from({ length: Math.min(width, g - start + 1) }, (_, i) => start + i);
  return (
    <div className="mines-ladder" aria-label="Payout per gem found">
      {steps.map((k) => {
        const cls = k <= found ? 'done' : k === focus && showNext ? 'next' : '';
        return (
          <div key={k} className={'mines-rung ' + cls}>
            <b>{fmtMult(multiplier(mines, k))}</b>
            <span>
              {k} {k === 1 ? 'gem' : 'gems'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
