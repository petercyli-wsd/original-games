import { N, cardsLeft, inGate, landings, rowOf, type Gate, type Pos } from './math';

export type Phase = 'idle' | 'stepping' | 'checkpoint' | 'over';
export type Outcome = 'through' | 'missed' | 'locked' | 'unreachable' | 'cashed';

const W = 400;
const CX = W / 2;
/** Tile pitch: neighbouring rows are `S` apart, and so are the half-steps along a row. */
const S = 27;
const H = S - 1.5;
/** The top tip of the start tile. */
const TOP = 8;
const Y0 = TOP + H;
/** The bottom row's lower tips. */
const FLOOR = Y0 + N * S + H;
const BAR_Y = FLOOR + 30;
export const VIEW_H = BAR_Y + 14 + 6;

/** The card piles in the top corners: 3 × 2 cards each. */
const CW = 19;
const CH = 26;
const CG = 4;
const PILE_X = 12;
const PILE_Y = 46;

export interface BoardProps {
  svgRef?: (el: SVGSVGElement | null) => void;
  gate: Gate;
  /** Where the ball is drawn (it glides there). */
  walker: Pos;
  /** Tiles visited after the start, in order, up to the ball. */
  trail: Pos[];
  phase: Phase;
  outcome: Outcome | null;
  stepMs: number;
  /** Bottom tiles can be clicked to move the gate (idle or over). */
  onPick?: (a: number) => void;
}

const at = (p: Pos) => ({ x: CX + (p.a - p.b) * S, y: Y0 + (p.a + p.b) * S });

/** Centre of card slot i (0..N−1) in a pile; slot N−1 sits nearest the triangle. */
function slot(side: 'L' | 'R', i: number) {
  const col = i % 3;
  const row = Math.floor(i / 3);
  const x = PILE_X + CW / 2 + col * (CW + CG);
  return { x: side === 'L' ? x : W - x, y: PILE_Y + CH / 2 + row * (CH + CG) };
}

const tilePath = (x: number, y: number, h = H) => `M ${x} ${y - h} L ${x + h} ${y} L ${x} ${y + h} L ${x - h} ${y} Z`;

function Card({ x, y, glyph, empty }: { x: number; y: number; glyph: string; empty?: boolean }) {
  return (
    <g className={'card' + (empty ? ' empty' : '')} transform={`translate(${x} ${y})`}>
      <rect x={-CW / 2} y={-CH / 2} width={CW} height={CH} rx={3.5} />
      {!empty && (
        <text y={0} dy="0.36em">
          {glyph}
        </text>
      )}
    </g>
  );
}

export default function Board({ svgRef, gate, walker, trail, phase, outcome, stepMs, onPick }: BoardProps) {
  const wRow = rowOf(walker);
  const ended = phase === 'over';
  const visited = new Set(trail.map((p) => `${p.a},${p.b}`));
  const { left, right, down } = cardsLeft(walker);

  // The bar: the bottom row again, each tile resized to its chance of being where the ball lands.
  const bar = landings(walker).filter((l) => l.count > 0);
  const barTotal = bar.reduce((acc, l) => acc + l.count, 0);
  const green = bar.filter((l) => inGate(gate, l.a)).reduce((acc, l) => acc + l.count, 0);
  const p = green / barTotal;

  const tiles: JSX.Element[] = [];
  for (let row = 0; row <= N; row++) {
    for (let a = 0; a <= row; a++) {
      const v = { a, b: row - a };
      const { x, y } = at(v);
      const key = `${a},${v.b}`;
      const reachable = v.a >= walker.a && v.b >= walker.b;
      let cls = 'tile';
      if (row < N) {
        if (row <= wRow) cls += row === 0 || visited.has(key) ? ' visited' : ' past';
        else cls += reachable ? ' live' : ' dead';
      } else {
        const g = inGate(gate, a);
        cls += g ? ' gate' : ' miss';
        if (!reachable) cls += ' dead';
        if (ended && wRow === N && v.a === walker.a) cls += g ? ' hit' : ' fail';
      }
      const pick = onPick && row === N ? () => onPick(a) : undefined;
      tiles.push(
        <g key={key} className={cls + (pick ? ' pickable' : '')} onClick={pick}>
          <path d={tilePath(x, y)} />
          {pick && <title>Move the gate here</title>}
        </g>,
      );
    }
  }

  // The path so far, from the start tile.
  const pts = [START_PT, ...trail.map(at)];
  const settled = pts.slice(0, Math.max(1, pts.length - 1));
  const last = pts.length > 1 ? [pts[pts.length - 2], pts[pts.length - 1]] : null;
  const wp = at(walker);

  // The card being dealt flies from the slot it just left to the ball's new tile.
  let flying: JSX.Element | null = null;
  if (phase === 'stepping' && trail.length > 0 && stepMs > 0) {
    const prev = trail.length > 1 ? trail[trail.length - 2] : { a: 0, b: 0 };
    const side = walker.a > prev.a ? 'R' : 'L';
    const from = slot(side, side === 'R' ? right : left);
    flying = (
      <g
        key={trail.length}
        className="fly"
        style={{
          ['--x0' as string]: `${from.x}px`,
          ['--y0' as string]: `${from.y}px`,
          ['--x1' as string]: `${wp.x}px`,
          ['--y1' as string]: `${wp.y}px`,
          animationDuration: `${stepMs}ms`,
        }}
      >
        <Card x={0} y={0} glyph={side === 'R' ? '↘' : '↙'} />
      </g>
    );
  }

  const pile = (side: 'L' | 'R') => {
    const isL = side === 'L';
    const count = isL ? left : right;
    const glyph = isL ? '↙' : '↘';
    const x0 = isL ? PILE_X : W - PILE_X;
    return (
      <g className={'pile' + (isL ? '' : ' right')}>
        <text x={x0} y={14} className="cap">
          {isL ? '↙ cards left' : 'cards left ↘'}
        </text>
        <text x={x0} y={34} className="count">
          {count}
          <tspan className="of"> of {down}</tspan>
        </text>
        {Array.from({ length: N }, (_, i) => {
          const c = slot(side, i);
          return <Card key={i} x={c.x} y={c.y} glyph={glyph} empty={i >= count} />;
        })}
      </g>
    );
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${VIEW_H}`}
      className="pascal"
      role="img"
      aria-label={`Pascal board: ${left} down-left and ${right} down-right cards left; ${(p * 100).toFixed(1)}% chance to pass through the gate`}
    >
      {pile('L')}
      {pile('R')}

      <g className="tiles">{tiles}</g>

      <polyline className="trail" points={settled.map((q) => `${q.x},${q.y}`).join(' ')} />
      {last && (
        <line
          key={pts.length}
          className="trail fresh"
          x1={last[0].x}
          y1={last[0].y}
          x2={last[1].x}
          y2={last[1].y}
          style={{ animationDuration: `${stepMs}ms`, strokeDasharray: `${S * 1.5}px`, ['--len' as string]: `${S * 1.5}px` }}
        />
      )}

      {flying}

      <g className={'walker' + (ended ? ` ${outcome}` : '')} style={{ transform: `translate(${wp.x}px, ${wp.y}px)`, transitionDuration: `${stepMs}ms` }}>
        <circle r={S * 0.42} />
      </g>

      {/* The bar: the bottom tiles, each sized by its chance; the green share is the chance to win. */}
      <g className="bar">
        <text x={CX} y={BAR_Y - 6} className="cap mid">
          Where the ball lands · green = gate
        </text>
        {(() => {
          let cursor = 24;
          const BW = W - 48;
          return bar.map((l) => {
            const w = (l.count / barTotal) * BW;
            const x = cursor;
            cursor += w;
            return <rect key={l.a} className={'seg' + (inGate(gate, l.a) ? ' g' : '')} x={x + 0.5} y={BAR_Y} width={Math.max(0.6, w - 1)} height={14} rx={2.5} />;
          });
        })()}
      </g>
    </svg>
  );
}

const START_PT = at({ a: 0, b: 0 });
