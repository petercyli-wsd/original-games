import { useMemo } from 'react';
import { LEVELS, TAU, arcEnds, geodesic, haloArc, levelApex, levelCurve, polar, prize, type Pt } from './math';

// Board geometry, in SVG units.
const C = 200;
const R = 166;
/** The halo's radius around the particle. */
const HR = 24;

/** Disc coordinates (y up) to SVG coordinates (y down). */
const S = (p: Pt) => ({ x: C + R * p.x, y: C - R * p.y });
const f = (n: number) => n.toFixed(1);
const line = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${f(S(p).x)} ${f(S(p).y)}`).join('');

/** Points along a circle around a disc point (math angles, counter-clockwise), in SVG units. */
function ring(centre: Pt, r: number, from: number, length: number, n = 48) {
  const c = S(centre);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = from + (length * i) / n;
    return `${i ? 'L' : 'M'}${f(c.x + r * Math.cos(t))} ${f(c.y - r * Math.sin(t))}`;
  }).join('');
}

/** Rim points from angle a counter-clockwise by length. */
const rimArc = (a: number, length: number, n = 64) => Array.from({ length: n + 1 }, (_, i) => polar(a + (length * i) / n));

/** Contour levels to draw: the most useful first, skipping any that would crowd a label already placed. */
function pickLevels(arc: number) {
  const order = [0.5, 0.1, 0.9, 0.25, 0.75, 0.05, 0.95, 0.02, 0.98, 0.01];
  const kept: { c: number; y: number }[] = [];
  for (const c of order) {
    if (!LEVELS.includes(c as (typeof LEVELS)[number])) continue;
    const y = levelApex(arc, c);
    if (Math.abs(y) > 0.94) continue;
    if (kept.some((k) => Math.abs(k.y - y) * R < 17)) continue;
    kept.push({ c, y });
  }
  return kept.map(({ c, y }) => {
    const pts = levelCurve(arc, c, LEVEL_N);
    return { c, y, d: line(pts), spots: LABEL_SPOTS.map((i) => S(pts[i])) };
  });
}

const LEVEL_N = 64;
/** Where a contour's label may sit: its apex first, then further along either side. */
const LABEL_SPOTS = [32, 22, 42, 14, 50];

export interface BoardProps {
  arc: number;
  radii: number[];
  /** Rings reached so far. */
  reached: number;
  /** The ring being walked to, or offered next. */
  target: number | null;
  /** Where the particle is drawn. */
  pos: Pt;
  /** Where the halo is drawn: the particle, or the point it was released from. */
  anchor: Pt;
  /** Its chance to win from there. */
  chance: number;
  /** Legs already walked, and the stretch being drawn right now. */
  legs: Pt[][];
  current: Pt[] | null;
  showHalo: boolean;
  /** Whether to print the chance next to the halo. */
  showLabel: boolean;
  /** Direction of the release pointer (radians), while it spins. */
  pointer: number | null;
  exit: Pt | null;
  outcome: 'win' | 'lose' | 'cashed' | null;
  live: boolean;
}

export default function Board({ arc, radii, reached, target, pos, anchor, chance, legs, current, showHalo, showLabel, pointer, exit, outcome, live }: BoardProps) {
  const levels = useMemo(() => pickLevels(arc), [arc]);
  const { a } = arcEnds(arc);
  const len = (arc * Math.PI) / 180;
  const gPath = line(rimArc(a, len));
  const restPath = line(rimArc(a + len, TAU - len));

  // The green fan: every geodesic from the particle that ends on G. Its opening angle at the particle is the halo's green part.
  const halo = showHalo ? haloArc(anchor, arc) : { start: 0, length: 0 };
  const fan = showHalo
    ? line([...geodesic(anchor, halo.start, 56), ...rimArc(a, len, 48), ...geodesic(anchor, halo.start + halo.length, 56).reverse()]) + 'Z'
    : '';

  const p = S(pos);
  const h0 = S(anchor);
  // Put the percentage on the side of the halo facing the centre.
  const r0 = Math.hypot(anchor.x, anchor.y);
  const lx = r0 < 0.08 ? 0 : -anchor.x / r0;
  const ly = r0 < 0.08 ? -1 : -anchor.y / r0;
  const label = { x: h0.x + (HR + 22) * lx, y: h0.y - (HR + 22) * ly + 5 };
  const inGreen = pointer !== null && ((pointer - halo.start) % TAU + TAU) % TAU < halo.length;
  const top = S({ x: 0, y: 1 });

  return (
    <svg
      viewBox="0 0 400 400"
      className={'halo-board' + (outcome ? ` ${outcome}` : '')}
      role="img"
      aria-label={`Green arc ${arc} degrees. Chance to leave through it from here: ${(chance * 100).toFixed(1)}%`}
    >
      <defs>
        <radialGradient id="halo-disc" cx="50%" cy="50%" r="50%">
          <stop offset="0%" style={{ stopColor: 'var(--accent)', stopOpacity: 0.1 }} />
          <stop offset="100%" style={{ stopColor: 'var(--accent)', stopOpacity: 0.02 }} />
        </radialGradient>
      </defs>

      <circle cx={C} cy={C} r={R} className="disc" fill="url(#halo-disc)" />

      {/* Iso-odds arcs: every point on one has the same chance. They all pass through G's ends. */}
      <g className="levels">
        {levels.map((l) => (
          <path key={l.c} d={l.d} />
        ))}
      </g>

      {/* Checkpoint rings. */}
      <g className="rings">
        {radii.map((rho, i) => (
          <circle
            key={i}
            cx={C}
            cy={C}
            r={R * rho}
            className={i < reached ? 'done' : i === target ? 'next' : undefined}
          />
        ))}
      </g>

      {showHalo && <path d={fan} className="fan" />}

      {/* The rim: green arc wins, the rest loses. */}
      <path d={restPath} className="rim-lose" />
      <path d={gPath} className="rim-win" />
      <text x={top.x} y={top.y - 16} className="arc-label">
        WIN {prize(arc).toFixed(2)}×
      </text>

      <g className="level-labels">
        {levels.map((l) => {
          // A label slides along its arc, out from under the particle, its halo and its percentage.
          const spot = l.spots.find(
            (q) =>
              Math.hypot(p.x - q.x, p.y - q.y) > HR + 16 &&
              (!showHalo || Math.hypot(h0.x - q.x, h0.y - q.y) > HR + 16) &&
              (!showHalo || !showLabel || Math.hypot(label.x - q.x, label.y - 5 - q.y) > 26),
          );
          return (
            spot && (
              <text key={l.c} x={spot.x} y={spot.y + 4}>
                {Math.round(l.c * 100)}%
              </text>
            )
          );
        })}
      </g>

      {/* The path so far. */}
      <g className="trail">
        {legs.map((path, i) => (
          <path key={i} d={line(path)} className="old" />
        ))}
        {current && current.length > 1 && <path d={line(current)} className="now" />}
      </g>
      {legs.map((path, i) => {
        const q = S(path[path.length - 1]);
        return <circle key={i} cx={q.x} cy={q.y} r={3.5} className="stop" />;
      })}

      {exit && <circle cx={S(exit).x} cy={S(exit).y} r={11} className={'exit ' + (outcome ?? '')} />}

      {showHalo && (
        <g className="halo">
          <circle cx={h0.x} cy={h0.y} r={HR} className="halo-back" />
          <path d={ring(anchor, HR, halo.start + halo.length, TAU - halo.length)} className="halo-lose" />
          {halo.length > 1e-4 && <path d={ring(anchor, HR, halo.start, halo.length)} className="halo-win" />}
        </g>
      )}

      {pointer !== null && (
        <g className={'pointer ' + (inGreen ? 'in' : 'out')}>
          <line x1={h0.x} y1={h0.y} x2={h0.x + (HR + 9) * Math.cos(pointer)} y2={h0.y - (HR + 9) * Math.sin(pointer)} />
          <circle cx={h0.x + (HR + 9) * Math.cos(pointer)} cy={h0.y - (HR + 9) * Math.sin(pointer)} r={4} />
        </g>
      )}

      <circle cx={p.x} cy={p.y} r={6} className={'particle' + (live ? ' live' : '')} />

      {showHalo && showLabel && (
        <text x={label.x} y={label.y} className="chance-label">
          {chance >= 0.9995 ? '>99.9' : chance < 0.001 ? '<0.1' : (chance * 100).toFixed(1)}%
        </text>
      )}
    </svg>
  );
}
