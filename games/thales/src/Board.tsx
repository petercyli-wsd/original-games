import { useId } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import { SQUARE, TRIANGLE, bandPolygon, wideVertex, zoneOf, angles, type Arena, type Pt, type Side } from './math';

/** Board units per arena unit (the arena spans [−1, 1]²). */
const K = 150;
const sc = (p: Pt) => ({ x: p.x * K, y: p.y * K });
const pts = (ps: readonly Pt[]) => ps.map((p) => `${(p.x * K).toFixed(2)},${(p.y * K).toFixed(2)}`).join(' ');

/** A worked example for the idle preview, inside every arena. */
const EXAMPLE: [Pt, Pt] = [
  { x: -0.45, y: 0.3 },
  { x: 0.35, y: -0.05 },
];

export interface TriRec {
  a: Pt;
  b: Pt;
  c: Pt | null;
  /** Whether it landed on the backed side, once C is down. */
  win: boolean | null;
}

function ArenaShape({ arena, className }: { arena: Arena; className: string }) {
  if (arena === 'disc') return <circle cx={0} cy={0} r={K} className={className} />;
  return <polygon points={pts(arena === 'square' ? SQUARE : TRIANGLE)} className={className} />;
}

export interface ArenaProps {
  arena: Arena;
  side: Side;
  /** The current triangle (A, B and maybe C), or null before the first drop. */
  tri: TriRec | null;
  /** Show the shaded band-minus-disc (A and B are down). */
  zone: boolean;
  /** Which points are falling right now (animation). */
  falling: 'ab' | 'c' | null;
  dropKey: string;
  dropMs: number;
}

export function ArenaBoard({ arena, side, tri, zone, falling, dropKey, dropMs }: ArenaProps) {
  const id = useId().replace(/:/g, '');
  const clip = `th-clip-${id}`;
  const preview = !tri;
  const [a, b] = tri ? [tri.a, tri.b] : EXAMPLE;
  const z = zoneOf(a, b);
  const showZone = (zone || preview) && !!z;
  const acuteWins = side === 'acute';
  const c = tri?.c ?? null;
  const wide = c ? wideVertex(a, b, c) : null;
  const ang = c ? angles(a, b, c) : null;
  const done = tri?.win != null;

  // Unit normal across AB and the perpendicular lines at A and B (long; clipped to the arena).
  const perp = (p: Pt) => {
    if (!z) return null;
    const o = { x: z.n.x * 4, y: z.n.y * 4 };
    const p1 = sc({ x: p.x + o.x, y: p.y + o.y });
    const p2 = sc({ x: p.x - o.x, y: p.y - o.y });
    return <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="th-perp" />;
  };

  const A = sc(a);
  const B = sc(b);
  const C = c ? sc(c) : null;
  const labelOff = (p: Pt, others: Pt[]) => {
    // Push a vertex label away from the other two points.
    const cx = others.reduce((s, q) => s + q.x, 0) / others.length;
    const cy = others.reduce((s, q) => s + q.y, 0) / others.length;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    return { x: p.x * K + (dx / d) * 17, y: p.y * K + (dy / d) * 17 + 5 };
  };
  const la = labelOff(a, c ? [b, c] : [b]);
  const lb = labelOff(b, c ? [a, c] : [a]);
  const lc = c ? labelOff(c, [a, b]) : null;
  const names = ['A', 'B', 'C'];

  return (
    <svg
      viewBox="-168 -168 336 336"
      className={'th-arena' + (preview ? ' preview' : '') + (acuteWins ? ' back-acute' : ' back-obtuse')}
      role="img"
      aria-label={preview ? `Empty ${arena} arena` : `Triangle in a ${arena}`}
      style={{ ['--th-drop' as string]: `${dropMs}ms` }}
    >
      <defs>
        <clipPath id={clip}>
          <ArenaShape arena={arena} className="" />
        </clipPath>
      </defs>

      <ArenaShape arena={arena} className={'th-floor' + (showZone ? ' zoned' : '') + (preview ? ' ghost' : '')} />

      {showZone && z && (
        <g clipPath={`url(#${clip})`} className={'th-zone' + (preview ? ' ghost' : '')} key={preview ? 'ghost' : dropKey}>
          <polygon points={pts(bandPolygon(a, b))} className="th-band" />
          <circle cx={z.mid.x * K} cy={z.mid.y * K} r={z.r * K} className="th-disc" />
          {perp(a)}
          {perp(b)}
          <circle cx={z.mid.x * K} cy={z.mid.y * K} r={z.r * K} className="th-circle" />
        </g>
      )}

      <ArenaShape arena={arena} className="th-rim" />

      {(tri || preview) && <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} className={'th-ab' + (preview ? ' ghost' : '')} />}

      {C && (
        <g className={'th-tri ' + (done ? (tri!.win ? 'won' : 'lost') : '')}>
          <polygon points={pts([a, b, c!])} />
        </g>
      )}

      {/* The wide (≥ 90°) corner, when there is one. */}
      {C && done && wide !== null && ang && (
        <circle cx={[A, B, C][wide].x} cy={[A, B, C][wide].y} r={20} className="th-wide" />
      )}

      {preview ? (
        <>
          <circle cx={A.x} cy={A.y} r={5} className="th-pt ghost" />
          <circle cx={B.x} cy={B.y} r={5} className="th-pt ghost" />
          <text x={0} y={163} className="th-note">
            example: C wins {acuteWins ? 'in the band, outside the circle' : 'off the band or inside the circle'}
          </text>
        </>
      ) : (
        <g key={`pts-${dropKey}`}>
          <circle cx={A.x} cy={A.y} r={7} className={'th-pt' + (falling === 'ab' ? ' falling' : '')} />
          <circle cx={B.x} cy={B.y} r={7} className={'th-pt' + (falling === 'ab' ? ' falling' : '')} />
          <text x={la.x} y={la.y} className={'th-lbl' + (falling === 'ab' ? ' falling' : '')}>
            A
          </text>
          <text x={lb.x} y={lb.y} className={'th-lbl' + (falling === 'ab' ? ' falling' : '')}>
            B
          </text>
          {C && lc && (
            <g key="c">
              <circle cx={C.x} cy={C.y} r={8} className={'th-pt c' + (falling === 'c' ? ' falling' : '') + (done ? (tri!.win ? ' won' : ' lost') : '')} />
              <text x={lc.x} y={lc.y} className={'th-lbl' + (falling === 'c' ? ' falling' : '')}>
                C
              </text>
            </g>
          )}
        </g>
      )}
      {C && done && ang && wide !== null && (
        <text x={0} y={-K - 4} className={'th-angle-note ' + (tri!.win ? 'good' : 'bad')}>
          {names[wide]} = {ang[wide].toFixed(0)}° · obtuse
        </text>
      )}
      {C && done && ang && wide === null && (
        <text x={0} y={-K - 4} className={'th-angle-note ' + (tri!.win ? 'good' : 'bad')}>
          widest angle {Math.max(...ang).toFixed(0)}° · acute
        </text>
      )}
    </svg>
  );
}

export interface ZoneCardProps {
  side: Side;
  /** The exact share of the arena where C wins (or the average before A, B land). */
  share: number;
  /** Band and Thales-disc areas as shares of the arena, once A and B are down. */
  band: number | null;
  disc: number | null;
  average: boolean;
}

/** The odds as a literal area: band − disc = acute share. */
export function ZoneCard({ side, share, band, disc, average }: ZoneCardProps) {
  const acute = band !== null && disc !== null ? band - disc : null;
  return (
    <div className="th-card">
      <div className="th-card-head">
        <b>{fmtChance(share)}</b>
        <span>{average ? `of triangles are ${side} on average` : `of the arena makes it ${side}`}</span>
      </div>
      {acute !== null && band !== null && disc !== null ? (
        <div className="th-sum" aria-label="Area breakdown">
          <span>
            <i className="sw band" /> band {fmtChance(band)}
          </span>
          <span className="op">−</span>
          <span>
            <i className="sw disc" /> circle {fmtChance(disc)}
          </span>
          <span className="op">=</span>
          <span>
            acute <b>{fmtChance(Math.max(0, acute))}</b>
          </span>
        </div>
      ) : (
        <div className="th-sum muted">A and B land first; then the shaded area is your exact chance.</div>
      )}
      <div className="th-legend">
        <span>
          <i className="win" /> C wins here
        </span>
        <span>
          <i className="lose" /> C loses here
        </span>
      </div>
    </div>
  );
}

export function Tally({ tris, count, side }: { tris: TriRec[]; count: number; side: Side }) {
  return (
    <div className="th-tally" aria-label="Triangles">
      {Array.from({ length: count }, (_, i) => {
        const t = tris[i];
        const state = !t ? 'pending' : t.win === null ? 'current' : t.win ? 'won' : 'lost';
        return (
          <span key={i} className={'th-pip ' + state} title={`Triangle ${i + 1}: ${state}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <polygon points="4,19 20,19 9,5" />
            </svg>
            {state === 'won' ? `✓ ${side}` : state === 'lost' ? '✕' : i + 1}
          </span>
        );
      })}
    </div>
  );
}
