import { LINE, fitsMask, type Row } from './math';

const W = 540;
const X0 = 10;
const CELL = 5.2;
const GAP = 10;
const BOX_H = 44;
const BAR_Y = 120;
const BAR_H = 28;
const tx = (v: number) => X0 + (v - 0.5) * CELL;

export interface BoardProps {
  m: number;
  /** Null in idle: an empty preview. */
  row: Row | null;
  /** The number just drawn (shown on the card and as a tick once it has turned). */
  drawn: number | null;
  turning: boolean;
  /** A number that fitted nowhere; it stays red until the next Bet. */
  bust: number | null;
  /** Slots the drawn number may take. */
  legal: number[];
  onSlot(slot: number): void;
  /** Milliseconds for the card turn and the line recolour. */
  turnMs: number;
  recolourMs: number;
}

export default function Board({ m, row, drawn, turning, bust, legal, onSlot, turnMs, recolourMs }: BoardProps) {
  const count = m + 2;
  const bw = Math.min(66, (W - GAP * (count - 1)) / count);
  const total = count * bw + (count - 1) * GAP;
  const left = (W - total) / 2;
  const cx = (i: number) => left + i * (bw + GAP) + bw / 2;

  const used = new Set((row ?? []).filter((v): v is number => v !== null));
  const mask = row ? fitsMask(row) : null;
  const cells = [];
  for (let v = 1; v <= LINE; v++) {
    const cls = !row || row.every((v) => v !== null) ? 'idle' : used.has(v) ? 'used' : mask![v] ? 'fits' : 'none';
    cells.push(<rect key={v} className={`ib-cell ${cls}`} x={X0 + (v - 1) * CELL} y={BAR_Y} width={CELL} height={BAR_H} style={{ transitionDuration: `${recolourMs}ms` }} />);
  }

  const showTick = drawn !== null && !turning && bust === null;
  return (
    <svg className="ib" viewBox={`0 0 ${W} 256`} role="img" aria-label="Row of slots above a number line from 1 to 100">
      {/* connectors, drawn first so boxes sit on top */}
      {row?.map((v, i) =>
        v === null ? null : <line key={'c' + i} className="ib-conn" x1={cx(i)} y1={8 + BOX_H} x2={tx(v)} y2={BAR_Y - 8} />,
      )}

      <g className="ib-bar" shapeRendering="crispEdges">{cells}</g>

      {row?.map((v, i) =>
        v === null ? null : (
          <line key={'t' + i} className={'ib-tick ' + (i === 0 || i === row.length - 1 ? 'post' : 'placed')} x1={tx(v)} y1={BAR_Y - 8} x2={tx(v)} y2={BAR_Y + BAR_H + 8} />
        ),
      )}

      {showTick && (
        <g>
          <line className="ib-tick drawn" x1={tx(drawn!)} y1={BAR_Y - 8} x2={tx(drawn!)} y2={BAR_Y + BAR_H + 8} />
          <text className="ib-lab drawn" x={tx(drawn!)} y={BAR_Y - 14} textAnchor="middle">
            {drawn}
          </text>
        </g>
      )}
      {bust !== null && (
        <g>
          <line className="ib-tick bust" x1={tx(bust)} y1={BAR_Y - 8} x2={tx(bust)} y2={BAR_Y + BAR_H + 8} />
          <text className="ib-lab bust" x={tx(bust)} y={BAR_Y - 14} textAnchor="middle">
            {bust}
          </text>
        </g>
      )}

      {[1, 50, 100].map((v) => (
        <text key={v} className="ib-axis" x={tx(v)} y={BAR_Y + BAR_H + 28} textAnchor={v === 1 ? 'start' : v === 100 ? 'end' : 'middle'}>
          {v}
        </text>
      ))}

      {/* the slot row */}
      {Array.from({ length: count }, (_, i) => {
        const post = i === 0 || i === count - 1;
        const v = row ? row[i] : null;
        const isLegal = legal.includes(i);
        const cls = post ? 'post' : v !== null ? 'placed' : isLegal ? 'legal' : 'empty';
        return (
          <g
            key={i}
            className={`ib-box ${cls}`}
            role={isLegal ? 'button' : undefined}
            tabIndex={isLegal ? 0 : undefined}
            aria-label={isLegal ? `Place ${drawn} in slot ${i}` : undefined}
            onClick={isLegal ? () => onSlot(i) : undefined}
            onKeyDown={isLegal ? (e) => (e.key === 'Enter' ? onSlot(i) : undefined) : undefined}
          >
            <rect x={cx(i) - bw / 2} y={8} width={bw} height={BOX_H} rx={6} />
            <text x={cx(i)} y={8 + BOX_H / 2 + 7} textAnchor="middle">
              {post && v === null ? '?' : (v ?? '')}
            </text>
          </g>
        );
      })}

      {/* the drawn number's card */}
      {drawn !== null && (
        <g key={drawn + ':' + (bust !== null)} className={'ib-card' + (turning ? ' turning' : '') + (bust !== null ? ' bust' : '')} style={{ animationDuration: `${turnMs}ms` }}>
          <rect x={W / 2 - 36} y={192} width={72} height={50} rx={6} />
          <text className="front" x={W / 2} y={192 + 33} textAnchor="middle">
            {drawn}
          </text>
          {turning && (
            <text className="back" x={W / 2} y={192 + 33} textAnchor="middle" style={{ animationDuration: `${turnMs}ms` }}>
              ?
            </text>
          )}
        </g>
      )}
    </svg>
  );
}
