import { LETTERS, type NextEvent } from './math';

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

const hubPct = (p: number) => (p >= 0.9995 ? '100%' : `${(p * 100).toFixed(p < 0.0995 ? 2 : 1)}%`);
const norm = (deg: number) => ((deg % 360) + 360) % 360;

export type Outcome = 'won' | 'lost' | 'cashed';

export interface BoardProps {
  /** Slice sizes as drawn now (0 once out; shrinking while a slice leaves). */
  sizes: readonly number[];
  /** Wheel rotation in degrees (slice A starts here, clockwise from the top). */
  rot: number;
  mine: number;
  /** Each slice's chance to be the last one (for the slices still in). */
  last: ArrayLike<number>;
  /** The next spin's landings with the odds each would leave you (at a checkpoint). */
  events: readonly NextEvent[] | null;
  /** Your chance to win now. */
  win: number;
  /** The slice the pointer just landed on. */
  hit: number | null;
  outcome: Outcome | null;
  /** Slices already out, in order. */
  out: readonly number[];
  spins: number;
  live: boolean;
  /** The wheel is turning: light up the slice passing under the pointer. */
  spinning: boolean;
  editable: boolean;
  onSlice(i: number): void;
}

export default function Board({ sizes, rot, mine, last, events, win, hit, outcome, out, spins, live, spinning, editable, onSlice }: BoardProps) {
  const W = sizes.reduce((a, b) => a + b, 0);
  const slices: { i: number; a0: number; a1: number; share: number }[] = [];
  let cum = 0;
  sizes.forEach((s, i) => {
    if (!(s > 0)) return;
    slices.push({ i, a0: rot + (cum / W) * 360, a1: rot + ((cum + s) / W) * 360, share: s / W });
    cum += s;
  });
  const evOf = (i: number) => events?.find((e) => e.slice === i) ?? null;
  const mineSlice = slices.find((s) => s.i === mine);
  const winDeg = Math.max(0, Math.min(1, win)) * 360;
  // While the wheel turns, the slice under the pointer lights up (red when it is yours).
  const under = spinning && hit === null ? (slices.find((s) => norm(-s.a0) < s.a1 - s.a0)?.i ?? null) : null;

  return (
    <svg viewBox="0 0 400 412" className="ls-wheel" role="img" aria-label={`Your slice ${LETTERS[mine]}: ${pct(win)} to be the last slice`}>
      {/* Rim track, with your slice's arc in red while live: the chance this spin knocks you out. */}
      <circle cx={CX} cy={CY} r={R + 7} className="rim" />
      {live && mineSlice && <path d={arc(mineSlice.a0, mineSlice.a1, R + 7)} className="rim-risk" />}

      {/* The wheel: each slice's angle is its chance to be hit by the next spin. */}
      <g className="slices">
        {slices.map(({ i, a0, a1 }) => (
          <path
            key={i}
            d={wedge(a0, a1, R)}
            className={
              `slice c${i}` +
              (i === mine ? ' mine' : '') +
              (hit === i ? (i === mine ? ' hit lose' : ' hit') : '') +
              (under === i ? (i === mine ? ' under danger' : ' under') : '') +
              (outcome === 'won' && i === mine ? ' champ' : '')
            }
            onClick={editable ? () => onSlice(i) : undefined}
            style={editable ? { cursor: 'pointer' } : undefined}
          >
            <title>{`Slice ${LETTERS[i]}${i === mine ? ' (yours)' : ''}`}</title>
          </path>
        ))}
      </g>

      {/* Labels: the letter and its spin chance inside; outside, its chance to be last (idle) or your odds if it is hit (live). */}
      <g className="labels">
        {slices.map(({ i, a0, a1, share }) => {
          const span = a1 - a0;
          const mid = (a0 + a1) / 2;
          const inR = R * (span < 26 ? 0.8 : 0.68);
          const p = polar(mid, inR);
          const big = span >= 24;
          const ev = evOf(i);
          // Labels next to the pointer step aside, left or right of it.
          const signed = norm(mid) > 180 ? norm(mid) - 360 : norm(mid);
          const nearTop = Math.abs(signed) < 11;
          const o = nearTop ? { x: CX + (signed < 0 ? -36 : 36), y: CY - R - 16 } : polar(mid, R + 24);
          let outer: { text: string; cls: string } | null = null;
          if (ev) outer = i === mine ? { text: 'out', cls: 'lose' } : { text: `→${pct(ev.win)}`, cls: 'up' };
          else if (!live && outcome === null && slices.length > 1) outer = { text: pct(last[i]), cls: i === mine ? 'mine' : '' };
          return (
            <g key={i} className={'lab' + (i === mine ? ' mine' : '')}>
              {span >= 7.5 && (
                <text x={f(p.x)} y={f(p.y + (big ? -2 : 5))} className={'letter' + (big ? '' : ' sm')}>
                  {LETTERS[i]}
                </text>
              )}
              {big && (
                <text x={f(p.x)} y={f(p.y + 13)} className="share">
                  {pct(share)}
                </text>
              )}
              {outer && span < 300 && (
                <text x={f(o.x)} y={f(o.y + 4)} className={'outer ' + outer.cls}>
                  {outer.text}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* The pointer. */}
      <path d={`M ${CX - 11} ${CY - R - 22} L ${CX + 11} ${CY - R - 22} L ${CX} ${CY - R + 6} Z`} className={'pointer' + (hit !== null ? (hit === mine ? ' lose' : ' hit') : under === mine ? ' danger' : '')} />

      {/* Hub: your chance as a green arc. */}
      <circle cx={CX} cy={CY} r={HUB} className="hub" />
      <circle cx={CX} cy={CY} r={HUB - 7} className="dial-bg" />
      {winDeg > 0.5 && <path d={arc(0, winDeg, HUB - 7)} className="dial-win" />}
      {outcome === null ? (
        <>
          <text x={CX} y={CY + 3} className="big">
            {hubPct(win)}
          </text>
          <text x={CX} y={CY + 18} className="small">
            {LETTERS[mine]} is last
          </text>
        </>
      ) : (
        <>
          <text x={CX} y={CY + 2} className={'verdict ' + outcome}>
            {outcome === 'won' ? 'last!' : outcome === 'lost' ? 'out' : 'cashed'}
          </text>
          <text x={CX} y={CY + 18} className="small">
            {outcome === 'cashed' ? `at ${pct(win)}` : `slice ${LETTERS[mine]}`}
          </text>
        </>
      )}

      {/* Legend. */}
      <g className="legend">
        <text x={6} y={392}>
          {out.length ? `out: ${out.map((i) => LETTERS[i]).join(' → ')}` : 'slice size = chance the spin hits it'}
        </text>
        <text x={6} y={408} className="dim">
          {live ? (events ? 'outside: your odds if that slice is hit' : `spin ${spins + 1}`) : outcome ? `${spins} spin${spins === 1 ? '' : 's'}` : 'outside: chance to be the last slice'}
        </text>
        <text x={394} y={392} className="end">
          {live ? <tspan className="r">red rim = hits yours</tspan> : 'small slices survive'}
        </text>
        <text x={394} y={408} className="end dim">
          {slices.length} of {sizes.length} left
        </text>
      </g>
    </svg>
  );
}
