import type { CSSProperties } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import {
  BRACKET,
  LADDER,
  SKY,
  STRIP,
  VIEW,
  barHeight,
  bracket,
  capHeight,
  colW,
  colX,
  edgeX,
  ladderCell,
  stripSegments,
} from './geometry';
import { countRecords, finishShares, harmonic, isRecord, runWindow } from './math';

export type Phase = 'idle' | 'running' | 'checkpoint' | 'over';
export type Outcome = 'target' | 'cashed' | 'short';

export interface BoardProps {
  n: number;
  k: number;
  /** The items on show, as relative ranks at arrival (rank t of t is a record). */
  ranks: readonly number[];
  /** Changes every round, so the newest item's animation replays. */
  roundId: number;
  phase: Phase;
  outcome: Outcome | null;
  /** How long the newest item takes to land. */
  itemMs: number;
  /** Small frames get larger type. */
  narrow?: boolean;
  svgRef?: (el: SVGSVGElement | null) => void;
}

const LADDER_CX = LADDER.x + LADDER.w / 2;
const PIP_X = SKY.x0 + 84;
const vars = (v: Record<string, string | number>) => v as CSSProperties;

export default function Board({ n, k, ranks, roundId, phase, outcome, itemMs, narrow, svgRef }: BoardProps) {
  const j = ranks.length;
  const r = countRecords(ranks);
  const live = phase === 'running' || phase === 'checkpoint';
  const win = live ? runWindow(n, k, j, r) : null;
  const shares = outcome === 'target' ? finishShares(n, k, j, k) : finishShares(n, k, j, Math.min(r, k));
  const segs = stripSegments(shares);
  const winShare = shares[shares.length - 1].p;

  const cw = colW(n);
  const bw = Math.max(1.6, cw * (n <= 20 ? 0.64 : 0.72));
  const showNumbers = n <= 20;
  const pipGap = Math.min(16, 150 / k);

  // The ladder shows the item that just landed (while it lands, and after the round), else the next one.
  const landedView = (phase === 'running' || phase === 'over') && j > 0;
  const lt = landedView ? j : Math.min(j + 1, n);
  const landedRank = landedView ? ranks[j - 1] : null;
  const cellH = (LADDER.bottom - LADDER.top) / lt;
  const gap = cellH > 5 ? 1.2 : cellH > 2.6 ? 0.5 : 0;
  const newest = phase === 'running' ? j : -1;
  const recordOrdinals = new Map<number, number>();
  ranks.forEach((rank, i) => isRecord(rank, i + 1) && recordOrdinals.set(i + 1, recordOrdinals.size + 1));

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      className={'rec' + (phase === 'over' ? ' over' : '') + (outcome === 'target' ? ' won' : '') + (narrow ? ' narrow' : '')}
      role="img"
      aria-label={`${r} of ${k} records after ${j} of ${n} items`}
    >
      {/* Header: the record tally against the target, and how far down the queue we are. */}
      <text x={SKY.x0} y={30} className="cap">
        RECORDS
      </text>
      {Array.from({ length: k }, (_, i) => (
        <circle
          key={`${roundId}-pip-${i}`}
          cx={PIP_X + i * pipGap}
          cy={26}
          r={Math.min(5.5, pipGap * 0.36)}
          className={'pip' + (i < r ? ' on' : '') + (i === r - 1 && phase === 'running' && isRecord(ranks[j - 1], j) ? ' pop' : '')}
        />
      ))}
      <text x={PIP_X + (k - 0.5) * pipGap + 8} y={31} className="tally">
        {Math.min(r, k)} / {k}
      </text>
      <text x={VIEW.w - 22} y={30} className="cap end">
        {j} / {n} SEEN
      </text>

      {/* The skyline: one column per item. */}
      {Array.from({ length: n }, (_, i) => {
        const m = i + 1;
        const x = colX(n, m) - bw / 2;
        if (m > j) {
          const next = live && m === j + 1;
          return (
            <g key={`f-${m}`} className={'future' + (next ? ' next' : '')}>
              <rect x={x} y={SKY.top} width={bw} height={SKY.bottom - SKY.top} className="ghost" />
              <rect x={x} y={SKY.top} width={bw} height={capHeight(m)} className="cap-chance" />
            </g>
          );
        }
        const rank = ranks[i];
        const rec = isRecord(rank, m);
        const h = barHeight(rank, m);
        const anim = m === newest;
        return (
          <g key={`${roundId}-a-${m}`} className={'item' + (rec ? ' record' : '')}>
            <rect x={x} y={SKY.top} width={bw} height={SKY.bottom - SKY.top} className="ghost" />
            <rect
              x={x}
              y={SKY.bottom - h}
              width={bw}
              height={h}
              className={'bar' + (anim ? ' grow' : '')}
              style={anim ? vars({ '--ms': `${itemMs}ms` }) : undefined}
            />
            {rec && showNumbers && (
              <text x={colX(n, m)} y={SKY.top + 14} className="ord">
                {recordOrdinals.get(m)}
              </text>
            )}
            {rec && anim && <circle cx={colX(n, m)} cy={SKY.top} r={4} className="ring" style={vars({ '--ms': `${Math.max(320, itemMs * 2)}ms` })} />}
          </g>
        );
      })}
      {live && j < n && (
        <rect x={edgeX(n, j) + 0.5} y={SKY.top - 4} width={cw - 1} height={SKY.bottom - SKY.top + 6} rx={3} className="next-frame" />
      )}

      <line x1={SKY.x0} x2={SKY.x1} y1={SKY.top} y2={SKY.top} className="record-line" />
      <text x={SKY.x0} y={SKY.top - 8} className="cap accent">
        RECORD LINE
      </text>
      <line x1={SKY.x0} x2={SKY.x1} y1={SKY.bottom} y2={SKY.bottom} className="floor" />
      <text x={SKY.x0} y={SKY.bottom + 15} className="axis">
        item 1
      </text>
      <text x={SKY.x1} y={SKY.bottom + 15} className="axis end">
        item {n}
      </text>

      {/* Under the skyline: the run bracket while live, else a legend. */}
      {win ? (
        <g className="run">
          {(() => {
            const b = bracket(n, win);
            return (
              <>
                <rect x={b.x0} y={BRACKET.y} width={b.xSeen - b.x0} height={BRACKET.h} className="used" />
                <rect x={b.xSeen} y={BRACKET.y} width={b.xUntil - b.xSeen} height={BRACKET.h} className="open" />
                <line x1={b.xUntil} x2={b.xUntil} y1={BRACKET.y - 3} y2={BRACKET.y + BRACKET.h + 3} className="until" />
                <text x={SKY.x0} y={BRACKET.y + 22} className="run-label">
                  {k - r === 1 ? 'Winning record by item ' : 'Next record by item '}
                  {win.until}: 1 − {win.seen}/{win.until} = <tspan className="g">{fmtChance(win.chance)}</tspan>
                </text>
              </>
            );
          })()}
        </g>
      ) : phase === 'idle' ? (
        <text x={SKY.x0} y={BRACKET.y + 22} className="legend">
          <tspan className="accent">Pink caps</tspan>: each item's record chance, 1 in its place{narrow ? '' : ` · ${harmonic(n).toFixed(2)} records on average`}
        </text>
      ) : null}

      {/* The ladder: the t slots item t can take. Only the top one is a record. */}
      <text x={LADDER_CX} y={SKY.top - 8} className="cap mid">
        ITEM {lt}
      </text>
      <rect x={LADDER.x - 3} y={LADDER.top - 3} width={LADDER.w + 6} height={LADDER.bottom - LADDER.top + 6} rx={4} className="ladder-frame" />
      {gap > 0 ? (
        Array.from({ length: lt }, (_, i) => {
          const c = ladderCell(lt, i + 1);
          return <rect key={`c-${lt}-${i}`} x={LADDER.x} y={c.y + gap / 2} width={LADDER.w} height={c.h - gap} className={'slot' + (i + 1 === lt ? ' top' : '')} />;
        })
      ) : (
        <>
          <rect x={LADDER.x} y={LADDER.top + cellH} width={LADDER.w} height={LADDER.bottom - LADDER.top - cellH} className="slot" />
          <rect x={LADDER.x} y={LADDER.top} width={LADDER.w} height={cellH} className="slot top" />
        </>
      )}
      <path d={`M ${LADDER.x - 9} ${LADDER.top + cellH / 2 - 4} l 6 4 l -6 4 z`} className="top-tick" />
      {landedRank !== null && (
        <circle
          key={`${roundId}-dot-${j}`}
          cx={LADDER_CX}
          cy={ladderCell(lt, landedRank).y + ladderCell(lt, landedRank).h / 2}
          r={5.5}
          className={'dot' + (isRecord(landedRank, lt) ? ' hit' : '') + (phase === 'running' ? ' drop' : '')}
          style={vars({
            '--from': `${LADDER.top - 2 - (ladderCell(lt, landedRank).y + ladderCell(lt, landedRank).h / 2)}px`,
            '--ms': `${Math.round(itemMs * 0.9)}ms`,
          })}
        />
      )}
      <text x={LADDER_CX} y={SKY.bottom + 16} className="one-in">
        1 in {lt}
      </text>
      <text x={LADDER_CX} y={SKY.bottom + 29} className="axis mid">
        {landedRank === null ? 'is a record' : isRecord(landedRank, lt) ? 'record!' : `slot ${landedRank}`}
      </text>

      {/* Where you finish: every ending split by final record count. Green = the target or more. */}
      <text x={STRIP.x0} y={STRIP.y - 9} className="cap">
        WHERE YOU FINISH
      </text>
      <text x={STRIP.x1} y={STRIP.y - 9} className={'win-share end' + (winShare > 0 ? '' : ' zero')}>
        {k}+ records: {fmtChance(winShare)}
      </text>
      <rect x={STRIP.x0} y={STRIP.y} width={STRIP.x1 - STRIP.x0} height={STRIP.h} rx={4} className="strip-bg" />
      {segs.map((s) =>
        s.w <= 0 ? null : (
          <g key={`s-${s.count}-${s.win}`}>
            <rect
              x={s.x}
              y={STRIP.y}
              width={s.w}
              height={STRIP.h}
              className={s.win ? 'seg win' : 'seg lose'}
              style={s.win ? undefined : vars({ '--o': `${30 + (50 * (s.count + 1)) / k}%` })}
            />
            {s.w >= (s.win ? 24 : 15) && (
              <text x={s.x + s.w / 2} y={STRIP.y + STRIP.h / 2 + 4} className="seg-label">
                {s.win ? `${s.count}+` : s.count}
              </text>
            )}
          </g>
        ),
      )}
    </svg>
  );
}
