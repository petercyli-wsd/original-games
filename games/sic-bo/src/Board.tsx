// Sic Bo visuals: flat die faces (light square, dark pips), the three dice in the
// tray, and the table of bet cells.

import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { BETS, betStats, paysLabel, type BetDef, type Layout } from './math';

/** Pip cells (row-major in a 3×3 grid) for each face. */
const PIPS: Record<number, number[]> = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

/** A flat die face as SVG: a light square with dark pips. */
export function DieFace({ n, size = 18, className }: { n: number; size?: number; className?: string }) {
  const at = [6.2, 12, 17.8];
  return (
    <svg className={'sb-face-svg' + (className ? ` ${className}` : '')} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="3" className="sb-face-bg" />
      {PIPS[n].map((c) => (
        <circle key={c} cx={at[c % 3]} cy={at[Math.floor(c / 3)]} r={n === 1 ? 3.1 : 2.15} className="sb-pip" />
      ))}
    </svg>
  );
}

/** The three dice. `hop` alternates to restart the slide-in animation on every roll. */
export function DiceTray({ ms, hop, rolling, faces, state }: { ms: number; hop: number; rolling: boolean; faces: number[]; state: 'idle' | 'win' | 'lose' }) {
  return (
    <div className={`sb-tray ${state}`} style={{ '--roll-ms': `${ms}ms` } as CSSProperties}>
      <div className="sb-dice" role="img" aria-label={rolling ? 'Dice rolling' : `Dice show ${faces.join(', ')}`}>
        {faces.map((n, i) => (
          <div
            key={i}
            className={'sb-die-slot' + (hop > 0 ? (hop % 2 ? ' hop-a' : ' hop-b') : '')}
            style={{ '--spin': ['-270deg', '270deg', '-180deg'][i] } as CSSProperties}
          >
            <DieFace n={n} size={64} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Compact chip text: 0.5, 12, 2.5k. */
export function chipText(x: number): string {
  if (x >= 1_000_000) return `${+(x / 1_000_000).toFixed(1)}m`;
  if (x >= 10_000) return `${Math.round(x / 1000)}k`;
  if (x >= 1000) return `${+(x / 1000).toFixed(1)}k`;
  if (x >= 100) return `${Math.round(x)}`;
  return `${+x.toFixed(2)}`;
}

function CellBody({ bet }: { bet: BetDef }) {
  switch (bet.kind) {
    case 'small':
    case 'big':
      return (
        <>
          <strong className="sb-big-word">{bet.name}</strong>
          <span className="sb-range">{bet.kind === 'small' ? '4 – 10' : '11 – 17'}</span>
        </>
      );
    case 'odd':
    case 'even':
      return <strong className="sb-mid-word">{bet.name}</strong>;
    case 'anyTriple':
      return <strong className="sb-any">Any triple</strong>;
    case 'double':
      return (
        <span className="sb-faces">
          <DieFace n={bet.a!} />
          <DieFace n={bet.a!} />
        </span>
      );
    case 'triple':
      return (
        <span className="sb-faces">
          <DieFace n={bet.a!} size={15} />
          <DieFace n={bet.a!} size={15} />
          <DieFace n={bet.a!} size={15} />
        </span>
      );
    case 'total':
      return <strong className="sb-total">{bet.a}</strong>;
    case 'combo':
      return (
        <span className="sb-faces">
          <DieFace n={bet.a!} />
          <DieFace n={bet.b!} />
        </span>
      );
    case 'single':
      return (
        <span className="sb-faces">
          <DieFace n={bet.a!} size={24} />
        </span>
      );
  }
}

const ROWS: { cls: string; kinds: BetDef['kind'][] }[] = [
  { cls: 'r1', kinds: ['small', 'odd', 'anyTriple', 'even', 'big'] },
  { cls: 'r2', kinds: ['double', 'triple'] },
  { cls: 'r3', kinds: ['total'] },
  { cls: 'r4', kinds: ['combo'] },
  { cls: 'r5', kinds: ['single'] },
];

export interface TableProps {
  layout: Layout;
  /** Bets the last roll would pay (lit), or null while no result is shown. */
  hits: Set<string> | null;
  /** Amount each winning bet paid on the last roll. */
  paid: Record<string, number>;
  disabled: boolean;
  onAdd(id: string): void;
  onRemove(id: string): void;
  money(x: number): string;
}

export function Table({ layout, hits, paid, disabled, onAdd, onRemove, money }: TableProps) {
  const cell = (bet: BetDef): ReactNode => {
    const amt = layout[bet.id] ?? 0;
    const hit = !!hits?.has(bet.id);
    const won = hit && amt > 0;
    const lost = !!hits && amt > 0 && !hit;
    const s = betStats(bet.id);
    const remove = (e: MouseEvent) => {
      e.preventDefault();
      if (!disabled) onRemove(bet.id);
    };
    return (
      <button
        key={bet.id}
        type="button"
        data-bet={bet.id}
        className={`sb-cell k-${bet.kind}` + (amt > 0 ? ' placed' : '') + (hit ? ' hit' : '') + (won ? ' won' : '') + (lost ? ' lost' : '')}
        disabled={disabled}
        aria-label={`${bet.name}, pays ${paysLabel(bet)}, ${s.wins} of 216 rolls${amt > 0 ? `, ${money(amt)} placed` : ''}`}
        onClick={(e) => (e.shiftKey ? remove(e) : onAdd(bet.id))}
        onContextMenu={remove}
      >
        <span className="sb-cell-body">
          <CellBody bet={bet} />
        </span>
        <span className="sb-pays">{won ? `+${money(paid[bet.id] ?? 0)}` : paysLabel(bet)}</span>
        {amt > 0 && <span className="sb-chip">{chipText(amt)}</span>}
      </button>
    );
  };

  return (
    <div className={'sb-table' + (hits ? ' resolved' : '')}>
      {ROWS.map((r) => (
        <div key={r.cls} className={`sb-row ${r.cls}`}>
          {r.kinds.flatMap((k) => BETS.filter((b) => b.kind === k)).map(cell)}
        </div>
      ))}
    </div>
  );
}
