import { TILES } from './math';
import { type CSSProperties } from 'react';

export interface GridView {
  /** Mine layout, once a round exists. */
  board: readonly boolean[] | null;
  /** Revealed tiles, in order. */
  revealed: readonly number[];
  /** The mine that ended the round. */
  hit: number | null;
  /** Show every other tile (as a small dot) at the end of a round. */
  showAll: boolean;
  /** The tile being revealed right now. */
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
}

/**
 * Flat squares. Hidden: neutral. Revealed gem: --win. Mine: --lose.
 * The tile the player just picked (and the Auto selection) is outlined in the accent.
 */
export function Grid({ board, revealed, hit, showAll, pending, selection, clickable, showSelection, onTile }: GridProps) {
  const open = new Set(revealed);
  const lastPick = pending ?? (showSelection ? null : revealed.length ? revealed[revealed.length - 1] : null);
  return (
    <div className={'mines-grid' + (clickable ? ' live' : '')} role="grid" aria-label="Mines board">
      {Array.from({ length: TILES }, (_, t) => {
        const isOpen = open.has(t) && t !== pending;
        const isMine = board ? board[t] : false;
        const ghost = !isOpen && showAll && board !== null;
        const selIndex = showSelection ? selection.indexOf(t) : -1;
        let cls = 'mines-tile';
        if (isOpen) cls += isMine ? ' mine' : ' gem';
        if (t === hit) cls += ' hit';
        if (ghost) cls += ' ghost ' + (isMine ? 'mine' : 'gem');
        if (t === lastPick || selIndex >= 0) cls += ' pick';
        const can = clickable && !isOpen && t !== pending;
        const label = isOpen || ghost ? (isMine ? 'mine' : 'gem') : selIndex >= 0 ? `selected ${selIndex + 1}` : 'hidden';
        return (
          <button
            key={t}
            type="button"
            className={cls}
            disabled={!can}
            aria-label={`Tile ${Math.floor(t / 5) + 1}-${(t % 5) + 1}: ${label}`}
            style={{ '--tile': t } as CSSProperties}
            onClick={() => onTile(t)}
          >
            {ghost && <i className="mines-dot" />}
            {selIndex >= 0 && !isOpen && !ghost && <i className="mines-order">{selIndex + 1}</i>}
          </button>
        );
      })}
    </div>
  );
}
