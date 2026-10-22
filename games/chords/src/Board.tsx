import type { CSSProperties } from 'react';
import { blockStarts, separates, type Arc, type Chord, type Face, type Pace, type Region } from './math';

// ---------- Geometry ----------

const C = 200;
const R = 156;

/**
 * Region colours by tone: no reds, greens or golds, so crossing, safe and cash
 * keep their meaning. Three hue families interleaved (cyan/blue, violet,
 * pink/silver); neighbouring regions never share a family when avoidable.
 */
export const REGION_COLOURS = ['#4cc9f0', '#a78bfa', '#f5b0fb', '#5b7cff', '#d18cff', '#dfe6ef', '#a5e8ff', '#8f9bff', '#ff9fcf'];
export const regionColour = (tone: number) => REGION_COLOURS[tone % REGION_COLOURS.length];

const polar = (turn: number, r = R) => {
  const a = turn * 2 * Math.PI;
  return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) };
};
const xy = (p: { x: number; y: number }) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;

/** SVG path along the rim for an arc (clockwise from the top). */
function arcPath({ start, length }: Arc, r = R) {
  if (length >= 0.99999) {
    const a = polar(start, r);
    const b = polar(start + 0.5, r);
    return `M ${xy(a)} A ${r} ${r} 0 1 1 ${xy(b)} A ${r} ${r} 0 1 1 ${xy(a)}`;
  }
  return `M ${xy(polar(start, r))} A ${r} ${r} 0 ${length > 0.5 ? 1 : 0} 1 ${xy(polar(start + length, r))}`;
}

/** A region's outline: its rim arcs joined by the chords between them. */
function facePath(face: Face) {
  if (face.arcs.length === 1 && face.arcs[0].length >= 0.99999) return arcPath(face.arcs[0]) + ' Z';
  let d = '';
  face.arcs.forEach((a, i) => {
    d += `${i === 0 ? 'M' : ' L'} ${xy(polar(a.start))} A ${R} ${R} 0 ${a.length > 0.5 ? 1 : 0} 1 ${xy(polar(a.start + a.length))}`;
  });
  return d + ' Z';
}

/** Where two chords cross, in board coordinates. */
function crossing(c: Chord, d: Chord) {
  const p = polar(c.a);
  const q = polar(c.b);
  const r = polar(d.a);
  const s = polar(d.b);
  const den = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
  const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / den;
  return { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) };
}

const chordLength = (c: Chord) => {
  const p = polar(c.a);
  const q = polar(c.b);
  return Math.hypot(q.x - p.x, q.y - p.y);
};

const pct = (p: number, digits = 0) => `${(p * 100).toFixed(digits)}%`;

const turnGap = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 1) + 1) % 1);
  return Math.min(d, 1 - d);
};

/**
 * Share labels just outside the rim, on each region's longest arc (away from
 * the first end's marker); small or crowded ones are skipped.
 */
function labels(rs: readonly Region[], only: number | null, avoid: number | null) {
  if (rs.length < 2) return [];
  const placed: { at: number; r: Region; i: number }[] = [];
  const order = rs.map((r, i) => ({ r, i })).sort((a, b) => b.r.length - a.r.length);
  for (const { r, i } of order) {
    if (only !== null && i !== only) continue;
    if (r.length < 0.035 && only === null) continue;
    const arc = r.arcs.reduce((m, a) => (a.length > m.length ? a : m));
    let at = arc.start + arc.length / 2;
    if (avoid !== null && turnGap(at, avoid) < 0.05) {
      const options = [0.2, 0.35, 0.65, 0.8].map((f) => arc.start + f * arc.length);
      at = options.reduce((m, o) => (turnGap(o, avoid) > turnGap(m, avoid) ? o : m));
    }
    const near = placed.some((p) => turnGap(p.at, at) < 0.05);
    if (!near) placed.push({ at, r, i });
  }
  return placed;
}

// ---------- The circle ----------

export interface RimProps {
  /** Chords that landed clear. */
  chords: Chord[];
  /** Their regions, in display order. */
  regions: Region[];
  /** First end of the chord in progress, once it has landed. */
  first: number | null;
  /** Index of the first end's region (the safe region for the second end). */
  home: number | null;
  /** The chord whose line is being drawn (both ends landed), or that crossed. */
  drawing: Chord | null;
  /** Whether `drawing` crossed a chord. */
  crossed: boolean;
  /** Turns the comet has travelled, and whether it is flying. */
  spin: number;
  flying: boolean;
  spinMs: number;
  drawMs: number;
  /** Idle preview: the settings, shown in the empty circle. */
  preview: { target: number; pace: Pace } | null;
  /** The round is over (no pulses). */
  over: boolean;
}

export function Rim({ chords, regions: rs, first, home, drawing, crossed, spin, flying, spinMs, drawMs, preview, over }: RimProps) {
  const mid = home !== null;
  const shown = labels(rs, mid ? home : null, first);
  const hit = drawing && crossed ? chords.filter((c) => separates(c, drawing.a, drawing.b)) : [];
  const desc = mid
    ? `Second end is safe on the green arcs, ${pct(rs[home].length, 1)} of the rim`
    : `${chords.length} chords, ${rs.length} regions`;

  return (
    <svg viewBox="0 0 400 400" className="ch-rim" role="img" aria-label={desc}>
      <circle cx={C} cy={C} r={R} className="disc" />

      {/* Regions: each face filled in its colour (green when it is the safe one). */}
      {rs.map((r, i) => (
        <path
          key={`f${r.slot}`}
          d={facePath(r)}
          className={'face' + (mid ? (i === home ? ' safe' : ' dim') : '')}
          style={{ '--c': regionColour(r.tone) } as CSSProperties}
        />
      ))}

      {/* The rim, coloured by region: a chord is clear when both ends land on one colour. */}
      {rs.map((r, i) =>
        r.arcs.map((a, j) => (
          <path
            key={`a${r.slot}-${j}`}
            d={arcPath(a)}
            className={'rim-arc' + (mid ? (i === home ? ' safe' : ' risk') : '')}
            style={{ '--c': regionColour(r.tone) } as CSSProperties}
          />
        )),
      )}
      {mid && rs[home].arcs.map((a, j) => <path key={`g${j}`} d={arcPath(a, R - 20)} className="safe-guide" />)}

      {chords.map((c, i) => {
        const p = polar(c.a);
        const q = polar(c.b);
        return (
          <line
            key={`c${i}`}
            x1={p.x}
            y1={p.y}
            x2={q.x}
            y2={q.y}
            className={'chord' + (hit.includes(c) ? ' hit' : '') + (i === chords.length - 1 && !drawing && !mid && !over ? ' newest' : '')}
            style={hit.includes(c) ? { animationDelay: `${drawMs}ms` } : undefined}
          />
        );
      })}

      {drawing && (
        <line
          key={`d${drawing.a}-${drawing.b}`}
          x1={polar(drawing.a).x}
          y1={polar(drawing.a).y}
          x2={polar(drawing.b).x}
          y2={polar(drawing.b).y}
          className={'chord drawing' + (crossed ? ' bad' : '')}
          style={{ '--len': chordLength(drawing).toFixed(1), animationDuration: `${drawMs}ms` } as CSSProperties}
        />
      )}

      {chords.flatMap((c, i) => [c.a, c.b].map((p, k) => <circle key={`e${i}-${k}`} {...polarAttrs(p)} r={4.5} className="end" />))}
      {drawing && <circle {...polarAttrs(drawing.b)} r={7} className={'end second' + (crossed ? ' bad' : ' ok')} />}
      {first !== null && (
        <>
          {!over && <circle {...polarAttrs(first)} r={13} className="first-ring" />}
          <circle {...polarAttrs(first)} r={7} className="end first" />
        </>
      )}

      {hit.map((c, i) => {
        const p = crossing(c, drawing!);
        return <circle key={`x${i}`} cx={p.x} cy={p.y} r={10} className="cross-mark" style={{ animationDelay: `${drawMs}ms` }} />;
      })}

      {shown.map(({ at, r, i }) => {
        // Further out at the sides, where the text is wide.
        const p = polar(at, R + 22 + 9 * Math.abs(Math.sin(at * 2 * Math.PI)));
        return (
          <text key={`l${r.slot}`} x={p.x} y={p.y} className={'share' + (mid && i === home ? ' safe' : '')} style={{ '--c': regionColour(r.tone) } as CSSProperties}>
            {pct(r.length)}
          </text>
        );
      })}

      {preview !== null && (
        <g className="preview">
          <text x={C} y={C - 26} className="big">
            {preview.target}
          </text>
          <text x={C} y={C + 24} className="small">
            chords to draw
          </text>
          <text x={C} y={C + 46} className="small">
            none may cross
          </text>
          <text x={C} y={C + 76} className="small pace">
            {preview.pace === 'end' ? 'pauses after every end' : 'pauses after every chord'}
          </text>
        </g>
      )}

      {/* The comet sweeps round the rim to where the next end lands. */}
      <g className={'comet' + (flying ? ' on' : '')} style={{ transform: `rotate(${spin * 360}deg)`, transitionDuration: `${spinMs}ms` }}>
        <circle cx={C} cy={C - R} r={8} />
      </g>
    </svg>
  );
}

const polarAttrs = (p: number) => {
  const { x, y } = polar(p);
  return { cx: x, cy: y };
};

// ---------- The pairs square ----------

const X0 = 18;
const Y0 = 4;
const Z = 200;
const sx = (u: number) => X0 + u * Z;
const sy = (v: number) => Y0 + (1 - v) * Z;

export interface OddsProps {
  regions: Region[];
  /** Mid-chord: the first end's region index and its unrolled position. */
  home: number | null;
  u: number | null;
  /** The chord's dot once the second end has landed. */
  dot: { u: number; v: number; ok: boolean } | null;
  /** Big number above the square, and its label. */
  title: string;
  value: string;
  tone: 'chance' | 'safe' | 'idle';
}

export function Odds({ regions: rs, home, u, dot, title, value, tone }: OddsProps) {
  const starts = blockStarts(rs);
  const mid = home !== null;
  return (
    <div className="ch-odds">
      <div className={`ch-odds-head ${tone}`}>
        <span>{title}</span>
        <b>{value}</b>
      </div>
      <svg viewBox="-12 0 234 230" className="ch-square" role="img" aria-label={`${title}: ${value}`}>
        {/* Every pair of ends is a point; red is the pairs that cross. */}
        <rect x={X0} y={Y0} width={Z} height={Z} className="sq-bg" />
        {mid && (
          <rect x={sx(starts[home])} y={Y0} width={rs[home].length * Z} height={Z} className="sq-column" />
        )}
        {rs.map((r, i) => (
          <rect
            key={r.slot}
            x={sx(starts[i])}
            y={sy(starts[i] + r.length)}
            width={r.length * Z}
            height={r.length * Z}
            className={'sq-block' + (mid ? (i === home ? ' safe' : ' dim') : '')}
            style={{ '--c': regionColour(r.tone) } as CSSProperties}
          />
        ))}
        {/* The unrolled rim along both axes: first end across, second end up. */}
        {rs.map((r, i) => (
          <g key={`ax${r.slot}`} style={{ '--c': regionColour(r.tone) } as CSSProperties} className={'sq-axis' + (mid && i !== home ? ' dim' : '')}>
            <rect x={sx(starts[i])} y={Y0 + Z + 4} width={Math.max(0.5, r.length * Z - 1)} height={6} />
            <rect x={X0 - 10} y={sy(starts[i] + r.length) + 0.5} width={6} height={Math.max(0.5, r.length * Z - 1)} />
          </g>
        ))}
        {u !== null && (
          <>
            <line x1={sx(u)} x2={sx(u)} y1={Y0} y2={Y0 + Z} className="sq-line" />
            <path d={`M ${sx(u)} ${Y0 + Z + 3} l -5 9 h 10 z`} className="sq-pointer" />
          </>
        )}
        {dot && <circle cx={sx(dot.u)} cy={sy(dot.v)} r={6} className={'sq-dot' + (dot.ok ? ' ok' : ' bad')} />}
        <text x={X0 + Z / 2} y={Y0 + Z + 22} className="sq-label">
          first end →
        </text>
        <text x={X0 - 22} y={Y0 + Z / 2} className="sq-label" transform={`rotate(-90 ${X0 - 22} ${Y0 + Z / 2})`}>
          second end →
        </text>
      </svg>
      <div className="ch-legend">
        <span>
          <i className={'sw ' + (mid ? 'safe' : 'clear')} /> {mid ? 'safe: green part of the column' : 'clear: both ends in one region'}
        </span>
        <span>
          <i className="sw cross" /> crossing
        </span>
      </div>
    </div>
  );
}

// ---------- The chord ladder ----------

export interface LadderItem {
  state: 'done' | 'now' | 'todo' | 'bust';
  label: string;
}

/** One pip per chord with the chance it had (or has, or typically will have) to land clear. */
export function Ladder({ items, head }: { items: LadderItem[]; head: { left: string; right: string } }) {
  return (
    <div className="ch-ladder">
      <div className="ch-ladder-head">
        <span>{head.left}</span>
        <b>{head.right}</b>
      </div>
      <ol>
        {items.map((it, i) => (
          <li key={i} className={it.state}>
            <i>{i + 1}</i>
            <span>{it.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
