// The Plinko board: a triangle of pegs, the row of buckets with their
// multipliers, and under them a bar per bucket whose height is that bucket's
// exact chance C(n,k)/2ⁿ. Balls are positioned imperatively by the game's
// animation loop (see Game.tsx); this component only lays out the scene and
// hands out element refs for the pegs, buckets and balls.

import { memo } from 'react';
import { VIEW_W, bucketX, layoutFor, pegs, spawnY } from './geometry';
import { bucketLabel, type Table } from './math';

export interface BoardRefs {
  peg(row: number, j: number, el: SVGCircleElement | null): void;
  bucket(k: number, el: SVGGElement | null): void;
  ball(id: number, el: SVGGElement | null): void;
}

/** Edge buckets glow in the accent pink, the centre cools to violet. */
export function bucketColour(k: number, rows: number): string {
  const t = Math.abs(k - rows / 2) / (rows / 2);
  const hue = 262 + (332 - 262) * t;
  const light = 58 + 4 * t;
  return `hsl(${hue.toFixed(1)} 82% ${light.toFixed(1)}%)`;
}

interface Props {
  table: Table;
  balls: number[];
  /** Bucket the last ball landed in (outlined until settings change). */
  landed: number | null;
  /** Bucket under the pointer or keyboard focus. */
  focus: number | null;
  onFocus(k: number | null): void;
  refs: BoardRefs;
}

function BoardImpl({ table, balls, landed, focus, onFocus, refs }: Props) {
  const l = layoutFor(table.rows);
  const n = table.rows;
  const maxP = Math.max(...table.probs);
  const bw = l.s - Math.max(3, l.s * 0.08);
  const showX = l.s > 62;
  const font = Math.min(18, Math.max(12, l.s * 0.34));

  return (
    <svg
      className="pk-svg"
      viewBox={`0 0 ${VIEW_W} ${l.height.toFixed(1)}`}
      role="img"
      aria-label={`Plinko board, ${n} rows, ${table.risk} risk`}
      onPointerLeave={() => onFocus(null)}
    >
      <defs>
        <radialGradient id="pk-ball" cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="45%" stopColor="#ffd3ea" />
          <stop offset="100%" stopColor="#ec4899" />
        </radialGradient>
        <filter id="pk-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g className="pk-pegs">
        {pegs(l).map((p) => (
          <circle key={`${p.row}:${p.j}`} ref={(el) => refs.peg(p.row, p.j, el)} className="pk-peg" cx={p.x} cy={p.y} r={l.pegR} />
        ))}
      </g>

      <g className="pk-buckets">
        {table.mults.map((m, k) => {
          const x = bucketX(l, k);
          const on = focus === k;
          return (
            <g
              key={k}
              className={'pk-bucket' + (landed === k ? ' landed' : '') + (on ? ' focus' : '')}
              style={{ ['--b' as string]: bucketColour(k, n) }}
              onPointerEnter={() => onFocus(k)}
              onClick={() => onFocus(k)}
            >
              <g ref={(el) => refs.bucket(k, el)} className="pk-bucket-body">
                <rect x={x - bw / 2} y={l.bucketY} width={bw} height={l.bucketH} rx={Math.min(8, bw * 0.18)} />
                <text x={x} y={l.bucketY + l.bucketH / 2} fontSize={font} dominantBaseline="central" textAnchor="middle">
                  {bucketLabel(m)}
                  {showX ? '×' : ''}
                </text>
              </g>
              <rect
                className="pk-bar"
                x={x - bw / 2 + bw * 0.18}
                y={l.barsY + l.barsH * (1 - table.probs[k] / maxP)}
                width={bw * 0.64}
                height={Math.max(1.5, (l.barsH * table.probs[k]) / maxP)}
                rx={2}
              />
              {/* A tall invisible hit area so thin buckets are easy to hover or tap. */}
              <rect className="pk-hit" x={x - l.s / 2} y={l.bucketY - 4} width={l.s} height={l.barsY + l.barsH - l.bucketY + 6} />
            </g>
          );
        })}
      </g>

      <g className="pk-balls">
        {balls.map((id) => (
          <g key={id} ref={(el) => refs.ball(id, el)} className="pk-ball" transform={`translate(${l.cx} ${spawnY(l).toFixed(1)})`}>
            <circle r={l.ballR} fill="url(#pk-ball)" filter="url(#pk-glow)" />
          </g>
        ))}
      </g>
    </svg>
  );
}

export default memo(BoardImpl);
