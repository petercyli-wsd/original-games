import { fmtMult } from '@originals/game-sdk/ui';
import { LINE, SIZES, TOTAL, blockName, prizeFor, totalOf, type Column, type Ending } from './math';

// Vertical scale: one unit of block size is U px; the axis runs 0…TOTAL (22),
// the highest any block can reach (stack 15 + the 7 block).
const U = 12;
const Y0 = 318;
const y = (v: number) => Y0 - v * U;
// The stack column and the row of waiting blocks.
const SX0 = 42;
const SX1 = 106;
const TX0 = 118;
const TX1 = 398;
const SLOT = (TX1 - TX0) / SIZES.length;
const TW = 32;

export interface BoardProps {
  backed: number;
  /** Blocks on the stack, in join order, bottom first. */
  order: number[];
  /** Live: the blocks waiting to join, with your chance if each joins next. */
  cols: Column[];
  /** The block joining right now. */
  pick: number | null;
  ending: Ending | null;
  /** Idle: the waiting blocks are the picker, labelled with chance and prize. */
  picking: boolean;
  /** Choose the backed block by clicking it (only between rounds). */
  onPick?: (block: number) => void;
}

export default function Board({ backed, order, cols, pick, ending, picking, onPick }: BoardProps) {
  const s = totalOf(order);
  const you = blockName(backed);
  const live = !picking && !ending;

  // Blocks on the stack, bottom first.
  let at = 0;
  const stack = order.map((j, k) => {
    const b = { j, from: at, w: SIZES[j], last: k === order.length - 1 };
    at += SIZES[j];
    return b;
  });

  // The waiting blocks, each in its own fixed slot, standing on top of the stack.
  type Tile = { block: number; kind: 'wait' | 'out' | 'win' };
  const tiles: Tile[] = picking
    ? SIZES.map((_, block) => ({ block, kind: 'wait' }))
    : live
      ? cols.map((c) => ({ block: c.block, kind: c.ends === 'won' ? 'win' : c.p === 0 ? 'out' : 'wait' }))
      : [];
  const base = picking ? 0 : s;

  let note = '';
  const yours = stack.find((b) => b.j === backed);
  if (ending === 'won') note = `${you} landed on ${yours!.from} and crossed the line`;
  else if (ending === 'early' && yours) note = `${you} landed on ${yours.from}, topped out at ${s}: short`;
  else if (ending === 'passed') note = `${blockName(order[order.length - 1])} crossed the line before ${you} joined`;
  else if (ending === 'cashed') note = `Cashed out with the stack at ${s}`;

  return (
    <svg viewBox="0 0 400 356" className="pivot" role="img" aria-label={`Stack ${s} of ${LINE}; ${you} wins if it is the block that takes the stack over the line`}>
      <text x={TX1} y={16} className="sec end">
        stack {s}
      </text>

      {/* Scale: a tick per unit, 0 at the floor, the line at 16. */}
      {Array.from({ length: TOTAL }, (_, k) => (
        <line key={k} x1={SX0 - 5} x2={SX0 - 1} y1={y(k + 1)} y2={y(k + 1)} className="tick" />
      ))}
      <text x={SX0 - 9} y={Y0 + 4} className="axis">
        0
      </text>
      <line x1={SX0 - 6} x2={TX1} y1={Y0} y2={Y0} className="floor" />

      {/* The stack. */}
      <rect x={SX0} y={y(TOTAL)} width={SX1 - SX0} height={TOTAL * U} rx={4} className="col" />
      {stack.map((b) => {
        const over = b.from + b.w >= LINE;
        const cls = b.j === backed ? (over ? 'blk you won' : ending === 'early' ? 'blk you lost' : 'blk you') : over ? 'blk beat' : 'blk';
        return (
          <g key={b.j} className={b.last && !picking ? 'fresh' : undefined}>
            <rect x={SX0 + 1} y={y(b.from + b.w) + 1} width={SX1 - SX0 - 2} height={b.w * U - 2} rx={3} className={cls} />
          </g>
        );
      })}
      {/* Labels after every block, so a thin block's letter is never covered by the one above it. */}
      {stack.map((b) => (
        <text key={b.j} x={(SX0 + SX1) / 2} y={y(b.from + b.w / 2) + (b.w === 1 ? 3.5 : 4.5)} className={'blk-t' + (b.w === 1 ? ' thin' : '') + (b.last && !picking ? ' fresh' : '')}>
          {blockName(b.j)}
        </text>
      ))}
      {ending === 'early' && (
        <g className="gap">
          <line x1={SX1 + 8} x2={SX1 + 8} y1={y(LINE)} y2={y(s)} />
          <text x={SX1 + 14} y={(y(LINE) + y(s)) / 2 + 4}>
            {LINE - s} short
          </text>
        </g>
      )}

      {/* The stack top, carried across to the waiting blocks standing on it. */}
      {live && s > 0 && <line x1={SX1} x2={TX1} y1={y(s)} y2={y(s)} className="top" />}

      {tiles.length > 0 && (
        <text x={TX0 + 4} y={36} className="sec">
          {picking ? 'Pick your block' : 'Next to join'}
        </text>
      )}
      {tiles.map((t) => {
        const w = SIZES[t.block];
        const cx = TX0 + SLOT * t.block + SLOT / 2;
        const isYou = t.block === backed;
        const cls = 'tile ' + t.kind + (isYou ? ' you' : '') + (pick === t.block ? ' pick' : '') + (onPick ? ' clickable' : '');
        const top = y(base + w);
        return (
          <g key={t.block} className={cls} onClick={onPick ? () => onPick(t.block) : undefined}>
            <rect x={cx - TW / 2} y={top} width={TW} height={w * U} rx={3} className="tile-r" />
            <text x={cx} y={top + (w * U) / 2 + (w === 1 ? 3.5 : 4.5)} className={'tile-t' + (w === 1 ? ' thin' : '')}>
              {blockName(t.block)}
            </text>
            {!picking && t.kind !== 'wait' && (
              // A block whose top stops one unit under the line would have its mark struck through by the line: lift it above.
              <text x={cx} y={(base + w === LINE - 1 ? y(LINE) : top) - 6} className="mark">
                {t.kind === 'win' ? 'win' : isYou ? 'short' : '×'}
              </text>
            )}
            {picking ? (
              <>
                <text x={cx} y={Y0 + 16} className="t-prize">
                  {fmtMult(prizeFor(t.block))}
                </text>
              </>
            ) : (
              isYou && (
                <text x={cx} y={Y0 + 15} className="t-you">
                  you
                </text>
              )
            )}
          </g>
        );
      })}

      {/* The one fixed line. */}
      <line x1={SX0 - 6} x2={TX1} y1={y(LINE)} y2={y(LINE)} className="line" />
      <text x={SX0 - 9} y={y(LINE) + 4} className="axis line-t">
        {LINE}
      </text>
      <text x={SX0 - 9} y={y(LINE) - 8} className="axis">
        line
      </text>

      {picking && (
        <text x={(SX0 + SX1) / 2} y={Y0 + 16} className="axis mid">
          stack
        </text>
      )}
      {note && (
        <text key={note} x={(SX0 + TX1) / 2} y={40} className={'note' + (ending === 'won' ? ' win' : ending === 'cashed' ? '' : ' lose')}>
          {note}
        </text>
      )}
    </svg>
  );
}
