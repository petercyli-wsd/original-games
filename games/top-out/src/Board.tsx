import type { CSSProperties } from 'react';
import { WALLS } from './math';

// Four walls side by side, bottoms aligned, one hold spacing. Holds are dots on a line.
const GAP = 20;
const BASE = 368;
const COL_W = 80;
const COL_STEP = 92;
const X0 = 8;
const colX = (i: number) => X0 + i * COL_STEP;
const holdY = (n: number) => BASE - n * GAP;

export interface View {
  /** Height reached on each wall. */
  heights: number[];
  /** The slip hold (1-based) marked red on each wall, or null. */
  slips: (number | null)[];
  /** The wall lit as the active climber, or -1. */
  active: number;
  /** The hold being reached for right now. */
  reaching: { wall: number; hold: number } | null;
  moveMs: number;
}

export default function Walls({ view, me }: { view: View; me: number }) {
  const mark = Math.max(...view.heights);
  const dur = { transitionDuration: `${view.moveMs}ms` } as CSSProperties;
  return (
    <svg className="to-svg" viewBox="0 0 400 410" role="img" aria-label="Four climbing walls">
      {WALLS.map((N, i) => {
        const cx = colX(i) + COL_W / 2;
        const isMe = i === me;
        const on = i === view.active;
        return (
          <g key={N}>
            <rect
              className={'to-wall' + (isMe ? ' me' : '') + (on ? ' on' : '')}
              x={colX(i)}
              y={holdY(N) - 14}
              width={COL_W}
              height={BASE - holdY(N) + 24}
              rx={8}
            />
            <line className="to-ground" x1={cx - 20} x2={cx + 20} y1={BASE} y2={BASE} />
            {Array.from({ length: N }, (_, k) => k + 1).map((n) => {
              const slip = view.slips[i] === n;
              const aim = view.reaching?.wall === i && view.reaching.hold === n;
              const passed = n <= view.heights[i];
              return (
                <circle
                  key={n}
                  className={'to-hold' + (slip ? ' slip' : passed ? ' passed' : '') + (aim ? ' aim' : '')}
                  cx={cx}
                  cy={holdY(n)}
                  r={slip ? 5.5 : aim ? 5 : 4}
                />
              );
            })}
            <g className="to-climber" style={{ ...dur, transform: `translateY(${-view.heights[i] * GAP}px)` }}>
              <circle className={'to-man' + (isMe ? ' me' : '')} cx={cx} cy={BASE} r={8} />
            </g>
            <text className={'to-label' + (isMe ? ' me' : '')} x={cx} y={402}>
              {N}
            </text>
          </g>
        );
      })}
      {mark > 0 && (
        <g className="to-mark" style={{ ...dur, transform: `translateY(${-mark * GAP}px)` }}>
          <line x1={X0 - 4} x2={364} y1={BASE} y2={BASE} />
          <text x={396} y={BASE + 4}>
            Mark
          </text>
        </g>
      )}
    </svg>
  );
}
