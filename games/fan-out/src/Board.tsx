import { fmtChance } from '@originals/game-sdk/ui';
import { FUSES, RANKS, SUITS, SUIT_NAMES, burnCount, cardId, glowOf, has, laidCount, type State } from './math';

const W = 560;
const LABEL = 84;
const CW = 62;
const CH = 64;
const GAP = 6;
const GY = 40;
const GRID_H = SUITS * CH + (SUITS - 1) * GAP;
const H = GY + GRID_H + 54;

export type Outcome = 'won' | 'lost' | 'cashed';

export interface BoardProps {
  k: number;
  state: State;
  /** The card turned last, laid or burned: stays marked until the next card lands. */
  last: number | null;
  /** The slot the draw is passing over (null when not drawing). */
  hop: number | null;
  /** Win chance now, for the label only. */
  p: number;
}

const cellX = (rank: number) => LABEL + (rank - 1) * (CW + GAP);
const cellY = (suit: number) => GY + suit * (CH + GAP);

export default function Board({ k, state, last, hop, p }: BoardProps) {
  const glow = glowOf(state);
  const lit = new Set(glow.lay);
  const grey = new Set(glow.dead);
  const laid = laidCount(state);
  const burns = burnCount(state);
  const pipX = (i: number) => W - 10 - (k - 1 - i) * 18;
  const keyY = GY + GRID_H + 24;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="fanout" role="img" aria-label={`${laid} of ${k} laid, ${burns} of ${FUSES} fuses burned. Win chance ${fmtChance(p)}`}>
      <text x={0} y={26} className="lbl start">
        Fuses
      </text>
      {Array.from({ length: FUSES }, (_, i) => (
        <circle key={i} cx={68 + i * 22} cy={20} r={8} className={'fuse' + (i < burns ? ' burnt' : '')} />
      ))}
      <text x={pipX(0) - 22} y={26} className="lbl end">
        Laid
      </text>
      {Array.from({ length: k }, (_, i) => (
        <circle key={i} cx={pipX(i)} cy={20} r={7} className={'pip' + (i < laid ? ' on' : '')} />
      ))}

      {Array.from({ length: SUITS }, (_, s) => (
        <g key={s}>
          <text x={0} y={cellY(s) + CH / 2 + 5} className="lbl start row">
            {SUIT_NAMES[s]}
          </text>
          {Array.from({ length: RANKS }, (_, i) => {
            const rank = i + 1;
            const c = cardId(s, rank);
            const x = cellX(rank);
            const y = cellY(s);
            const isLaid = has(state.laid, c);
            const isBurned = has(state.burned, c);
            const isLast = c === last;
            let cls = 'slot';
            if (isLaid) cls += ' laid';
            else if (isBurned) cls += ' burned';
            else if (lit.has(c)) cls += ' lit';
            else if (grey.has(c)) cls += ' grey';
            if (isLast) cls += ' last';
            return (
              <g key={c} className={cls}>
                <rect x={x} y={y} width={CW} height={CH} rx={6} className="face" />
                <text x={x + CW / 2} y={y + (isLast ? 30 : 39)} className="rank">
                  {rank}
                </text>
                {isBurned && (
                  <path d={`M${x + 8} ${y + 8} L${x + CW - 8} ${y + CH - 8} M${x + CW - 8} ${y + 8} L${x + 8} ${y + CH - 8}`} className="cross" />
                )}
                {isLast && (
                  <text x={x + CW / 2} y={y + CH - 9} className="tag">
                    last
                  </text>
                )}
              </g>
            );
          })}
        </g>
      ))}

      {hop !== null && <rect x={cellX((hop % RANKS) + 1) - 4} y={cellY(Math.floor(hop / RANKS)) - 4} width={CW + 8} height={CH + 8} rx={9} className="hop" />}

      <text x={W / 2} y={keyY} className="key">
        {`Next card lays: ${glow.lay.length} of ${glow.left} slots`}
      </text>
      <text x={W / 2} y={keyY + 22} className="key dim">
        Green slot lays next, grey never
      </text>
    </svg>
  );
}
