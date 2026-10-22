import { fmtChance } from '@originals/game-sdk/ui';
import { deckBar, share, type Deck } from './math';

export type Outcome = 'hit' | 'miss' | 'cashed' | 'allred' | 'nored';

export interface Reveal {
  /** The card being turned (or called) right now. */
  red: boolean;
  /** Bumps on every flip so the animation restarts. */
  id: number;
  call: boolean;
}

export interface BoardProps {
  deck: Deck;
  red: number;
  black: number;
  /** Cards turned over so far, in order (true = red). */
  turned: boolean[];
  reveal: Reveal | null;
  /** The colour of the card you called, once the call is settled. */
  called: boolean | null;
  outcome: Outcome | null;
  flipMs: number;
  live: boolean;
}

const W = 400;
const COLS = 13;
const PITCH = 28;
const CW = 24;
const CH = 32;
const ROW = 38;
const GX = (W - COLS * PITCH + (PITCH - CW)) / 2;
const BAR_X = 20;
const BAR_W = W - 2 * BAR_X;

function Face({ x, y, w, h, red, className = '' }: { x: number; y: number; w: number; h: number; red: boolean; className?: string }) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const s = Math.min(w, h) * 0.26;
  return (
    <g className={'ci-face ' + (red ? 'red' : 'black') + (className ? ` ${className}` : '')}>
      <rect x={x} y={y} width={w} height={h} rx={Math.max(3, w * 0.1)} />
      {red ? (
        <path d={`M ${cx} ${cy - s} L ${cx + s * 0.75} ${cy} L ${cx} ${cy + s} L ${cx - s * 0.75} ${cy} Z`} className="pip" />
      ) : (
        <circle cx={cx} cy={cy} r={s * 0.7} className="pip" />
      )}
    </g>
  );
}

function Back({ x, y, w, h, label }: { x: number; y: number; w: number; h: number; label?: string }) {
  return (
    <g className="ci-back">
      <rect x={x} y={y} width={w} height={h} rx={10} />
      <rect x={x + 8} y={y + 8} width={w - 16} height={h - 16} rx={6} className="inner" />
      {label && (
        <text x={x + w / 2} y={y + h / 2 + 14} className="q">
          {label}
        </text>
      )}
    </g>
  );
}

export default function Board({ deck, red, black, turned, reveal, called, outcome, flipMs, live }: BoardProps) {
  const n0 = deck.red + deck.black;
  const n = red + black;
  const p = share(red, black);
  const rows = Math.ceil(n0 / COLS);
  const gridY = 290;
  const H = gridY + rows * ROW + 4;
  const bar = deckBar(red, black, BAR_W);

  // The big card: face-down until something flips it.
  const big = { x: 52, y: 14, w: 96, h: 132 };
  let bigCard;
  if (reveal) {
    bigCard = (
      <g key={reveal.id} className="ci-flip" style={{ animationDuration: `${Math.round(flipMs)}ms` }}>
        <Face {...big} red={reveal.red} className={reveal.call ? 'called' : ''} />
      </g>
    );
  } else if (called !== null) {
    bigCard = <Face {...big} red={called} className={'called ' + (called ? 'win' : 'lose')} />;
  } else if (outcome === 'allred') {
    bigCard = <Face {...big} red className="called win" />;
  } else {
    bigCard = <Back {...big} label={outcome === 'nored' ? '×' : '?'} />;
  }

  const bigLabel = reveal
    ? reveal.call
      ? 'your call…'
      : 'turning…'
    : called !== null
      ? called
        ? 'red: called it'
        : 'black: missed'
      : outcome === 'allred'
        ? 'only reds left'
        : outcome === 'nored'
          ? 'no reds left'
          : outcome === 'cashed'
            ? 'cashed out'
            : 'next card';

  // The bracket under the red cells: your chance, drawn as a length.
  const bx1 = BAR_X;
  const bx2 = BAR_X + bar.redWidth;
  const labelX = Math.min(Math.max((bx1 + bx2) / 2, BAR_X + 70), W - BAR_X - 70);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ci-board" role="img" aria-label={`${red} red of ${n} cards left: next card red ${fmtChance(p)}`}>
      {bigCard}
      <text x={big.x + big.w / 2} y={big.y + big.h + 16} className="ci-small">
        {bigLabel}
      </text>

      <g className="ci-odds">
        <text x={186} y={36} className="ci-cap start">
          Next card red
        </text>
        <text x={186} y={92} className="ci-num start">
          <tspan className="r">{red}</tspan>
          <tspan className="slash"> / {n}</tspan>
        </text>
        <text x={186} y={122} className="ci-pct start">
          = {fmtChance(p)}
        </text>
        <text x={186} y={146} className="ci-small start">
          red cards left / cards left
        </text>
      </g>

      {/* The deck bar: every card left, reds first. Its red share is the chance. */}
      <text x={BAR_X} y={184} className="ci-cap start">
        Deck · {n} left
      </text>
      <text x={W - BAR_X} y={184} className="ci-cap end">
        {red} red · {black} black
      </text>
      <g className="ci-bar">
        <rect x={BAR_X - 2} y={192} width={BAR_W + 4} height={30} rx={6} className="frame" />
        {bar.cells.map((c, i) => (
          <rect
            key={i}
            x={BAR_X + c.x + Math.min(1, bar.cell * 0.12)}
            y={196}
            width={Math.max(1, bar.cell - Math.min(2, bar.cell * 0.24))}
            height={22}
            rx={2}
            className={c.red ? 'red' : 'black'}
          />
        ))}
      </g>
      {red > 0 && (
        <g className={'ci-bracket' + (live ? ' live' : '')}>
          <path d={`M ${bx1} 228 V 234 H ${bx2} V 228`} />
          <text x={labelX} y={250}>
            {live ? 'your chance' : 'red share'} {fmtChance(p)}
          </text>
        </g>
      )}
      {red === 0 && (
        <text x={W / 2} y={250} className="ci-none">
          no red cards left
        </text>
      )}

      {/* Every card of the deck, in the order it was turned. */}
      <text x={GX} y={gridY - 6} className="ci-cap start">
        Turned over · {turned.length} of {n0}
      </text>
      {Array.from({ length: n0 }, (_, i) => {
        const x = GX + (i % COLS) * PITCH;
        const y = gridY + Math.floor(i / COLS) * ROW;
        if (i >= turned.length) return <rect key={i} x={x} y={y} width={CW} height={CH} rx={3} className="ci-slot" />;
        const isCall = called !== null && i === turned.length - 1;
        const cls = isCall ? 'called ' + (called ? 'win' : 'lose') : i === turned.length - 1 ? 'last' : '';
        return <Face key={i} x={x} y={y} w={CW} h={CH} red={turned[i]} className={cls} />;
      })}
    </svg>
  );
}
