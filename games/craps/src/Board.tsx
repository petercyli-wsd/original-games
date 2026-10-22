// Craps visuals: the dice tray with two tumbling dice, the point track with
// its ON/OFF puck, and the betting table. Geometric, our own art.

import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import type { Marks } from './engine';
import {
  BET_NAME,
  POINTS,
  WAYS,
  betChance,
  layOddsPay,
  passOddsPay,
  pointChance,
  rollPaysLabel,
  type BetId,
  type FieldPays,
  type Layout,
  type Point,
  type RollId,
} from './math';

const PIPS: Record<number, number[]> = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

/** A flat die face (SVG), for prop cells and the recent-rolls row. */
export function DieFace({ n, size = 16 }: { n: number; size?: number }) {
  const at = [6.2, 12, 17.8];
  return (
    <svg className="cr-face" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="5" className="cr-face-bg" />
      {PIPS[n].map((c) => (
        <circle key={c} cx={at[c % 3]} cy={at[Math.floor(c / 3)]} r={n === 1 ? 3.1 : 2.2} className="cr-face-pip" />
      ))}
    </svg>
  );
}

/** Cube rotation that brings face n to the front (1 front, 6 back, 3 right, 4 left, 2 top, 5 bottom). */
export const FACE_ROT: Record<number, { x: number; y: number }> = {
  1: { x: 0, y: 0 },
  6: { x: 0, y: 180 },
  3: { x: 0, y: -90 },
  4: { x: 0, y: 90 },
  2: { x: -90, y: 0 },
  5: { x: 90, y: 0 },
};

export interface Rot {
  x: number;
  y: number;
  z: number;
}

const FACE_POS: Record<number, string> = {
  1: 'translateZ(calc(var(--die) / 2))',
  6: 'rotateY(180deg) translateZ(calc(var(--die) / 2))',
  3: 'rotateY(90deg) translateZ(calc(var(--die) / 2))',
  4: 'rotateY(-90deg) translateZ(calc(var(--die) / 2))',
  2: 'rotateX(90deg) translateZ(calc(var(--die) / 2))',
  5: 'rotateX(-90deg) translateZ(calc(var(--die) / 2))',
};

function CubeFace({ n }: { n: number }) {
  return (
    <div className="cr-cface" style={{ transform: FACE_POS[n] }}>
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} className={PIPS[n].includes(i) ? 'on' : ''} />
      ))}
    </div>
  );
}

export type TrayTone = 'idle' | 'win' | 'lose' | 'push' | 'info';

/** The two dice. `throwKey` alternates the throw animation so each roll replays it. */
export function DiceTray({
  rots,
  ms,
  throwKey,
  rolling,
  dice,
  verdict,
  tone,
}: {
  rots: Rot[];
  ms: number;
  throwKey: number;
  rolling: boolean;
  dice: [number, number];
  verdict: ReactNode;
  tone: TrayTone;
}) {
  return (
    <div className={`cr-tray ${tone}` + (rolling ? ' rolling' : '')} style={{ '--roll-ms': `${ms}ms` } as CSSProperties}>
      <div className="cr-tray-wall" aria-hidden="true" />
      <div className="cr-dice" role="img" aria-label={rolling ? 'Dice rolling' : `Dice show ${dice[0]} and ${dice[1]}`}>
        {rots.map((r, i) => (
          <div key={i} className={'cr-die-slot' + (throwKey > 0 ? (throwKey % 2 ? ' throw-a' : ' throw-b') : '')} style={{ animationDelay: `${i * 50}ms` }}>
            <div className="cr-die-tilt">
              <div
                className="cr-cube"
                style={{ transform: `rotateZ(${r.z}deg) rotateX(${r.x}deg) rotateY(${r.y}deg)`, transitionDuration: `${ms}ms`, transitionDelay: `${i * 50}ms` }}
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <CubeFace key={n} n={n} />
                ))}
              </div>
            </div>
            <div className="cr-die-shadow" />
          </div>
        ))}
      </div>
      <div className={'cr-verdict' + (rolling ? '' : ' on')} aria-live="polite">
        {verdict}
      </div>
    </div>
  );
}

const fmtPct = (p: number) => `${(p * 100).toFixed(1)}%`;

/**
 * The point boxes along the top of the layout, with the ON/OFF puck. Each box's
 * bar is P(point before 7). `resolved` lights the box of a point just made or
 * sevened out.
 */
export function PointTrack({ point, resolved }: { point: Point | null; resolved: { p: Point; made: boolean } | null }) {
  const idx = point === null ? 0 : POINTS.indexOf(point) + 1;
  return (
    <div className="cr-track">
      <div className="cr-track-home" aria-hidden="true">
        <span>Point</span>
      </div>
      {POINTS.map((p) => (
        <div
          key={p}
          className={'cr-box' + (point === p ? ' on' : '') + (resolved?.p === p ? (resolved.made ? ' made' : ' out') : '')}
          title={`${p}: ${WAYS[p]} ways vs 6 ways to 7, made ${fmtPct(pointChance(p))} of the time`}
        >
          <b>{p}</b>
          <small>{fmtPct(pointChance(p))}</small>
          <i className="cr-box-bar" style={{ width: `${pointChance(p) * 100}%` }} />
        </div>
      ))}
      <div className={'cr-puck' + (point === null ? ' off' : ' on')} style={{ '--i': idx } as CSSProperties} aria-label={point === null ? 'Point off' : `Point is ${point}`}>
        {point === null ? 'OFF' : 'ON'}
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
export const chipTier = (x: number) => (x >= 100 ? 't5' : x >= 25 ? 't4' : x >= 5 ? 't3' : x >= 1 ? 't2' : 't1');

export interface TableProps {
  /** The round is over: losing chips fade (otherwise they may still be riding). */
  over: boolean;
  table: Layout;
  /** Chips already working (charged) this round. */
  working: Layout;
  point: Point | null;
  field: FieldPays;
  marks: Marks | null;
  /** Which cells take chips right now. */
  canAdd(id: BetId): boolean;
  /** Max odds stake behind each line (point only). */
  oddsMax: Partial<Record<BetId, number>>;
  disabled: boolean;
  onAdd(id: BetId): void;
  onRemove(id: BetId): void;
  onHover(id: BetId | null): void;
  money(x: number): string;
}

const PROP_ART: Record<Exclude<RollId, 'field'>, ReactNode> = {
  any7: <strong className="cr-big7">7</strong>,
  anyCraps: (
    <span className="cr-sums">
      <em>2</em>
      <em>3</em>
      <em>12</em>
    </span>
  ),
  yo: (
    <span className="cr-pair">
      <DieFace n={5} />
      <DieFace n={6} />
    </span>
  ),
  aceDeuce: (
    <span className="cr-pair">
      <DieFace n={1} />
      <DieFace n={2} />
    </span>
  ),
  aces: (
    <span className="cr-pair">
      <DieFace n={1} />
      <DieFace n={1} />
    </span>
  ),
  twelve: (
    <span className="cr-pair">
      <DieFace n={6} />
      <DieFace n={6} />
    </span>
  ),
};

const KEY_HINT: Partial<Record<BetId, string>> = { pass: 'P', dontPass: 'N', passOdds: 'O', layOdds: 'L', field: 'F', any7: '7', anyCraps: 'A', yo: 'Y' };

export function Table({ over, table, working, point, field, marks, canAdd, oddsMax, disabled, onAdd, onRemove, onHover, money }: TableProps) {
  const cell = (id: BetId, body: ReactNode, pays: string, extra?: string) => {
    const amt = table[id] ?? 0;
    const won = marks?.won[id];
    const lost = !!marks?.lost.includes(id);
    const push = !!marks?.push.includes(id);
    const able = canAdd(id);
    const isOdds = id === 'passOdds' || id === 'layOdds';
    const locked = !able && amt <= 0;
    const remove = (e: MouseEvent) => {
      e.preventDefault();
      if (!disabled) onRemove(id);
    };
    const pending = amt - (working[id] ?? 0);
    return (
      <button
        key={id}
        type="button"
        data-bet={id}
        className={
          `cr-cell c-${id}` +
          (amt > 0 ? ' placed' : '') +
          (won !== undefined ? ' won' : '') +
          (lost ? ' lost' : '') +
          (push ? ' push' : '') +
          (locked ? ' locked' : '') +
          (extra ? ` ${extra}` : '')
        }
        disabled={disabled || (!able && !(pending > 0))}
        aria-label={`${BET_NAME[id]}, pays ${pays}${amt > 0 ? `, ${money(amt)} placed` : ''}`}
        onClick={(e) => (e.shiftKey ? remove(e) : able && onAdd(id))}
        onContextMenu={remove}
        onMouseEnter={() => onHover(id)}
        onFocus={() => onHover(id)}
      >
        <span className="cr-cell-body">{body}</span>
        <span className="cr-pays">{won !== undefined ? `+${money(won)}` : push ? 'push' : pays}</span>
        {KEY_HINT[id] && <kbd className="cr-key">{KEY_HINT[id]}</kbd>}
        <i className="cr-odds-bar" style={{ width: `${(isOdds && point === null ? 0 : betChance(id, point)) * 100}%` }} aria-hidden="true" />
        {amt > 0 && (
          <span key={amt} className={`cr-chip ${chipTier(amt)}` + ((working[id] ?? 0) > 0 ? ' working' : '')}>
            {chipText(amt)}
          </span>
        )}
        {isOdds && point !== null && able && oddsMax[id] !== undefined && <span className="cr-max">max {money(oddsMax[id]!)}</span>}
      </button>
    );
  };

  const oddsPays = (id: 'passOdds' | 'layOdds') => {
    if (point === null) return 'after a point';
    const r = id === 'passOdds' ? passOddsPay(point) : layOddsPay(point);
    const frac: Record<string, string> = { '2': '2:1', '1.5': '3:2', '1.2': '6:5', '0.5': '1:2', '0.666667': '2:3', '0.833333': '5:6' };
    return frac[String(+r.toFixed(6))] ?? `${r.toFixed(2)}:1`;
  };

  return (
    <div className={'cr-table' + (marks ? ' resolved' : '') + (over ? ' over' : '')} onMouseLeave={() => onHover(null)}>
      {cell(
        'pass',
        <>
          <strong className="cr-word">Pass Line</strong>
          <span className="cr-sub">{point === null ? '7 · 11 win · 2 · 3 · 12 lose' : `${point} wins · 7 loses`}</span>
        </>,
        '1:1',
      )}
      {cell(
        'passOdds',
        <>
          <strong className="cr-word sm">Odds</strong>
          <span className="cr-sub">behind pass</span>
        </>,
        oddsPays('passOdds'),
      )}
      {cell(
        'dontPass',
        <>
          <strong className="cr-word">Don&rsquo;t Pass</strong>
          <span className="cr-sub">
            {point === null ? (
              <>
                2 · 3 win · bar <DieFace n={6} size={12} />
                <DieFace n={6} size={12} /> push
              </>
            ) : (
              `7 wins · ${point} loses`
            )}
          </span>
        </>,
        '1:1',
      )}
      {cell(
        'layOdds',
        <>
          <strong className="cr-word sm">Lay odds</strong>
          <span className="cr-sub">behind don&rsquo;t</span>
        </>,
        oddsPays('layOdds'),
      )}
      {cell(
        'field',
        <>
          <strong className="cr-word">Field</strong>
          <span className="cr-field-nums">
            {[2, 3, 4, 9, 10, 11, 12].map((n) => (
              <em key={n} className={n === 2 || n === 12 ? 'ring' : ''}>
                {n}
                {n === 2 && <sup>2×</sup>}
                {n === 12 && <sup>{field === 'triple' ? '3×' : '2×'}</sup>}
              </em>
            ))}
          </span>
        </>,
        rollPaysLabel('field', field),
      )}
      {(['any7', 'anyCraps', 'yo', 'aceDeuce', 'aces', 'twelve'] as const).map((id) =>
        cell(
          id,
          <>
            {PROP_ART[id]}
            <span className="cr-prop-name">{BET_NAME[id]}</span>
          </>,
          rollPaysLabel(id, field),
          'prop',
        ),
      )}
    </div>
  );
}
