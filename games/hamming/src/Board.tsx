import { fmtChance } from '@originals/game-sdk/ui';
import { BITS, flipSyndrome, type Side } from './math';

// The Hamming(7,4) Venn diagram: three parity circles A, B, C. Position i
// (1..7) sits in the circles named by the binary digits of i, so the parity
// bits 1, 2, 4 sit alone in a petal and the data bits 3, 5, 6, 7 in overlaps.
const CIRCLES = [
  { x: 158, y: 112, name: 'A', lx: 62, ly: 40 },
  { x: 242, y: 112, name: 'B', lx: 338, ly: 40 },
  { x: 200, y: 185, name: 'C', lx: 200, ly: 290 },
];
const R = 80;
const CELL: { x: number; y: number }[] = [
  { x: 120, y: 92 }, // 1 = A
  { x: 280, y: 92 }, // 2 = B
  { x: 200, y: 74 }, // 3 = A B
  { x: 200, y: 232 }, // 4 = C
  { x: 151, y: 168 }, // 5 = A C
  { x: 249, y: 168 }, // 6 = B C
  { x: 200, y: 136 }, // 7 = A B C
];
const PARITY = new Set([0, 1, 3]);

export type BlockResult = 'ok' | 'fail';

export interface BoardProps {
  side: Side;
  noise: number;
  blocks: number;
  /** Index of the block shown in the diagram. */
  block: number;
  /** The codeword sent (null before the first bit: the idle preview). */
  code: number[] | null;
  /** Flips of the bits that have crossed so far, in order 1..7. */
  flipped: boolean[];
  /** Results of the finished blocks. */
  results: BlockResult[];
  /** Decode chance of every block (the drawn bars). */
  bars: number[];
  /** Chance the bet side wins. */
  win: number;
  /** Bit that arrived last (animated). */
  arriving: number | null;
}

export default function Board({ side, noise, blocks, block, code, flipped, results, bars, win, arriving }: BoardProps) {
  const arrived = flipped.length;
  const flips = flipped.filter(Boolean).length;
  const syn = flipSyndrome(flipped);
  const complete = arrived === BITS;
  // The decoder acts once all 7 bits are in: it flips the position named by the syndrome.
  const fixAt = complete && syn ? syn - 1 : -1;
  const fooled = flips >= 2;
  const decodeAll = bars.reduce((a, b) => a * b, 1);
  const barW = (360 - 12 * (blocks - 1)) / blocks;

  return (
    <svg viewBox="0 0 400 452" className="ham" role="img" aria-label={`Block ${block + 1} of ${blocks}: ${flips} flips, win chance ${fmtChance(win)}`}>
      {CIRCLES.map((c, k) => {
        const broken = ((syn >> k) & 1) === 1;
        return (
          <g key={c.name}>
            <circle cx={c.x} cy={c.y} r={R} className={'ring' + (broken ? ' broken' : '') + (code ? '' : ' idle')} />
            <text x={c.lx} y={c.ly} className={'ring-label' + (broken ? ' broken' : '')}>
              {c.name} {code ? (broken ? '✗' : '✓') : ''}
            </text>
          </g>
        );
      })}

      {CELL.map((p, i) => {
        const here = i < arrived;
        const flip = here && flipped[i];
        const bit = code ? code[i] ^ (flip ? 1 : 0) : null;
        const cls = ['cell', PARITY.has(i) ? 'parity' : 'data', here ? 'in' : 'wait', flip ? 'flip' : '', i === arriving ? 'arrive' : '', i === fixAt ? (fooled ? 'miss' : 'fix') : '']
          .filter(Boolean)
          .join(' ');
        return (
          <g key={i} className={cls} transform={`translate(${p.x} ${p.y})`}>
            <g className="pop">
              {i === fixAt && <rect x={-22} y={-22} width={44} height={44} rx={11} className="fix-ring" />}
              <rect x={-16} y={-16} width={32} height={32} rx={7} />
              <text y={7} className="bit">
                {here && bit !== null ? bit : '·'}
              </text>
              <text x={-24} y={-14} className="pos">
                {i + 1}
              </text>
            </g>
          </g>
        );
      })}

      {/* Flips absorbed: the code soaks up one flip per block; a second one fools it. */}
      <g transform="translate(20 318)">
        <text x={0} y={0} className="lbl">
          flips absorbed
        </text>
        {[0, 1].map((k) => (
          <rect key={k} x={k * 26} y={10} width={20} height={20} rx={5} className={'pip' + (k < flips ? (k === 0 ? ' used' : ' over') : '') + (k === 1 ? ' fatal' : '')} />
        ))}
        <text x={58} y={26} className={'val' + (flips >= 2 ? ' bad' : '')}>
          {Math.min(flips, 1)} / 1{flips >= 2 ? ` · ${flips} flips` : ''}
        </text>
      </g>
      <g transform="translate(380 318)">
        <text x={0} y={0} className="lbl end">
          syndrome {code ? (syn >> 2) & 1 : '·'}
          {code ? (syn >> 1) & 1 : '·'}
          {code ? syn & 1 : '·'}
        </text>
        <text x={0} y={26} className={'val end' + (fooled && complete ? ' bad' : syn && complete ? ' gold' : '')}>
          {!code ? `noise ${noise}% per bit` : !complete ? `${BITS - arrived} bit${BITS - arrived === 1 ? '' : 's'} to cross` : syn === 0 ? (fooled ? 'looks clean: fooled' : 'clean') : fooled ? `"fixes" bit ${syn}: fooled` : `fixes bit ${syn}`}
        </text>
      </g>

      {/* The odds, drawn: each bar's fill is that block's chance to decode. */}
      <text x={20} y={372} className="lbl">
        each block decodes
      </text>
      <text x={380} y={372} className="lbl end">
        block {Math.min(block + 1, blocks)} of {blocks}
      </text>
      {bars.map((b, i) => {
        const x = 20 + i * (barW + 12);
        const state = results[i] ?? (i === block && code ? 'live' : 'wait');
        return (
          <g key={i} className={`bar ${state}`}>
            <rect x={x} y={380} width={barW} height={16} rx={4} className="track" />
            <rect x={x} y={380} width={Math.max(0, barW * b)} height={16} rx={4} className="fill" />
            <text x={x + barW / 2} y={413} className="pct">
              {results[i] === 'ok' ? '✓ decoded' : results[i] === 'fail' ? '✗ fooled' : fmtChance(b)}
            </text>
          </g>
        );
      })}
      <text x={200} y={442} className="eq">
        {side === 'decoded'
          ? `Decoded = ${blocks > 1 ? 'product of bars = ' : ''}${fmtChance(win)}`
          : `Fooled = 1 − ${blocks > 1 ? 'product' : 'bar'} (${fmtChance(decodeAll)}) = ${fmtChance(win)}`}
      </text>
    </svg>
  );
}
