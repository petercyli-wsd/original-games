import { counts, hasTwinOnTable, pairOf, type Deal } from './math';

const W = 480;
const MID = W / 2;
/** Token radius in its own coordinates; each zone scales it. */
const R = 20;

const SLOT = 60;
const SLOT_GAP = 10;
const SLOT_Y = 34;
const TABLE_Y = SLOT_Y + SLOT / 2;
const HAND_Y = 134;
const PILE_LABEL_Y = 180;
const PILE_Y = 215;
const PILE_STEP = 33;
const PILE_COLS = 12;
const MATCH_LABEL_Y = 290;
const MATCH_Y = 318;
const MATCH_STEP = 36;
const H = 340;

const SCALE = { table: 1, hand: 1.2, pile: 0.65, matched: 0.5 };

/** Twelve hues spread round the wheel, ordered so neighbouring pairs contrast. */
const HUES = [345, 45, 195, 105, 255, 15, 165, 285, 75, 225, 135, 315];
export const pairColour = (pair: number) => `hsl(${HUES[pair % HUES.length]} 85% 70%)`;
export const pairLetter = (pair: number) => String.fromCharCode(65 + pair);

export interface Hand {
  token: number;
  /** In the hand (just drawn), or on its twin's slot (about to clear). */
  at: 'hand' | 'slot';
  slot: number;
  bust: boolean;
}

export interface BoardProps {
  deal: Deal;
  hand: Hand | null;
  /** A round is in progress (risk colours on). */
  live: boolean;
  /** Waiting for the player at a full table. */
  checkpoint: boolean;
  /** Text for the middle band when nothing is in the hand. */
  message: { text: string; tone: 'neutral' | 'risk' | 'safe' | 'win' };
  moveMs: number;
}

const slotX = (k: number, i: number) => MID - (k * SLOT + (k - 1) * SLOT_GAP) / 2 + i * (SLOT + SLOT_GAP) + SLOT / 2;

/** The pile in display order: twins of table tokens first (in slot order), then untouched pairs side by side. */
function pileOrder(d: Deal, hidden: number | null): number[] {
  const pile = d.pile.filter((tok) => tok !== hidden);
  const twins: number[] = [];
  for (const pair of d.table) {
    if (pair === null) continue;
    const tok = pile.find((x) => pairOf(x) === pair);
    if (tok !== undefined) twins.push(tok);
  }
  const rest = pile.filter((tok) => !twins.includes(tok));
  return [...twins, ...rest];
}

function pileXY(i: number, total: number) {
  const row = Math.floor(i / PILE_COLS);
  const inRow = Math.min(PILE_COLS, total - row * PILE_COLS);
  const col = i % PILE_COLS;
  return { x: MID + (col - (inRow - 1) / 2) * PILE_STEP, y: PILE_Y + row * PILE_STEP };
}

export default function Board({ deal, hand, live, checkpoint, message, moveMs }: BoardProps) {
  const { pairs: n, slots: k } = deal;
  const { u, t, left } = counts(deal);
  const full = t === k && u > 0;
  const showRisk = full && ((live && (checkpoint || hand?.at === 'hand')) || !!hand?.bust);
  const order = pileOrder(deal, hand?.token ?? null);
  const pileTotal = order.length;

  const place = new Map<number, { x: number; y: number; s: number; cls: string }>();
  order.forEach((tok, i) => {
    const { x, y } = pileXY(i, pileTotal);
    const twin = hasTwinOnTable(deal, tok);
    const cls = showRisk ? (twin ? 'safe' : 'danger') : twin ? 'waiting' : '';
    place.set(tok, { x, y, s: SCALE.pile, cls });
  });
  deal.table.forEach((pair, i) => {
    if (pair === null) return;
    // The table token is whichever copy is no longer in the pile.
    const tok = deal.pile.includes(2 * pair) ? 2 * pair + 1 : 2 * pair;
    place.set(tok, { x: slotX(k, i), y: TABLE_Y, s: SCALE.table, cls: 'parked' });
  });
  deal.matched.forEach((pair, i) => {
    const x = MID + (i - (n - 1) / 2) * MATCH_STEP;
    place.set(2 * pair, { x: x - 4, y: MATCH_Y - 3, s: SCALE.matched, cls: 'done' });
    place.set(2 * pair + 1, { x: x + 4, y: MATCH_Y + 3, s: SCALE.matched, cls: 'done' });
  });
  if (hand) {
    const p = hand.at === 'slot' ? { x: slotX(k, hand.slot) + 12, y: TABLE_Y + 9 } : { x: MID, y: HAND_Y };
    place.set(hand.token, { ...p, s: hand.at === 'slot' ? SCALE.table : SCALE.hand, cls: hand.bust ? 'busted' : 'drawn' });
  }

  const tokens = Array.from({ length: 2 * n }, (_, tok) => tok).filter((tok) => place.has(tok));
  const safeShare = left > 0 ? t / left : 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="socks" role="img" aria-label={`${t} of ${k} table slots used, ${left} tokens in the pile`}>
      {/* Table */}
      <text x={24} y={20} className="zone">
        TABLE
      </text>
      <text x={W - 24} y={20} className={'zone-r' + (showRisk ? ' risk' : '')}>
        {t} of {k} slots{full && live ? ' · full' : ''}
      </text>
      {Array.from({ length: k }, (_, i) => (
        <rect
          key={i}
          x={slotX(k, i) - SLOT / 2}
          y={SLOT_Y}
          width={SLOT}
          height={SLOT}
          rx={14}
          className={'slot' + (showRisk ? ' full' : '') + (deal.table[i] === null ? ' empty' : '')}
        />
      ))}

      {/* Middle band: what the next draw means */}
      {!hand && (
        <text x={MID} y={HAND_Y + 5} className={`msg ${message.tone}`}>
          {message.text}
        </text>
      )}
      {hand?.bust && (
        <text x={MID + 34} y={HAND_Y + 5} className="msg risk start">
          no room for {pairLetter(pairOf(hand.token))}
        </text>
      )}

      {/* Pile */}
      <text x={24} y={PILE_LABEL_Y} className="zone">
        PILE · {left} left
      </text>
      {showRisk ? (
        <text x={W - 24} y={PILE_LABEL_Y} className="zone-r">
          <tspan className="g">{t} twins safe</tspan>
          <tspan className="dim"> / </tspan>
          <tspan className="r">{2 * u} bust</tspan>
        </text>
      ) : (
        <text x={W - 24} y={PILE_LABEL_Y} className="zone-r">
          {live && left > 0 ? 'free draw' : 'order hidden'}
        </text>
      )}
      {showRisk && (
        <g className="odds-strip" aria-label={`${t} safe of ${left}`}>
          <rect x={24} y={PILE_LABEL_Y + 6} width={W - 48} height={4} rx={2} className="strip-bad" />
          <rect x={24} y={PILE_LABEL_Y + 6} width={(W - 48) * safeShare} height={4} rx={2} className="strip-good" />
        </g>
      )}

      {/* Matched */}
      <text x={24} y={MATCH_LABEL_Y} className="zone">
        MATCHED
      </text>
      <text x={W - 24} y={MATCH_LABEL_Y} className="zone-r">
        {deal.matched.length} of {n} pairs
      </text>
      {deal.matched.length === 0 && (
        <line x1={40} x2={W - 40} y1={MATCH_Y} y2={MATCH_Y} className="match-track" />
      )}

      {tokens.map((tok) => {
        const p = place.get(tok)!;
        const pair = pairOf(tok);
        return (
          <g
            key={tok}
            className={'tok ' + p.cls}
            style={{ transform: `translate(${p.x}px, ${p.y}px) scale(${p.s})`, transitionDuration: `${moveMs}ms` }}
          >
            <circle r={R} style={{ fill: pairColour(pair) }} />
            <text y={7}>{pairLetter(pair)}</text>
          </g>
        );
      })}
    </svg>
  );
}
