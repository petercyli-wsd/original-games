import { fmtChance, fmtMult } from '@originals/game-sdk/ui';
import type { CSSProperties, Ref } from 'react';
import { STRIP, VIEW_H, VIEW_W, barFill, layout, stripSegments } from './geometry';

export type Result = 'won' | 'lost' | 'cashed';

export interface BoardProps {
  n: number;
  /** Chance the prize is behind each door (0 = opened). */
  post: number[];
  held: number;
  /** The prize locked on each closed door if you held it (V / P). */
  prizes: number[];
  /** The door swinging open right now. */
  opening: number | null;
  /** Doors opened at the end of the round. */
  revealed: readonly number[];
  /** Where the prize was, once known. */
  prizeDoor: number | null;
  result: Result | null;
  /** Doors can be clicked: to pick (idle) or to switch (checkpoint). */
  pickable: boolean;
  onPick(door: number): void;
  /** Door swing and the bars flowing, in ms. */
  swingMs: number;
  flowMs: number;
  svgRef?: Ref<SVGSVGElement>;
}

const pct = (p: number) => (p >= 0.9995 ? '100%' : p <= 0 ? '0%' : `${(p * 100).toFixed(1)}%`);

export default function Board({ n, post, held, prizes, opening, revealed, prizeDoor, result, pickable, onPick, swingMs, flowMs, svgRef }: BoardProps) {
  const L = layout(n);
  const closed = post.reduce((k, p) => k + (p > 0 ? 1 : 0), 0);
  const segs = stripSegments(post, held);
  const mine = post[held];
  const over = result !== null;
  const style = { '--swing': `${swingMs}ms`, '--flow': `${flowMs}ms` } as CSSProperties;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className={'doors' + (pickable ? ' picking' : '')}
      style={style}
      role="img"
      aria-label={`${closed} of ${n} doors closed. Your door, number ${held + 1}, has a ${fmtChance(mine)} chance.`}
    >
      <text className="legend" x={VIEW_W / 2} y={14}>
        bar = chance the prize is behind that door · × = prize if you hold it
      </text>

      {L.cells.map((cell, i) => {
        const { door: d, bar } = cell;
        const isOpen = post[i] === 0 || opening === i || revealed.includes(i) || (over && result === 'cashed');
        const isHeld = i === held;
        const hasPrize = prizeDoor === i && isOpen;
        const canPick = pickable && !isHeld && post[i] > 0 && opening !== i;
        const tone = over && isHeld ? (result === 'won' ? ' win' : result === 'lost' ? ' lose' : '') : '';
        const p = post[i];
        const r = Math.min(d.w, d.h);
        return (
          <g
            key={i}
            className={'door' + (isHeld ? ' held' : '') + (isOpen ? ' open' : '') + (canPick ? ' pick' : '') + (hasPrize ? ' prize' : '') + tone}
            onClick={canPick ? () => onPick(i) : undefined}
          >
            <title>
              {`Door ${i + 1}: ${p > 0 ? `${fmtChance(p)} chance` : 'open, empty'}` +
                (canPick ? ` · hold it and the prize relocks at ${fmtMult(prizes[i])}` : '')}
            </title>
            {/* The chance bar: its filled height is P(prize behind this door). */}
            <rect className="track" x={bar.x} y={bar.y} width={bar.w} height={bar.h} rx={2} />
            <rect
              className={'fill' + (isHeld ? ' mine' : '')}
              x={bar.x}
              y={bar.y}
              width={bar.w}
              height={bar.h}
              rx={2}
              style={{ transform: `scaleY(${p})` }}
            />
            <line className="start" x1={bar.x - 4} x2={bar.x + bar.w + 4} y1={bar.y + bar.h - barFill(1 / n, bar.h)} y2={bar.y + bar.h - barFill(1 / n, bar.h)} />
            <text className={'pct' + (isHeld ? ' mine' : '') + (p === 0 ? ' gone' : '')} x={cell.cx} y={cell.labelY} style={{ fontSize: L.font }}>
              {p > 0 ? pct(p) : hasPrize ? 'prize' : 'empty'}
            </text>

            {/* The door: frame, dark inside, and a leaf that swings open. */}
            <rect className="frame" x={d.x - 3} y={d.y - 3} width={d.w + 6} height={d.h + 3} rx={3} />
            <rect className="inside" x={d.x} y={d.y} width={d.w} height={d.h} />
            {isOpen && !hasPrize && <circle className="empty" cx={d.x + d.w * 0.58} cy={d.y + d.h * 0.6} r={r * 0.14} />}
            {hasPrize && (
              <path
                className="gem"
                d={`M ${d.x + d.w * 0.58} ${d.y + d.h * 0.6 - r * 0.24} l ${r * 0.2} ${r * 0.24} l ${-r * 0.2} ${r * 0.24} l ${-r * 0.2} ${-r * 0.24} z`}
              />
            )}
            <g className="leaf" style={{ transform: isOpen ? 'scaleX(0.14)' : 'none' }}>
              <rect className="slab" x={d.x} y={d.y} width={d.w} height={d.h} />
              <circle className="knob" cx={d.x + d.w * 0.8} cy={d.y + d.h * 0.58} r={Math.max(1.5, r * 0.05)} />
              <text className="num" x={d.x + d.w / 2} y={d.y + d.h * 0.36} style={{ fontSize: L.font + 1 }}>
                {i + 1}
              </text>
            </g>
            {isHeld && !isOpen && (
              <text className="you" x={cell.cx} y={d.y + d.h - 5} style={{ fontSize: L.font - 2 }}>
                YOURS
              </text>
            )}
            {p > 0 && (
              <text className={'prize-label' + (isHeld ? ' mine' : '')} x={cell.cx} y={cell.footY} style={{ fontSize: L.font }}>
                {fmtMult(prizes[i])}
              </text>
            )}
          </g>
        );
      })}

      {/* The prize-location strip: one segment per closed door, your door first. */}
      <text className="strip-title" x={STRIP.x} y={STRIP.y - 7}>
        WHERE THE PRIZE IS · 100% split over the closed doors
      </text>
      <rect className="strip-track" x={STRIP.x} y={STRIP.y} width={STRIP.w} height={STRIP.h} rx={3} />
      {segs.map((g) =>
        g.w > 0 ? <rect key={g.door} className={'seg' + (g.door === held ? ' mine' : '')} x={g.x} y={STRIP.y} width={g.w} height={STRIP.h} /> : null,
      )}
      <text className="strip-mine" x={STRIP.x} y={STRIP.y + STRIP.h + 17}>
        your door {held + 1} · {pct(mine)}
      </text>
      <text className="strip-rest" x={STRIP.x + STRIP.w} y={STRIP.y + STRIP.h + 17}>
        {closed - 1} other closed door{closed - 1 === 1 ? '' : 's'} · {pct(1 - mine)}
      </text>
    </svg>
  );
}
