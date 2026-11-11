import { CASES, pays } from './math';

const W = 640;
const BAR_W = 28;
const BAR_STEP = 34;
const TOP = 96;
const BASE = 290;
const CASE_W = 34;
const CASE_STEP = 40;

export interface BoardProps {
  /** The board's prizes, ascending: one bar each. */
  prizes: number[];
  /** Bars already struck off (indices into prizes). */
  struck: number[];
  /** The bar of the case just opened, marked until the next opening. */
  lastBar: number | null;
  /** Your own bar, once the round has opened your case. */
  mineBar: number | null;
  /** Cases already opened (0..15), your case is 0. */
  opened: number[];
  /** The case the opening is passing over right now, and the one last opened. */
  scan: number | null;
  lastCase: number | null;
  /** Offer in payout units, and the milliseconds the line takes to move. */
  offer: number;
  moveMs: number;
  /** Count of lit bars above the bet, and lit bars in all. */
  above: number;
  lit: number;
  casesLeft: number;
  note: string;
  /** Label above the last opened bar. */
  lastLabel: string | null;
  mineLabel: string | null;
  /** The Deal line's name: Deal, Took or Yours. */
  lineName: string;
}

const fmt = (x: number) => x.toFixed(2) + '×';

export default function Board(p: BoardProps) {
  const top = Math.max(...p.prizes.map(pays), 1.05);
  const y = (v: number) => BASE - (v / top) * (BASE - TOP);
  const betY = y(1);
  const dealY = y(p.offer);
  const dealAbove = dealY <= betY;
  const lineEnd = BAR_STEP * CASES - (BAR_STEP - BAR_W);
  const x0 = (i: number) => 3 + i * BAR_STEP;

  return (
    <svg viewBox={`0 0 ${W} 346`} className="banker" role="img" aria-label="Cases, prizes and the Deal line">
      {Array.from({ length: CASES }, (_, c) => {
        const isOpen = p.opened.includes(c);
        const cls = ['case', c === 0 ? 'mine' : '', isOpen ? 'open' : '', c === p.lastCase ? 'last' : '', c === p.scan ? 'scan' : ''].join(' ');
        return (
          <g key={c} className={cls} transform={`translate(${3 + c * CASE_STEP} 6)`}>
            <rect width={CASE_W} height={34} rx={4} />
            <text x={CASE_W / 2} y={23}>{c + 1}</text>
          </g>
        );
      })}

      <text x={3} y={72} className="lab">{`${p.casesLeft} cases left to open`}</text>
      <text x={lineEnd + 8} y={72} className="lab key" textAnchor="end">Bars: what your case pays</text>

      {p.prizes.map((prize, i) => {
        const v = pays(prize);
        const h = Math.max(4, BASE - y(v));
        const isStruck = p.struck.includes(i);
        const cls = ['bar', isStruck ? 'struck' : v > 1 ? 'up' : 'down', i === p.lastBar ? 'last' : '', i === p.mineBar ? 'mine' : ''].join(' ');
        return (
          <g key={i} className={cls}>
            <rect x={x0(i)} y={BASE - h} width={BAR_W} height={h} />
            {isStruck && <line x1={x0(i)} x2={x0(i) + BAR_W} y1={BASE - h / 2} y2={BASE - h / 2} />}
          </g>
        );
      })}
      <line x1={0} x2={lineEnd} y1={BASE} y2={BASE} className="base" />

      {/* Bet line: the stake. Bars above it are profit. */}
      <line x1={0} x2={lineEnd} y1={betY} y2={betY} className="betline" />
      {/* Deal line: the offer, which moves when a bar is struck. */}
      <g className="dealgroup" style={{ transform: `translateY(${dealY - betY}px)`, transitionDuration: `${p.moveMs}ms` }}>
        <line x1={0} x2={lineEnd} y1={betY} y2={betY} className="dealline" />
      </g>
      <text x={lineEnd + 8} y={dealY + (dealAbove ? -4 : 16)} className="lab deal">{`${p.lineName} ${fmt(p.offer)}`}</text>
      <text x={lineEnd + 8} y={betY + (dealAbove ? 16 : -4)} className="lab">Bet 1.00×</text>

      {p.lastBar !== null && p.lastLabel && (
        <text x={x0(p.lastBar) + BAR_W / 2} y={BASE + 18} className="lab tag" textAnchor="middle">{p.lastLabel}</text>
      )}
      {p.mineBar !== null && p.mineLabel && (
        <text x={x0(p.mineBar) + BAR_W / 2} y={BASE + 36} className="lab mine-tag" textAnchor="middle">{p.mineLabel}</text>
      )}

      <text x={3} y={322} className="lab key">{`${p.above} of ${p.lit} bars above your bet`}</text>
      <text x={3} y={342} className="lab note">{p.note}</text>
    </svg>
  );
}
