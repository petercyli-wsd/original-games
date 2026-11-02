import { HOUSE, N, YOU, houseNeeds, type State } from './math';

// Layout of the 560 × 440 board.
const W = 560;
const H = 440;
const YOU_X = 170; // centre of your pile
const HOUSE_X = 390; // centre of the house pile
const PILE_Y = 66;
const HAND_Y = 266; // top of the house row; your row sits under it
const CARD_H = 38;
const ROW_GAP = 8;
const SLOT = 33; // one value step on the shared 1–14 line
const LINE_X = 80; // where value 0 would sit
const BX = 30; // series bar
const BW = 500;
const BY = 414;

/** Every card sits at its value on one line, so "higher" is "further right". */
const valueX = (v: number) => LINE_X + (v - 0.5) * SLOT;

export interface FlipView {
  /** Your card index and the house's card index. */
  i: number;
  j: number;
  win: boolean;
  /** False while the cards are still face down. */
  revealed: boolean;
  /** Changes on every flip, to restart the animation. */
  id: number;
}

export interface BoardProps {
  /** The state the hands show (before the flip in flight). */
  s: State;
  k: number;
  /** The flip in flight, or the last one. */
  flip: FlipView | null;
  /** Whether the flip is still being animated. */
  flipping: boolean;
  /** The series is over: show where it ended. */
  over: boolean;
  /** The series chance to draw on the bar (frozen at the cash-out when cashed). */
  p: number;
  /** What ended the series, shown at the top once it is over. */
  overTitle?: string;
}

const pct = (p: number) => `${(p * 100).toFixed(p > 0 && p < 0.1 ? 2 : 1)}%`;

export default function Board({ s, k, flip, flipping, over, p, overTitle }: BoardProps) {
  const live = !over && s.you !== 0;
  const shown = flip?.revealed && flipping ? flip : null;
  const need = houseNeeds(k);
  const left = YOU.filter((_, i) => s.you & (1 << i)).length;

  let head: { text: string; tone?: 'g' | 'r' };
  if (!live) head = { text: overTitle ?? 'Series over' };
  else if (shown)
    head = shown.win
      ? { text: `${YOU[shown.i]} beats ${HOUSE[shown.j]}: you take the round`, tone: 'g' }
      : { text: `${HOUSE[shown.j]} beats ${YOU[shown.i]}: the house takes it`, tone: 'r' };
  else head = { text: 'Higher card takes the round · no ties' };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sd" role="img" aria-label={`Series chance ${pct(p)}. You have ${left} cards left. ${s.wins}–${s.losses}.`}>
      <text x={W / 2} y={26} className={'sd-head' + (head.tone ? ` ${head.tone}` : '')}>
        {head.text}
      </text>

      {/* ---------- The face-down piles and the flip ---------- */}
      <Pile cx={YOU_X} label="You" left={left} flip={flip} side="you" flipping={flipping} />
      <Pile cx={HOUSE_X} label="House" left={left} flip={flip} side="house" flipping={flipping} />
      <text x={W / 2} y={PILE_Y + 54} className={'sd-vs' + (flip?.revealed ? (flip.win ? ' g' : ' r') : '')}>
        {flip?.revealed ? (flip.win ? '>' : '<') : 'vs'}
      </text>

      {/* ---------- Round tally under each pile ---------- */}
      <Tally cx={YOU_X} text="to win" got={s.wins} of={k} tone="win" />
      <Tally cx={HOUSE_X} text="to stop you" got={s.losses} of={need} tone="lose" />

      {/* ---------- Both hands on one value line: the cause of the series odds ---------- */}
      <text x={16} y={HAND_Y - 12} className="sd-axis start">
        Cards left
      </text>
      <text x={W - 16} y={HAND_Y - 12} className="sd-note end">
        Played cards don't come back
      </text>
      <Hand
        y={HAND_Y}
        side="house"
        name="House"
        kind="odd cards"
        values={HOUSE}
        mask={s.house}
        flip={flip}
        flipping={flipping}
      />
      <Hand y={HAND_Y + CARD_H + ROW_GAP} side="you" name="You" kind="even cards" values={YOU} mask={s.you} flip={flip} flipping={flipping} />
      <text x={valueX(1) - 15} y={HAND_Y + 2 * CARD_H + ROW_GAP + 22} className="sd-note start">
        Spending a high card weakens your hand
      </text>
      <text x={W - 16} y={HAND_Y + 2 * CARD_H + ROW_GAP + 22} className="sd-note end">
        higher →
      </text>

      {/* ---------- Series odds bar ---------- */}
      <text x={BX} y={BY - 10} className="sd-bar-label">
        Chance to win the series
      </text>
      <text x={BX + BW} y={BY - 9} className="sd-bar-value">
        {pct(p)}
      </text>
      <rect x={BX} y={BY} width={BW} height={14} rx={7} className="sd-track" />
      <rect x={BX} y={BY} width={Math.max(0, BW * p)} height={14} rx={7} className="sd-fill" />
    </svg>
  );
}

function Hand({
  y,
  side,
  name,
  kind,
  values,
  mask,
  flip,
  flipping,
}: {
  y: number;
  side: 'you' | 'house';
  name: string;
  kind: string;
  values: readonly number[];
  mask: number;
  flip: FlipView | null;
  flipping: boolean;
}) {
  const at = (idx: number) => (flip ? (side === 'you' ? flip.i === idx : flip.j === idx) : false);
  const won = flip ? (side === 'you' ? flip.win : !flip.win) : false;
  return (
    <g className={`sd-hand ${side}`}>
      <text x={16} y={y + 17} className="sd-row-name">
        {name}
      </text>
      <text x={16} y={y + 32} className="sd-row-kind">
        {kind}
      </text>
      {values.map((v, idx) => {
        const inHand = (mask & (1 << idx)) !== 0;
        // The pair being shown lights up; once applied it greys out with the rest of the spent cards.
        const on = inHand && flipping && flip?.revealed && at(idx);
        const last = !inHand && !flipping && at(idx);
        const cls = 'sd-card' + (inHand ? '' : ' spent') + (on ? (won ? ' on won' : ' on lost') : '') + (last ? ' last' : '');
        const x = valueX(v);
        return (
          <g key={v} className={cls}>
            <rect x={x - 15} y={y} width={30} height={CARD_H} rx={5} />
            <text x={x} y={y + 25}>
              {v}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Tally({ cx, text, got, of, tone }: { cx: number; text: string; got: number; of: number; tone: 'win' | 'lose' }) {
  const y = 206;
  return (
    <g>
      <text x={cx} y={y} className="sd-tally">
        <tspan className={tone === 'win' ? 'g' : 'r'}>{got}</tspan> / {of} {text}
      </text>
      {Array.from({ length: of }, (_, t) => (
        <circle key={t} cx={cx + (t - (of - 1) / 2) * 22} cy={y + 18} r={8} className={'sd-pip' + (t < got ? ` ${tone}` : '')} />
      ))}
    </g>
  );
}

function Pile({ cx, label, left, flip, side, flipping }: { cx: number; label: string; left: number; flip: FlipView | null; side: 'you' | 'house'; flipping: boolean }) {
  const x = cx - 34;
  const y = PILE_Y;
  const face = flip?.revealed ? (side === 'you' ? YOU[flip.i] : HOUSE[flip.j]) : null;
  const won = flip ? (side === 'you' ? flip.win : !flip.win) : false;
  // While a flip is in flight the pile still holds the flipped card.
  const backs = flipping ? left - 1 : left;
  return (
    <g className={`sd-pile ${side}`}>
      <text x={cx} y={y - 10} className="sd-axis">
        {label}
      </text>
      {backs > 0 && (
        <>
          {backs > 1 && <rect x={x + 4} y={y + 4} width={68} height={92} rx={8} className="sd-back under" />}
          <rect x={x} y={y} width={68} height={92} rx={8} className="sd-back" />
          <rect x={x + 8} y={y + 8} width={52} height={76} rx={4} className="sd-back-inner" />
        </>
      )}
      {flip && (
        <g key={flip.id} className={'sd-flip' + (flip.revealed ? ' up' : '') + (flip.revealed ? (won ? ' won' : ' lost') : '')}>
          <rect x={x} y={y} width={68} height={92} rx={8} />
          {face !== null && (
            <text x={cx} y={y + 58}>
              {face}
            </text>
          )}
        </g>
      )}
      <text x={cx + 2} y={y + 114} className="sd-left">
        {backs} of {N} face down
      </text>
    </g>
  );
}
