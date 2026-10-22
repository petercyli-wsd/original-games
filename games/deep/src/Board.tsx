import type { CSSProperties } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import type { Key, ProfilePoint, Tree } from './math';

// Geometry of the board (viewBox units).
const VW = 520;
const VH = 438;
const X0 = 52;
const X1 = 504;
const W = X1 - X0;
const Y0 = 66; // depth 0
const YB = 300; // bottom of the "too deep" band
const S0 = 326; // top of the odds strip
const YN = 398; // the number line (and the strip's baseline)

const xOf = (v: number) => X0 + v * W;

export interface Falling {
  id: number;
  x: number;
  depth: number;
  bust: boolean;
  /** P(win) after it lands (its arch height). */
  chance: number;
}

export interface BoardProps {
  limit: number;
  keys: number;
  tree: Tree;
  mode: 'idle' | 'live' | 'over';
  outcome: 'bust' | 'cashed' | 'full' | null;
  /** The arches: P(win) if the next key lands at x. Null hides the strip. */
  profile: ProfilePoint[][] | null;
  /** P(win) now: the arches' average. */
  chance: number;
  /** The next key's bust chance (red length). */
  q: number;
  falling: Falling | null;
  fallMs: number;
  /** The key that sank too deep, if the round busted. */
  bustKey: Key | null;
}

export default function Board({ limit, keys, tree, mode, outcome, profile, chance, q, falling, fallMs, bustKey }: BoardProps) {
  const rowH = (YB - Y0) / (limit + 1.5);
  const yOf = (d: number) => Y0 + d * rowH;
  const floorY = Y0 + (limit + 0.5) * rowH;
  const r = Math.max(5, Math.min(8.5, rowH * 0.2));
  const placed = tree.keys.length;
  const newest = mode === 'live' && !falling ? placed - 1 : -1;

  // The odds strip's scale: its top is the tallest arch.
  const top = profile ? Math.max(chance, ...profile.flatMap((a) => a.map((p) => p.p)), 1e-9) : 1;
  const ys = (p: number) => YN - (p / top) * (YN - S0 - 14);
  const nowY = ys(chance);

  const archPath = (arch: ProfilePoint[]) =>
    `M ${xOf(arch[0].x).toFixed(2)} ${YN} ` + arch.map((p) => `L ${xOf(p.x).toFixed(2)} ${ys(p.p).toFixed(2)}`).join(' ') + ` L ${xOf(arch[arch.length - 1].x).toFixed(2)} ${YN} Z`;

  const fallFrom = 34;
  const fallTo = falling ? yOf(falling.bust ? limit + 1 : falling.depth) : 0;
  const pipGap = Math.min(18, 250 / Math.max(1, keys - 1));
  const tone = outcome === 'full' ? ' won' : outcome === 'bust' ? ' lost' : '';

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className={'deep' + tone} role="img" aria-label={`${placed} of ${keys} keys placed, depth limit ${limit}, next key ${fmtChance(q)} red`}>
      <defs>
        <clipPath id="deep-above-now">
          <rect x={X0 - 2} y={S0 - 4} width={W + 4} height={Math.max(0, nowY - S0 + 4)} />
        </clipPath>
        <linearGradient id="deep-abyss" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--red)" stopOpacity="0.2" />
          <stop offset="1" stopColor="var(--red)" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {/* Header: one pip per key to place. */}
      <text x={X0 - 14} y={24} className="lbl end">
        keys
      </text>
      {Array.from({ length: keys }, (_, i) => (
        <circle
          key={i}
          cx={X0 + i * pipGap}
          cy={20}
          r={4.5}
          className={'pip' + (i < placed ? ' on' : '') + (i === placed && mode === 'live' ? ' next' : '')}
        />
      ))}
      <text x={X1} y={24} className="lbl end strong">
        {placed} / {keys}
      </text>

      {/* Depth rows, the limit and the abyss below it. */}
      <rect x={X0 - 6} y={floorY} width={W + 12} height={YB - floorY} className="abyss" fill="url(#deep-abyss)" />
      {Array.from({ length: limit + 1 }, (_, d) => (
        <g key={d}>
          <line x1={X0 - 6} x2={X1 + 6} y1={yOf(d)} y2={yOf(d)} className="row" />
          <text x={X0 - 14} y={yOf(d) + 4.5} className="lbl end">
            {d}
          </text>
        </g>
      ))}
      <text x={X0 - 14} y={Y0 - 20} className="lbl end small">
        depth
      </text>
      <line x1={X0 - 6} x2={X1 + 6} y1={floorY} y2={floorY} className="floor" />
      <text x={X0 - 14} y={floorY + 4} className="lbl end red">
        limit
      </text>
      <text x={X1} y={YB - 8} className="lbl end red small">
        too deep: a key here busts
      </text>

      {/* Guides from each key down to its value on the line. */}
      {tree.keys.map((k, i) => (
        <line key={`g${i}`} x1={xOf(k.x)} x2={xOf(k.x)} y1={yOf(k.depth)} y2={YN} className="guide" />
      ))}

      {/* Ledges: where a key falling at x would come to rest. Red ones are below the limit. */}
      {mode !== 'over' &&
        tree.gaps.map((g, i) => {
          const a = xOf(g.lo) + 2;
          const b = xOf(g.hi) - 2;
          if (b - a < 0.5) return null;
          const red = g.depth > limit;
          return <rect key={`l${i}-${g.lo}`} x={a} y={yOf(g.depth) - 2.5} width={b - a} height={5} rx={2.5} className={'ledge' + (red ? ' red' : '')} />;
        })}

      {/* The tree. */}
      {tree.keys.map((k, i) => {
        if (k.parent < 0) return null;
        const p = tree.keys[k.parent];
        return (
          <line
            key={`e${i}`}
            x1={xOf(p.x)}
            y1={yOf(p.depth)}
            x2={xOf(k.x)}
            y2={yOf(k.depth)}
            className={'edge' + (i === placed - 1 ? ' fresh' : '')}
            pathLength={1}
          />
        );
      })}
      {bustKey && bustKey.parent >= 0 && (
        <line
          x1={xOf(tree.keys[bustKey.parent].x)}
          y1={yOf(tree.keys[bustKey.parent].depth)}
          x2={xOf(bustKey.x)}
          y2={yOf(limit + 1)}
          className="edge busted"
        />
      )}
      {tree.keys.map((k, i) => (
        <circle key={`n${i}`} cx={xOf(k.x)} cy={yOf(k.depth)} r={i === newest ? r + 1.5 : r} className={'node' + (i === newest ? ' newest' : '')} />
      ))}
      {bustKey && <circle cx={xOf(bustKey.x)} cy={yOf(limit + 1)} r={r + 2} className="node busted" />}

      {/* The key in flight: it falls straight down at x until it meets its ledge. */}
      {falling && (
        <g key={falling.id} style={{ '--ms': `${fallMs}ms` } as CSSProperties}>
          <line x1={xOf(falling.x)} x2={xOf(falling.x)} y1={fallFrom} y2={YN} className="beam" />
          <g className="faller" style={{ '--dy': `${fallTo - fallFrom}px` } as CSSProperties}>
            <circle cx={xOf(falling.x)} cy={fallFrom} r={r + 1.5} className={'node falling' + (falling.bust ? ' bad' : '')} />
          </g>
        </g>
      )}

      {/* The odds strip: P(win) after the next key, by where it lands. Its average is P(win) now. */}
      {profile && (
        <g className="strip">
          <text x={X0} y={S0 - 4} className="lbl small">
            {placed === 0 ? 'chance after the first key, by where it lands' : 'chance after the next key, by where it lands'}
          </text>
          <text x={X1} y={S0 - 4} className="lbl small end green">
            green: cash-out rises
          </text>
          {profile.map((arch, i) => (arch.length && tree.gaps[i] && tree.gaps[i].depth <= limit ? <path key={`a${i}`} d={archPath(arch)} className="arch" /> : null))}
          <g clipPath="url(#deep-above-now)">
            {profile.map((arch, i) => (arch.length && tree.gaps[i] && tree.gaps[i].depth <= limit ? <path key={`u${i}`} d={archPath(arch)} className="arch up" /> : null))}
          </g>
          <line x1={X0} x2={X1} y1={nowY} y2={nowY} className="now" />
          <text x={X0 - 6} y={nowY - 3} className="lbl end now-lbl">
            now
          </text>
          <text x={X0 - 6} y={nowY + 11} className="lbl end now-val">
            {fmtChance(chance)}
          </text>
          {falling && (
            <circle cx={xOf(falling.x)} cy={ys(falling.chance)} r={5} className={'landing' + (falling.bust ? ' bad' : falling.chance >= chance ? ' up' : '')} />
          )}
        </g>
      )}

      {/* The number line [0, 1]: red stretches bust the next key. */}
      {tree.gaps.map((g, i) => {
        const a = xOf(g.lo);
        const b = xOf(g.hi);
        if (b - a < 0.3) return null;
        return <rect key={`s${i}-${g.lo}`} x={a} y={YN - 3.5} width={b - a} height={7} className={'seg' + (g.depth > limit ? ' red' : '')} />;
      })}
      {tree.keys.map((k, i) => (
        <line key={`t${i}`} x1={xOf(k.x)} x2={xOf(k.x)} y1={YN - 7} y2={YN + 7} className="tick" />
      ))}
      {falling && <path d={`M ${xOf(falling.x)} ${YN + 6} l -6 10 h 12 z`} className={'pointer' + (falling.bust ? ' bad' : '')} />}
      <text x={X0} y={YN + 24} className="lbl">
        0
      </text>
      <text x={X1} y={YN + 24} className="lbl end">
        1
      </text>
      <text x={(X0 + X1) / 2} y={YN + 26} className={'lbl mid q' + (mode !== 'live' ? '' : q > 0 ? ' red' : ' safe')}>
        {mode === 'idle'
          ? 'keys are uniform on [0, 1]; the first becomes the root'
          : mode === 'over'
            ? ''
            : q > 0
              ? `red ${fmtChance(q)} of the line: the next key busts there`
              : 'no red yet: the next key cannot bust'}
      </text>
    </svg>
  );
}
