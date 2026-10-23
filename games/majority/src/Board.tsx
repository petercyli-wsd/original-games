import type { CSSProperties } from 'react';
import { TOTAL, hexCentre, tally, winsAt, type Bet, type Call, type MapDef } from './math';

const W = 520;
const R = 36;
const MAP_CY = 122;
const X0 = 22;
const X1 = W - 22;
const K = (X1 - X0) / TOTAL;
const BAR_Y = 274;
const BAR_H = 16;
const BASE = 424;
const STRIP_H = 96;

const f = (v: number) => v.toFixed(2);
const X = (v: number) => X0 + v * K;
const pct = (p: number) => (p >= 0.9995 ? '100%' : p <= 0 ? '0%' : p < 0.001 ? '<0.1%' : p < 0.1 ? `${(p * 100).toFixed(1)}%` : `${(p * 100).toFixed(1)}%`);

function hexPoints(cx: number, cy: number, r: number) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i - 90) * Math.PI) / 180;
    return `${f(cx + r * Math.cos(a))},${f(cy + r * Math.sin(a))}`;
  }).join(' ');
}

export type Outcome = 'won' | 'lost' | 'cashed';

export interface BoardProps {
  map: MapDef;
  calls: readonly Call[];
  bet: Bet;
  /** Distribution of Blue's final total. */
  dist: Float64Array;
  /** Your chance now. */
  win: number;
  /** The region called next (spotlit at a checkpoint). */
  next: number | null;
  /** The region being called right now (animating). */
  calling: number | null;
  callMs: number;
  outcome: Outcome | null;
}

export default function Board({ map, calls, bet, dist, win, next, calling, callMs, outcome }: BoardProps) {
  const t = tally(map, calls);
  const cs = map.regions.map((r) => hexCentre(r.col, r.row, R));
  const minX = Math.min(...cs.map((c) => c.x));
  const maxX = Math.max(...cs.map((c) => c.x));
  const minY = Math.min(...cs.map((c) => c.y));
  const maxY = Math.max(...cs.map((c) => c.y));
  const dx = W / 2 - (minX + maxX) / 2;
  const dy = MAP_CY - (minY + maxY) / 2;

  // Your winning totals: Blue ≥ L, or Blue ≤ 100 − L for Red.
  const lineAt = bet.side === 'blue' ? X(bet.line - 0.5) : X(TOTAL - bet.line + 0.5);
  const zoneX0 = bet.side === 'blue' ? lineAt : X0 - 4;
  const zoneX1 = bet.side === 'blue' ? X1 + 4 : lineAt;
  const dmax = Math.max(...dist);
  const barW = Math.max(2, K * 0.78);
  const yourColour = bet.side === 'blue' ? 'blue' : 'red';
  const sideName = bet.side === 'blue' ? 'Blue' : 'Red';
  // Seats your side still needs, against the seats still to call.
  const need = bet.line - (bet.side === 'blue' ? t.blue : t.red);

  return (
    <svg viewBox={`0 0 ${W} 474`} className="mj-svg" role="img" aria-label={`Win chance ${pct(win)}: the green share of the paths to victory`} style={{ '--call': `${callMs}ms` } as CSSProperties}>
      {/* The hex map. Uncalled regions show their Blue chance as the blue share of the hex. */}
      <defs>
        {map.regions.map((r, i) => (
          <clipPath key={r.id} id={`mj-clip-${map.key}-${i}`}>
            <polygon points={hexPoints(cs[i].x + dx, cs[i].y + dy, R - 2.5)} />
          </clipPath>
        ))}
      </defs>
      <g className="map">
        {map.regions.map((r, i) => {
          const x = cs[i].x + dx;
          const y = cs[i].y + dy;
          const c = calls[i];
          const top = y - R;
          const h = 2 * R;
          const cls =
            'hex' + (c === 'B' ? ' called b' : c === 'R' ? ' called r' : ' open') + (i === next ? ' next' : '') + (i === calling ? ' flip' : '');
          return (
            <g key={r.id} className={cls}>
              <title>{`Region ${r.id} · ${r.w} seats · ${Math.round(r.p * 100)}% Blue${c ? ` · called ${c === 'B' ? 'Blue' : 'Red'}` : ''}`}</title>
              <g className="hex-body" style={{ transformOrigin: `${f(x)}px ${f(y)}px` }}>
                {c === null ? (
                  <g clipPath={`url(#mj-clip-${map.key}-${i})`}>
                    <rect x={f(x - R)} y={f(top)} width={f(2 * R)} height={f(h * (1 - r.p))} className="fill-r" />
                    <rect x={f(x - R)} y={f(top + h * (1 - r.p))} width={f(2 * R)} height={f(h * r.p)} className="fill-b" />
                  </g>
                ) : (
                  <polygon points={hexPoints(x, y, R - 2.5)} className="solid" />
                )}
                <polygon points={hexPoints(x, y, R - 2.5)} className="edge" />
                <text x={f(x)} y={f(y - (c ? 13 : 15))} className="id">
                  {r.id}
                </text>
                <text x={f(x)} y={f(y + (c ? 10 : 5))} className="w">
                  {r.w}
                </text>
                {c === null && (
                  <text x={f(x)} y={f(y + 20)} className="p">
                    {Math.round(r.p * 100)}% B
                  </text>
                )}
              </g>
              {i === next && <polygon points={hexPoints(x, y, R + 1)} className="spot" />}
            </g>
          );
        })}
      </g>

      {/* The weight bar: Blue locked from the left, Red from the right, the rest still to call. */}
      <g className="bar">
        <rect x={X0} y={BAR_Y} width={X1 - X0} height={BAR_H} rx={4} className="bar-bg" />
        {t.blue > 0 && <rect x={X0} y={BAR_Y} width={f(t.blue * K)} height={BAR_H} rx={4} className="bar-b" />}
        {t.red > 0 && <rect x={f(X1 - t.red * K)} y={BAR_Y} width={f(t.red * K)} height={BAR_H} rx={4} className="bar-r" />}
        <text x={X0} y={BAR_Y - 7} className="bar-l">
          <tspan className="k">BLUE</tspan> {t.blue}
        </text>
        <text x={W / 2} y={BAR_Y - 7} className="bar-m">
          {need <= 0
            ? `${sideName} reached ${bet.line}`
            : need > t.left
              ? `${sideName} can't reach ${bet.line}`
              : `${sideName} needs ${need} of ${t.left} left`}
        </text>
        <text x={X1} y={BAR_Y - 7} className="bar-r-l">
          {t.red} <tspan className="k">RED</tspan>
        </text>
        <line x1={X(50)} x2={X(50)} y1={BAR_Y - 2} y2={BAR_Y + BAR_H + 2} className="half" />
      </g>

      {/* Paths to victory: the exact distribution of Blue's final total. Green bars are your odds. */}
      <g className="strip">
        <rect x={f(zoneX0)} y={BASE - STRIP_H - 6} width={f(zoneX1 - zoneX0)} height={STRIP_H + 6} className={'zone ' + yourColour} />
        {Array.from(dist, (d, i) => {
          if (!(d > 0)) return null;
          const hgt = Math.max(1.5, (d / dmax) * STRIP_H);
          return (
            <rect
              key={i}
              x={f(X(i) - barW / 2)}
              y={BASE - STRIP_H}
              width={f(barW)}
              height={STRIP_H}
              className={'pbar' + (winsAt(i, bet) ? ' good' : '')}
              style={{ transform: `scaleY(${f(hgt / STRIP_H)})` }}
            />
          );
        })}
        <line x1={X0 - 4} x2={X1 + 4} y1={BASE} y2={BASE} className="axis" />
        <line x1={f(lineAt)} x2={f(lineAt)} y1={BAR_Y - 2} y2={BASE + 4} className={'yourline ' + yourColour} />
        <text x={f(lineAt + (bet.side === 'blue' ? 5 : -5))} y={BASE - STRIP_H - 10} className={'yourline-l ' + (bet.side === 'blue' ? 'start' : 'end')}>
          {bet.side === 'blue' ? `Blue ${bet.line}+ →` : `← Red ${bet.line}+`}
        </text>
        {[0, 50, 100].map((v) => (
          <text key={v} x={f(X(v))} y={BASE + 16} className="tick">
            {v}
          </text>
        ))}
        <text x={W / 2} y={BASE + 40} className="legend">
          {outcome === 'cashed'
            ? `Cashed out at ${pct(win)}: the green share of the paths when you left`
            : outcome && t.left > 0
              ? `Race called: Blue ends on ${t.blue}–${t.blue + t.left} seats, ${outcome === 'won' ? 'inside' : 'outside'} your zone`
              : outcome
                ? `Blue finished on ${t.blue} seats, Red on ${t.red}`
                : `Paths to victory: Blue's final total · green bars = your odds, ${pct(win)}`}
        </text>
      </g>
    </svg>
  );
}
