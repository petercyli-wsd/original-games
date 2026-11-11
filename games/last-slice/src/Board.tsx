import { LETTERS } from './math';

const CX = 200;
const CY = 204;
const R = 136;
const HUB = 46;

const f = (v: number) => v.toFixed(2);
const pct = (p: number) => (p >= 0.9995 ? '100%' : p < 0.0995 ? `${(p * 100).toFixed(p < 0.00995 ? 2 : 1)}%` : `${Math.round(p * 100)}%`);

/** A point at `deg` degrees clockwise from the top. */
const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: CX + r * Math.sin(a), y: CY - r * Math.cos(a) };
};

/** A pie wedge from a0 to a1 (degrees, clockwise). */
function wedge(a0: number, a1: number, r: number) {
  const span = a1 - a0;
  if (span >= 359.99) return `M ${CX} ${CY - r} A ${r} ${r} 0 1 1 ${CX - 0.01} ${CY - r} Z`;
  const p = polar(a0, r);
  const q = polar(a1, r);
  return `M ${CX} ${CY} L ${f(p.x)} ${f(p.y)} A ${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${f(q.x)} ${f(q.y)} Z`;
}

/** An arc along radius r from a0 to a1 (degrees, clockwise). */
function arc(a0: number, a1: number, r: number) {
  const span = Math.min(a1 - a0, 359.99);
  const p = polar(a0, r);
  const q = polar(a0 + span, r);
  return `M ${f(p.x)} ${f(p.y)} A ${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${f(q.x)} ${f(q.y)}`;
}

export type Outcome = 'won' | 'lost' | 'cashed';

export interface BoardProps {
  /** Slice sizes as drawn now (0 once out; shrinking while a slice leaves). */
  sizes: readonly number[];
  /** Wheel rotation in degrees (slice A starts here, clockwise from the top). */
  rot: number;
  mine: number;
  /** Your chance to win now. */
  win: number;
  /** The slice the pointer just landed on. */
  hit: number | null;
  outcome: Outcome | null;
  editable: boolean;
  onSlice(i: number): void;
}

export default function Board({ sizes, rot, mine, win, hit, outcome, editable, onSlice }: BoardProps) {
  const W = sizes.reduce((a, b) => a + b, 0);
  const slices: { i: number; a0: number; a1: number }[] = [];
  let cum = 0;
  sizes.forEach((s, i) => {
    if (!(s > 0)) return;
    slices.push({ i, a0: rot + (cum / W) * 360, a1: rot + ((cum + s) / W) * 360 });
    cum += s;
  });
  const winDeg = Math.max(0, Math.min(1, win)) * 360;

  return (
    <svg viewBox="40 34 320 336" className="ls-wheel" role="img" aria-label={`Your slice ${LETTERS[mine]}: ${pct(win)} to be the last slice`}>
      {/* The wheel: each slice's angle is its chance to be hit by the next spin. Yours is the accent; once the round ends it keeps its result colour. */}
      <g className="slices">
        {slices.map(({ i, a0, a1 }) => (
          <path
            key={i}
            d={wedge(a0, a1, R)}
            className={
              `slice s${i % 2}` +
              (i === mine ? ' mine' : '') +
              (hit === i && i === mine ? ' lose' : '') +
              (outcome === 'won' && i === mine ? ' champ' : '')
            }
            onClick={editable ? () => onSlice(i) : undefined}
            style={editable ? { cursor: 'pointer' } : undefined}
          >
            <title>{`Slice ${LETTERS[i]}${i === mine ? ' (yours)' : ''}`}</title>
          </path>
        ))}
      </g>

      {/* Letters. */}
      <g className="labels">
        {slices.map(({ i, a0, a1 }) => {
          const span = a1 - a0;
          const p = polar((a0 + a1) / 2, R * (span < 26 ? 0.8 : 0.68));
          if (span < 7.5) return null;
          return (
            <text key={i} x={f(p.x)} y={f(p.y + 6)} className={'letter' + (span >= 24 ? '' : ' sm') + (i === mine ? ' mine' : '')}>
              {LETTERS[i]}
            </text>
          );
        })}
      </g>

      {/* The pointer. */}
      <path d={`M ${CX - 11} ${CY - R - 22} L ${CX + 11} ${CY - R - 22} L ${CX} ${CY - R + 6} Z`} className={'pointer' + (hit !== null && hit === mine ? ' lose' : '')} />

      {/* Hub: your chance as a green arc, the rest red. */}
      <circle cx={CX} cy={CY} r={HUB} className="hub" />
      <circle cx={CX} cy={CY} r={HUB - 7} className="dial-bg" />
      {winDeg > 0.5 && <path d={arc(0, winDeg, HUB - 7)} className="dial-win" />}
      {outcome === null ? (
        <text x={CX} y={CY + 6} className="big">
          {LETTERS[mine]}
        </text>
      ) : (
        <text x={CX} y={CY + 6} className={'verdict ' + outcome}>
          {outcome === 'won' ? 'last' : outcome === 'lost' ? 'out' : 'cashed'}
        </text>
      )}
    </svg>
  );
}
