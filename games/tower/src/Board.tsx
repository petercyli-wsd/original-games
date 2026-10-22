// The tower: nine rows of tiles stacked bottom-up, with each row's cash-out
// multiplier on the left and the summit prize on top. Geometric art only:
// a faceted crystal for a safe tile, a spiked trap for a losing one.

import { fmtMult } from '@originals/game-sdk/ui';
import type { CSSProperties } from 'react';
import { DIFFICULTY, ROWS, multiplier, type Difficulty, type Tower } from './math';

export function Crystal() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className="tw-crystal">
      <polygon points="20,3 33,13 28,36 12,36 7,13" className="c-body" />
      <polygon points="20,3 33,13 20,17 7,13" className="c-top" />
      <polygon points="20,17 33,13 28,36 20,36" className="c-side" />
      <polyline points="7,13 20,17 33,13" className="c-edge" />
      <line x1="20" y1="17" x2="20" y2="36" className="c-edge" />
      <circle cx="14" cy="11" r="1.6" className="c-glint" />
    </svg>
  );
}

export function Trap() {
  const spikes = Array.from({ length: 16 }, (_, i) => {
    const a = (i * Math.PI) / 8 - Math.PI / 2;
    const r = i % 2 === 0 ? 17 : 9.5;
    return `${(20 + r * Math.cos(a)).toFixed(2)},${(20 + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className="tw-trap">
      <polygon points={spikes} className="t-spikes" />
      <circle cx="20" cy="20" r="7.5" className="t-core" />
      <path d="M16.5 16.5 L23.5 23.5 M23.5 16.5 L16.5 23.5" className="t-x" />
    </svg>
  );
}

function Flag() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="tw-flag">
      <line x1="5" y1="2" x2="5" y2="18" />
      <polygon points="5,3 16,6.5 5,10" />
    </svg>
  );
}

export interface TowerView {
  difficulty: Difficulty;
  /** The real tower (null for an idle preview or an auto selection board). */
  tower: Tower | null;
  /** Columns picked so far, row by row (the last one is the trap on a bust). */
  picks: number[];
  /** The row whose trap ended the round. */
  bust: number | null;
  /** The tile flipping right now. */
  pending: { row: number; col: number } | null;
  /** Reveal every tile (the round is over). */
  showAll: boolean;
  /** The row the player picks in next, while live. */
  active: number | null;
}

export function TowerBoard({
  view,
  selection,
  target,
  clickable,
  onTile,
  shakeKey,
  won,
  hotkeys,
}: {
  view: TowerView;
  /** Auto: the preset column per row (-1 = random), or null in manual. */
  selection: number[] | null;
  /** Auto: the target row count. */
  target: number | null;
  clickable: boolean;
  onTile(row: number, col: number): void;
  shakeKey: number;
  /** Highlights the cleared rows in gold after a cash-out or summit. */
  won: boolean;
  /** Shows 1–4 key hints on the active row. */
  hotkeys: boolean;
}) {
  const { difficulty: d, tower, picks, bust, pending, showAll, active } = view;
  const { tiles } = DIFFICULTY[d];
  const cleared = bust === null ? picks.length : bust;
  const topReached = cleared >= ROWS;

  const rows = Array.from({ length: ROWS }, (_, i) => ROWS - 1 - i);

  return (
    <div
      key={shakeKey}
      className={'tw-tower' + (shakeKey > 0 && bust !== null ? ' shake' : '') + (clickable ? ' live' : '') + (won ? ' won' : '')}
      style={{ '--cols': tiles } as CSSProperties}
    >
      <div className={'tw-summit' + (topReached && won ? ' reached' : '') + (target === ROWS ? ' targeted' : '')}>
        <Flag />
        <span>Summit</span>
        <b>{fmtMult(multiplier(d, ROWS))}</b>
      </div>

      {rows.map((r) => {
        const isActive = active === r;
        const isDone = r < cleared;
        const isBust = bust === r;
        const isSel = selection !== null && target !== null && r < target;
        const isTarget = target !== null && r === target - 1;
        const cls = ['tw-row', isActive && 'active', isDone && 'done', isBust && 'bust', isSel && 'sel', isTarget && 'target', active !== null && r > active && 'future']
          .filter(Boolean)
          .join(' ');
        const randomRow = isSel && selection![r] === -1;
        return (
          <div key={r} className={cls} style={{ '--row': r } as CSSProperties}>
            <div className="tw-mult">
              <span className="tw-rn">{r + 1}</span>
              <b>{fmtMult(multiplier(d, r + 1))}</b>
            </div>
            <div className={'tw-tiles' + (randomRow ? ' random' : '')}>
              {Array.from({ length: tiles }, (_, c) => {
                const picked = picks[r] === c && r < picks.length;
                const flipping = pending?.row === r && pending.col === c;
                const safe = tower ? tower[r][c] : null;
                const revealed = picked || (showAll && tower !== null);
                const chosen = isSel && selection![r] === c;
                const tcls = [
                  'tw-tile',
                  revealed && 'open',
                  revealed && (safe ? 'is-safe' : 'is-trap'),
                  picked && 'picked',
                  revealed && !picked && 'dim',
                  flipping && 'flipping',
                  chosen && 'chosen',
                ]
                  .filter(Boolean)
                  .join(' ');
                const canClick = clickable && (selection !== null || isActive) && !pending;
                return (
                  <button
                    key={c}
                    type="button"
                    className={tcls}
                    disabled={!canClick}
                    aria-label={`Row ${r + 1}, tile ${c + 1}${revealed ? (safe ? ', safe' : ', trap') : ''}`}
                    onClick={() => onTile(r, c)}
                    style={{ '--c': c } as CSSProperties}
                  >
                    <span className="tw-face">
                      {flipping ? null : revealed ? safe ? <Crystal /> : <Trap /> : chosen ? <i className="tw-dot" /> : isActive && hotkeys && tiles <= 4 ? <kbd>{c + 1}</kbd> : null}
                    </span>
                  </button>
                );
              })}
              {randomRow && <span className="tw-random-tag">random</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
