import { fmtChance } from '@originals/game-sdk/ui';
import { CARDS, COLS, ROWS, colOf, onCross, rowOf, type NextCard } from './math';

const W = 560;
const CW = 124;
const CH = 100;
const GAP = 12;
const GX = (W - (COLS * CW + (COLS - 1) * GAP)) / 2;
const GY = 50;
const GRID_H = ROWS * CH + (ROWS - 1) * GAP;
const BAR_Y = GY + GRID_H + 44;
const H = BAR_Y + 30;

/** Row colours (the card's colour) and column shapes. */
export const COLOURS = ['#60a5fa', '#c084fc', '#f1f5f9'] as const;
export const COLOUR_NAMES = ['blue', 'violet', 'white'] as const;
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
  /** What each card left would do if it came next (null: no labels). */
  options: readonly NextCard[] | null;
  /** Win chance now, for the bar and the up / down marks. */
  p: number;
  outcome: Outcome | null;
}

const cellX = (c: number) => GX + colOf(c) * (CW + GAP);
const cellY = (c: number) => GY + rowOf(c) * (CH + GAP);

function Shape({ c, cx, cy, s }: { c: number; cx: number; cy: number; s: number }) {
  const fill = COLOURS[rowOf(c)];
  switch (colOf(c)) {
    case 0:
      return <circle cx={cx} cy={cy} r={s} fill={fill} className="shape" />;
    case 1:
      return <polygon points={`${cx},${cy - s * 1.1} ${cx + s * 1.1},${cy + s * 0.85} ${cx - s * 1.1},${cy + s * 0.85}`} fill={fill} className="shape" />;
    case 2:
      return <rect x={cx - s * 0.88} y={cy - s * 0.88} width={s * 1.76} height={s * 1.76} rx={3} fill={fill} className="shape" />;
    default:
      return <polygon points={`${cx},${cy - s * 1.15} ${cx + s},${cy} ${cx},${cy + s * 1.15} ${cx - s},${cy}`} fill={fill} className="shape" />;
  }
}

export default function Board({ k, order, hit, hop, options, p, outcome }: BoardProps) {
  const turned = new Set(order);
  const cur = order.length ? order[order.length - 1] : null;
  const survived = Math.max(0, order.length - 1);
  const showCross = cur !== null && outcome !== 'won';
  const byCard = new Map(options?.map((o) => [o.card, o]) ?? []);
  const best = Math.max(1e-12, ...(options ?? []).map((o) => o.after));
  const safe = options ? options.filter((o) => !o.killer).length : 0;
  const left = CARDS - turned.size;

  let head: string;
  let headTone = '';
  if (outcome === 'won') {
    head = k === 1 ? 'Survived the turn' : `Survived all ${k} turns`;
    headTone = ' won';
  } else if (outcome === 'lost' && hit !== null && cur !== null) {
    head = `${rowOf(hit) === rowOf(cur) ? 'Same colour' : 'Same shape'} as the last card`;
    headTone = ' lost';
  } else if (outcome === 'dead') {
    head = 'No order of the cards left survives';
    headTone = ' lost';
  } else if (outcome === 'cashed') head = `Cashed out after ${survived} ${survived === 1 ? 'turn' : 'turns'}`;
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
      <text x={W - GX} y={26} className={'head end' + headTone}>
        {head}
      </text>

      {/* The red cross: the last card's row (colour) and column (shape) */}
      {showCross && cur !== null && (
        <g className="cross-band">
          <rect x={GX - 6} y={cellY(cur) - 6} width={COLS * CW + (COLS - 1) * GAP + 12} height={CH + 12} rx={14} />
          <rect x={cellX(cur) - 6} y={GY - 6} width={CW + 12} height={GRID_H + 12} rx={14} />
        </g>
      )}

      {/* The deck grid */}
      {Array.from({ length: CARDS }, (_, c) => {
        const x = cellX(c);
        const y = cellY(c);
        const isCur = c === cur;
        const isHit = c === hit;
        if (turned.has(c) && !isCur) {
          return <rect key={c} x={x} y={y} width={CW} height={CH} rx={12} className="slot" />;
        }
        const o = byCard.get(c);
        const killer = !isCur && showCross && cur !== null && onCross(cur, c);
        let cls = 'card';
        if (isCur) cls += ' current';
        else if (isHit) cls += ' hit';
        else if (killer) cls += ' killer';
        else if (o) cls += ' safe';
        // Brighter green = a higher win chance if this card comes next.
        const tint = o && !o.killer ? 0.1 + 0.62 * (o.after / best) ** 2 : undefined;
        let label: string | null = null;
        let labelCls = 'tag';
        if (isHit) {
          label = '✕ crossed';
          labelCls += ' bad';
        } else if (isCur && outcome === 'won') {
          label = '✓ survived';
          labelCls += ' won';
        } else if (isCur) label = 'last card';
        else if (o?.killer) {
          label = '✕';
          labelCls += ' bad';
        } else if (o && o.after >= 1) {
          label = '✓ win';
          labelCls += ' up';
        } else if (o) {
          const up = o.after > p + 1e-12;
          const same = Math.abs(o.after - p) <= 1e-12;
          label = `${same ? '=' : up ? '▲' : '▼'} ${fmtChance(o.after)}`;
          labelCls += up ? ' up' : same ? '' : ' down';
        }
        return (
          <g key={c} className={cls}>
            <rect x={x} y={y} width={CW} height={CH} rx={12} className="face" style={tint !== undefined ? { fillOpacity: tint } : undefined} />
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
      {hop !== null && <rect x={cellX(hop) - 5} y={cellY(hop) - 5} width={CW + 10} height={CH + 10} rx={15} className="hop" />}

      {/* Win chance, exact: the average of the cards' tints */}
      <text x={GX} y={BAR_Y - 10} className="lbl start">
        Win chance
      </text>
      <text x={W - GX} y={BAR_Y - 10} className={'pct end' + (p >= 1 ? ' won' : p <= 0 ? ' lost' : '')}>
        {fmtChance(p)}
      </text>
      <rect x={GX} y={BAR_Y} width={W - 2 * GX} height={16} rx={8} className="track" />
      {p > 0 && <rect x={GX} y={BAR_Y} width={Math.max(8, (W - 2 * GX) * p)} height={16} rx={8} className="fill" />}
    </svg>
  );
}
