import type { CSSProperties, KeyboardEvent } from 'react';
import { closers, discSectors, graph, type Colouring, type EdgeOdds } from './math';

/** Edge colours, by index. Red is kept for risk, gold for cash, the accent for the dots. */
export const PALETTE = [
  { name: 'cyan', hex: '#00bbf9' },
  { name: 'yellow', hex: '#fee440' },
  { name: 'violet', hex: '#9b5de5' },
] as const;

const W = 400;
const CX = 200;
const CY = 196;
const R = 158;

interface Pt {
  x: number;
  y: number;
}

interface Layout {
  dots: Pt[];
  /** Where each edge's risk disc sits: on the edge, clear of the other discs and lines. */
  discs: Pt[];
}

const layouts = new Map<number, Layout>();

const segDist = (p: Pt, a: Pt, b: Pt) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

function layout(n: number): Layout {
  const hit = layouts.get(n);
  if (hit) return hit;
  const off = n % 2 === 0 ? Math.PI / n : 0; // flat top for even boards
  const dots = Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n + off;
    return { x: CX + R * Math.sin(a), y: CY - R * Math.cos(a) };
  });
  const { edges } = graph(n);
  const len = (k: number) => Math.hypot(dots[edges[k][0]].x - dots[edges[k][1]].x, dots[edges[k][0]].y - dots[edges[k][1]].y);
  // Long edges first: they all pass the crowded centre.
  const order = edges.map((_, k) => k).sort((a, b) => len(b) - len(a) || a - b);
  const discs: Pt[] = Array(edges.length);
  const placed: Pt[] = [];
  for (const k of order) {
    const [u, v] = edges[k];
    let best = dots[u];
    let bestScore = -Infinity;
    for (let t = 0.26; t <= 0.745; t += 0.02) {
      const p = { x: dots[u].x + (dots[v].x - dots[u].x) * t, y: dots[u].y + (dots[v].y - dots[u].y) * t };
      let near = Infinity;
      for (const q of [...placed, ...dots]) near = Math.min(near, Math.hypot(p.x - q.x, p.y - q.y));
      let line = Infinity;
      edges.forEach(([a, b], j) => {
        if (j !== k) line = Math.min(line, segDist(p, dots[a], dots[b]));
      });
      const score = Math.min(near / 2.4, line, 16) - Math.abs(t - 0.5) * 4;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    discs[k] = best;
    placed.push(best);
  }
  const out = { dots, discs };
  layouts.set(n, out);
  return out;
}

const polar = (turn: number, r: number) => ({ x: r * Math.sin(turn * 2 * Math.PI), y: -r * Math.cos(turn * 2 * Math.PI) });

function sectorPath(start: number, end: number, r: number) {
  const a = polar(start, r);
  const b = polar(end, r);
  return `M0 0 L${a.x.toFixed(2)} ${a.y.toFixed(2)} A${r} ${r} 0 ${end - start > 0.5 ? 1 : 0} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}Z`;
}

/** A disc cut into one slice per colour; fatal slices are red. Its red share is the edge's risk. */
function DiscGlyph({ colours, mask, r, locked }: { colours: number; mask: number; r: number; locked?: boolean }) {
  if (locked) return <circle r={r} className="slice fatal" />;
  return (
    <>
      {discSectors(colours, mask).map((s) => (
        <path
          key={s.colour}
          d={sectorPath(s.start, s.end, r)}
          className={'slice' + (s.fatal ? ' fatal' : '')}
          style={s.fatal ? undefined : { fill: PALETTE[s.colour].hex }}
        />
      ))}
    </>
  );
}

export interface Spin {
  id: number;
  edge: number;
  /** Turns the needle travels, ending inside the drawn colour's slice. */
  turn: number;
}

export interface BoardProps {
  n: number;
  colours: number;
  col: Colouring;
  odds: EdgeOdds[];
  /** Whether open edges can be picked right now. */
  interactive: boolean;
  /** The edge being inspected (hover or the spinning pick). */
  focus: number | null;
  onHover(edge: number | null): void;
  onPick(edge: number): void;
  spin: Spin | null;
  spinMs: number;
  drawMs: number;
  /** The edge coloured last (drawn in). */
  fresh: number | null;
  /** The triangles that closed, if the round busted. */
  bust: [number, number, number][] | null;
  /** Whether the round is over (locks are then shown as the end state). */
  over: boolean;
}

export default function Board({ n, colours, col, odds, interactive, focus, onHover, onPick, spin, spinMs, drawMs, fresh, bust, over }: BoardProps) {
  const g = graph(n);
  const { dots, discs } = layout(n);
  const r = n >= 8 ? 9 : 11;
  const pts = (tri: number[]) => tri.map((i) => `${dots[i].x.toFixed(1)},${dots[i].y.toFixed(1)}`).join(' ');

  // Danger preview for the focused open edge: the triangles each fatal colour would close.
  const danger: { colour: number; w: number }[] = [];
  const witnesses = new Set<number>();
  if (focus !== null && col[focus] < 0 && !bust) {
    for (let k = 0; k < colours; k++) {
      if (!((odds[focus].mask >> k) & 1)) continue;
      for (const w of closers(g, col, focus, k)) {
        danger.push({ colour: k, w });
        const [u, v] = g.edges[focus];
        witnesses.add(g.id[u][w]).add(g.id[v][w]);
      }
    }
  }
  const bustDots = new Set(bust?.flat() ?? []);

  const keyPick = (e: KeyboardEvent, edge: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onPick(edge);
    }
  };

  return (
    <svg
      viewBox={`0 0 ${W} 432`}
      className="ramsey"
      role="img"
      aria-label={`Complete graph on ${n} dots, ${col.filter((x) => x >= 0).length} of ${g.edges.length} edges coloured`}
      style={{ '--draw-ms': `${drawMs}ms`, '--spin-ms': `${spinMs}ms` } as CSSProperties}
    >
      <circle cx={CX} cy={CY} r={R + 22} className="frame" />

      {danger.map(({ colour, w }) => {
        const [u, v] = g.edges[focus!];
        return <polygon key={`d${colour}-${w}`} points={pts([u, v, w])} className="danger" style={{ fill: PALETTE[colour].hex }} />;
      })}
      {bust?.map((tri) => <polygon key={`b${tri.join('-')}`} points={pts(tri)} className="bust-tri" />)}

      {/* Open edges: faint dashes; locked ones red. */}
      {g.edges.map(([u, v], k) => {
        if (col[k] >= 0) return null;
        const o = odds[k];
        const cls = 'edge open' + (o.state === 'locked' ? ' locked' : '') + (o.state === 'capped' ? ' capped' : '') + (focus === k ? ' focus' : '');
        return <line key={`o${k}`} x1={dots[u].x} y1={dots[u].y} x2={dots[v].x} y2={dots[v].y} className={cls} />;
      })}

      {/* Coloured edges. */}
      {g.edges.map(([u, v], k) => {
        if (col[k] < 0) return null;
        const cls = 'edge col' + (k === fresh ? ' fresh' : '') + (witnesses.has(k) ? ' witness' : '');
        return (
          <line
            key={`c${k}-${col[k]}`}
            x1={dots[u].x}
            y1={dots[u].y}
            x2={dots[v].x}
            y2={dots[v].y}
            pathLength={1}
            className={cls}
            style={{ stroke: PALETTE[col[k]].hex, color: PALETTE[col[k]].hex }}
          />
        );
      })}

      {dots.map((p, i) => (
        <circle key={`v${i}`} cx={p.x} cy={p.y} r={8} className={'dot' + (bustDots.has(i) ? ' busted' : '')} />
      ))}

      {/* Hit areas along open edges (under the discs). */}
      {interactive &&
        g.edges.map(([u, v], k) => {
          const o = odds[k];
          if (col[k] >= 0 || (o.state !== 'free' && o.state !== 'risky')) return null;
          return (
            <line
              key={`h${k}`}
              x1={dots[u].x}
              y1={dots[u].y}
              x2={dots[v].x}
              y2={dots[v].y}
              className="hit"
              onPointerEnter={() => onHover(k)}
              onPointerLeave={() => onHover(null)}
              onClick={() => onPick(k)}
            />
          );
        })}

      {/* Risk discs on every open edge. */}
      {g.edges.map((_, k) => {
        if (col[k] >= 0 && spin?.edge !== k) return null;
        const o = odds[k];
        const p = discs[k];
        const spinning = spin?.edge === k;
        const pickable = interactive && (o.state === 'free' || o.state === 'risky');
        const state = spinning ? 'spinning' : o.state;
        const label =
          o.state === 'locked'
            ? 'locked: every colour closes a triangle'
            : o.state === 'capped'
              ? 'capped: would pass the max win'
              : o.q === 0
                ? 'free edge'
                : `${Math.round((1 - o.q) * 100)}% safe`;
        return (
          <g
            key={`k${k}`}
            className={`disc ${state}` + (focus === k ? ' focus' : '') + (over && o.state === 'locked' ? ' end' : '')}
            transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`}
            role={pickable ? 'button' : undefined}
            tabIndex={pickable ? 0 : undefined}
            aria-label={pickable ? `Edge ${g.edges[k][0] + 1}–${g.edges[k][1] + 1}, ${label}` : undefined}
            onPointerEnter={pickable ? () => onHover(k) : undefined}
            onPointerLeave={pickable ? () => onHover(null) : undefined}
            onFocus={pickable ? () => onHover(k) : undefined}
            onBlur={pickable ? () => onHover(null) : undefined}
            onClick={pickable ? () => onPick(k) : undefined}
            onKeyDown={pickable ? (e) => keyPick(e, k) : undefined}
          >
            <g className="disc-body">
              <circle r={r + 7} className="disc-hit" />
              <circle r={r + 2.5} className="disc-ring" />
              <DiscGlyph colours={colours} mask={o.mask} r={r} locked={o.state === 'locked'} />
              {spinning && (
                <g key={spin.id} className="needle" style={{ '--end': `${spin.turn * 360}deg` } as CSSProperties}>
                  <line x1={0} y1={0} x2={0} y2={-r - 5} />
                  <circle r={2.6} />
                </g>
              )}
            </g>
          </g>
        );
      })}

      {/* Legend: what the discs mean. */}
      <g className="legend" transform="translate(0 414)">
        <g transform="translate(58 0)">
          <DiscGlyph colours={colours} mask={0} r={7} />
          <text x={13} y={4.5}>
            free
          </text>
        </g>
        <g transform="translate(132 0)">
          <DiscGlyph colours={colours} mask={1} r={7} />
          <text x={13} y={4.5}>
            red share = chance to lose
          </text>
        </g>
        <g transform="translate(316 0)">
          <DiscGlyph colours={colours} mask={0} r={7} locked />
          <text x={13} y={4.5}>
            locked
          </text>
        </g>
      </g>
    </svg>
  );
}
