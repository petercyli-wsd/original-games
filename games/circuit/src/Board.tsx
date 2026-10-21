import type { Round } from './round';
import { S, T, analysis, deadCut, liveDistances, livePath, matters, usefulWires, type Topology } from './math';

type Wire = 'unknown' | 'live' | 'dead';

interface BoardProps {
  topo: Topology;
  /** The round being shown, or null for a fresh board. */
  round: Round | null;
  /** The wire that will be revealed next, highlighted at checkpoints. */
  next: number | null;
  /** How long a reveal takes, for the probe animation. */
  probeMs: number;
}

const bit = (mask: number, e: number) => ((mask >> e) & 1) === 1;

export default function Board({ topo: t, round, next, probeMs }: BoardProps) {
  const live = round?.live ?? 0;
  const dead = round?.dead ?? 0;
  const outcome = round?.outcome ?? null;
  const a = analysis(t, live, dead);
  const useful = usefulWires(t, dead);
  const dist = liveDistances(t, live);
  const winPath = outcome === 'won' ? livePath(t, live) : 0;
  const cut = outcome === 'lost' ? deadCut(t, dead) : 0;

  const wires = t.edges.map(([from, to], e) => {
    const state: Wire = bit(live, e) ? 'live' : bit(dead, e) ? 'dead' : 'unknown';
    // Greyed out: an unrevealed wire whose result can no longer change the odds,
    // or a live wire that no longer lies on any route to T.
    const faded = !!round && ((state === 'unknown' && !matters(a, e)) || (state === 'live' && !bit(useful, e)));
    // Current flows away from S, so draw each live wire from its nearer end.
    const flip = dist[to] >= 0 && (dist[from] < 0 || dist[to] < dist[from]);
    const [p, q] = flip ? [t.nodes[to], t.nodes[from]] : [t.nodes[from], t.nodes[to]];
    return { e, state, faded, p, q, powered: state === 'live' && dist[from] >= 0 };
  });

  const nodeFaded = t.nodes.map(
    (_, n) => !!round && n !== S && n !== T && !wires.some((w) => !w.faded && w.state !== 'dead' && t.edges[w.e].includes(n)),
  );

  return (
    <svg className={'board' + (outcome ? ' ' + outcome : '')} viewBox="0 0 640 360" role="img" aria-label={`${t.name} network`}>
      <defs>
        <pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="10" cy="10" r="1" className="grid-dot" />
        </pattern>
      </defs>
      <rect x="-40" y="-40" width="720" height="440" fill="url(#dots)" />

      {wires.map(({ e, state, faded, p, q, powered }) => {
        const cls = [
          'wire',
          state,
          faded && 'faded',
          powered && 'powered',
          round?.probing === e && 'probing',
          next === e && 'next',
          bit(winPath, e) && 'path',
          bit(cut, e) && 'cut',
          round?.last === e && 'fresh',
        ]
          .filter(Boolean)
          .join(' ');
        const [x1, y1] = p;
        const [x2, y2] = q;
        if (state === 'dead') {
          // A snapped wire: two stubs with a gap where it broke, and a spark if it just went.
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          const lerp = (f: number): [number, number] => [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f];
          const [ax, ay] = lerp(0.4);
          const [bx, by] = lerp(0.6);
          return (
            <g key={e} className={cls}>
              <line x1={x1} y1={y1} x2={ax} y2={ay} />
              <line x1={bx} y1={by} x2={x2} y2={y2} />
              {round?.last === e && (
                <g className="spark" key={round.trail.length} transform={`translate(${mx} ${my})`}>
                  <circle r="10" />
                  {[0, 60, 120, 180, 240, 300].map((deg) => (
                    <g key={deg} transform={`rotate(${deg + 15})`}>
                      <line x1="6" y1="0" x2="18" y2="0" />
                    </g>
                  ))}
                </g>
              )}
            </g>
          );
        }
        return (
          <g key={e} className={cls} style={{ ['--probe-ms' as string]: `${probeMs}ms` }}>
            <line className="base" x1={x1} y1={y1} x2={x2} y2={y2} />
            {state === 'live' && <line className="flow" x1={x1} y1={y1} x2={x2} y2={y2} />}
          </g>
        );
      })}

      {t.nodes.map(([x, y], n) => {
        const terminal = n === S || n === T;
        const cls = [
          'node',
          terminal && 'terminal',
          dist[n] >= 0 && 'powered',
          n === T && outcome === 'won' && 'lit',
          nodeFaded[n] && 'faded',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <g key={n} className={cls} transform={`translate(${x} ${y})`}>
            <circle r={terminal ? 19 : 7} />
            {terminal && (
              <text dy="0.36em" textAnchor="middle">
                {n === S ? 'S' : 'T'}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Small static diagram of a topology, for the picker. */
export function TopologyGlyph({ topo: t }: { topo: Topology }) {
  return (
    <svg className="glyph" viewBox="20 10 600 340" aria-hidden="true">
      {t.edges.map(([a, b], e) => (
        <line key={e} x1={t.nodes[a][0]} y1={t.nodes[a][1]} x2={t.nodes[b][0]} y2={t.nodes[b][1]} />
      ))}
      {t.nodes.map(([x, y], n) => (
        <circle key={n} cx={x} cy={y} r={n === S || n === T ? 26 : 15} className={n === S || n === T ? 'terminal' : ''} />
      ))}
    </svg>
  );
}
