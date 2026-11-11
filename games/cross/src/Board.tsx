import { fmtChance } from '@originals/game-sdk/ui';
import { CARDS, COLS, ROWS, colOf, onCross, rowOf, type NextCard } from './math';

const W = 560;
const CW = 124;
const CH = 100;
const GAP = 12;
const GX = (W - (COLS * CW + (COLS - 1) * GAP)) / 2;
const GY = 50;
const GRID_H = ROWS * CH + (ROWS - 1) * GAP;
const H = GY + GRID_H + 10;

/** Row "colours" are three neutral shades: light, grey and an outline. */
export const COLOUR_NAMES = ['light', 'grey', 'outline'] as const;
export const SHAPE_NAMES = ['circle', 'triangle', 'square', 'diamond'] as const;
export const cardName = (c: number) => `${COLOUR_NAMES[rowOf(c)]} ${SHAPE_NAMES[colOf(c)]}`;

export type Outcome = 'won' | 'lost' | 'cashed' | 'dead';

export interface BoardProps {
  k: number;
  /** Cards turned so far, in order; the last one is the current card. */
  order: readonly number[];
  /** The card that ended the round by landing on the cross. */
  hit: number | null;
  /** The cell the draw is passing over (null when not drawing). */
  hop: number | null;
  /** What each card left would do if it came next (null: no marks). */
  options: readonly NextCard[] | null;
  /** Win chance now, for the label only. */
  p: number;
  outcome: Outcome | null;
}

const cellX = (c: number) => GX + colOf(c) * (CW + GAP);
const cellY = (c: number) => GY + rowOf(c) * (CH + GAP);

function Shape({ c, cx, cy, s }: { c: number; cx: number; cy: number; s: number }) {
  const cls = `shape row${rowOf(c)}`;
  switch (colOf(c)) {
    case 0:
      return <circle cx={cx} cy={cy} r={s} className={cls} />;
    case 1:
      return <polygon points={`${cx},${cy - s * 1.1} ${cx + s * 1.1},${cy + s * 0.85} ${cx - s * 1.1},${cy + s * 0.85}`} className={cls} />;
    case 2:
      return <rect x={cx - s * 0.88} y={cy - s * 0.88} width={s * 1.76} height={s * 1.76} rx={3} className={cls} />;
    default:
      return <polygon points={`${cx},${cy - s * 1.15} ${cx + s},${cy} ${cx},${cy + s * 1.15} ${cx - s},${cy}`} className={cls} />;
  }
}

export default function Board({ k, order, hit, hop, options, p, outcome }: BoardProps) {
  const turned = new Set(order);
  const cur = order.length ? order[order.length - 1] : null;
  const survived = Math.max(0, order.length - 1);
  const showCross = cur !== null && outcome !== 'won';
  const byCard = new Map(options?.map((o) => [o.card, o]) ?? []);
  const safe = options ? options.filter((o) => !o.killer).length : 0;
  const left = CARDS - turned.size;

  let head: string;
  if (outcome === 'won') head = k === 1 ? 'Survived the turn' : `Survived all ${k} turns`;
  else if (outcome === 'lost' && hit !== null && cur !== null) head = `${rowOf(hit) === rowOf(cur) ? 'Same colour' : 'Same shape'} as the last card`;
  else if (outcome === 'dead') head = 'No order of the cards left survives';
  else if (outcome === 'cashed') head = `Cashed out after ${survived} ${survived === 1 ? 'turn' : 'turns'}`;
  else if (options) head = safe === left ? `All ${left} cards left are safe` : `${safe} of ${left} cards left are safe`;
  else head = `Survive ${k} ${k === 1 ? 'turn' : 'turns'} after the first card`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cross" role="img" aria-label={`${head}. Win chance ${fmtChance(p)}`}>
      {/* Turn pips: one per turn to survive */}
      <text x={GX} y={26} className="lbl start">
        Turns
      </text>
      {Array.from({ length: k }, (_, i) => (
        <circle key={i} cx={GX + 74 + i * 22} cy={20} r={8} className={'pip' + (i < survived ? ' on' : '')} />
      ))}

      {/* The deck grid. Cards in the last card's row or column (the cross) are outlined red, the rest green. */}
      {Array.from({ length: CARDS }, (_, c) => {
        const x = cellX(c);
        const y = cellY(c);
        const isCur = c === cur;
        const isHit = c === hit;
        if (turned.has(c) && !isCur) {
          return <rect key={c} x={x} y={y} width={CW} height={CH} rx={8} className="slot" />;
        }
        const o = byCard.get(c);
        const killer = !isCur && showCross && cur !== null && onCross(cur, c);
        let cls = 'card';
        if (isCur) cls += ' current';
        else if (isHit) cls += ' hit';
        else if (killer) cls += ' killer';
        else if (o) cls += ' safe';
        let label: string | null = null;
        let labelCls = 'tag';
        if (isHit) {
          label = 'crossed';
          labelCls += ' bad';
        } else if (isCur && outcome === 'won') {
          label = 'survived';
          labelCls += ' won';
        } else if (isCur) label = 'last card';
        return (
          <g key={c} className={cls}>
            <rect x={x} y={y} width={CW} height={CH} rx={8} className="face" />
            <Shape c={c} cx={x + CW / 2} cy={y + (label ? 40 : CH / 2)} s={label ? 20 : 24} />
            {label && (
              <text x={x + CW / 2} y={y + CH - 14} className={labelCls}>
                {label}
              </text>
            )}
          </g>
        );
      })}

      {/* The draw passing over the cards left */}
      {hop !== null && <rect x={cellX(hop) - 5} y={cellY(hop) - 5} width={CW + 10} height={CH + 10} rx={10} className="hop" />}
    </svg>
  );
}
