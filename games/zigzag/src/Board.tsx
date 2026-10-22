import { fmtChance } from '@originals/game-sdk/ui';
import { chanceIfLands, pattern, stepSafe, type Dir, type Settings } from './math';

const W = 520;
const LEFT = 34;
const RIGHT = W - 14;
const TOP = 46;
const BOTTOM = 286;
const H = BOTTOM - TOP;
const BANDS = 24;

export type Outcome = 'bust' | 'cashed' | 'full';

export interface Drop {
  y: number;
  safe: boolean;
}

export interface BoardProps {
  settings: Settings;
  bars: number[];
  /** The bar in flight (already decided). */
  drop: Drop | null;
  growMs: number;
  /** The bar that broke the pattern, if the round busted. */
  bustBar: number | null;
  outcome: Outcome | null;
  live: boolean;
}

const yOf = (v: number) => BOTTOM - v * H;


function Arrow({ dir, x, y, on }: { dir: Dir | null; x: number; y: number; on: boolean }) {
  const cls = 'arrow' + (on ? ' on' : '');
  if (dir === null) {
    return (
      <g className={cls}>
        <path d={`M ${x - 5} ${y - 3} L ${x} ${y - 9} L ${x + 5} ${y - 3} M ${x - 5} ${y + 3} L ${x} ${y + 9} L ${x + 5} ${y + 3}`} />
      </g>
    );
  }
  const s = dir === 'up' ? 1 : -1;
  return (
    <g className={cls}>
      <path d={`M ${x} ${y - 8 * s} L ${x} ${y + 8 * s} M ${x - 6} ${y - 2 * s} L ${x} ${y - 8 * s} L ${x + 6} ${y - 2 * s}`} />
    </g>
  );
}

export default function Board({ settings, bars, drop, growMs, bustBar, outcome, live }: BoardProps) {
  const { n, either } = settings;
  const slot = (RIGHT - LEFT) / n;
  const cx = (i: number) => LEFT + slot * (i + 0.5);
  const barW = Math.min(30, slot * 0.56);
  const dirs = pattern(bars, settings);
  const k = bars.length;
  const last = bars[k - 1];

  // The next slot: its safe zone (literal) and how good each landing height is.
  const showZone = live && k > 0 && k < n;
  const q = showZone ? stepSafe(bars, either) : 0;
  const free = showZone && either && k === 1;
  const up = !free && dirs[k - 1] === 'up';
  const zoneLo = free ? 0 : up ? last : 0;
  const zoneHi = free ? 1 : up ? 1 : last;
  let bands: { lo: number; hi: number; p: number }[] = [];
  if (showZone && zoneHi > zoneLo) {
    bands = Array.from({ length: BANDS }, (_, i) => {
      const lo = zoneLo + ((zoneHi - zoneLo) * i) / BANDS;
      const hi = zoneLo + ((zoneHi - zoneLo) * (i + 1)) / BANDS;
      return { lo, hi, p: chanceIfLands(bars, (lo + hi) / 2, settings) };
    });
  }
  const pMax = Math.max(1e-12, ...bands.map((b) => b.p));
  const nx = cx(k);
  const zoneW = Math.min(slot - 6, 46);

  // Label goes in the larger region, next to the boundary.
  const labelIn = free ? 0.5 : up ? (q >= 0.5 ? last + q / 2 : last - (1 - q) / 2) : q >= 0.5 ? last / 2 : last + (1 - last) / 2;

  const tops = bars.map((v, i) => `${cx(i).toFixed(1)},${yOf(v).toFixed(1)}`);
  const ghost = Array.from({ length: n }, (_, i) => {
    const d = i % 2 ? 0.72 : 0.3;
    return `${cx(i).toFixed(1)},${yOf(d).toFixed(1)}`;
  });

  const head = either ? `${n} bars · first turn either way` : `${n} bars · up first`;
  const right = outcome === 'full' ? 'Board full' : outcome === 'bust' ? 'Pattern broken' : k === 0 ? (either ? 'Zig or zag first' : 'Up, down, up…') : `bar ${k} of ${n}`;

  return (
    <svg viewBox={`0 0 ${W} 330`} className="zz" role="img" aria-label={`${k} of ${n} bars alternate`}>
      <text x={LEFT - 6} y={24} className="hdr">
        {head}
      </text>
      <text x={RIGHT} y={24} className={'hdr right' + (outcome ? ` ${outcome}` : '')}>
        {right}
      </text>

      {/* Height scale */}
      <line x1={LEFT - 6} y1={TOP} x2={LEFT - 6} y2={BOTTOM} className="axis" />
      {[0, 0.5, 1].map((v) => (
        <text key={v} x={LEFT - 10} y={yOf(v) + 4} className="tick">
          {v}
        </text>
      ))}
      <line x1={LEFT - 6} y1={BOTTOM} x2={RIGHT} y2={BOTTOM} className="axis" />

      {/* Empty slots */}
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={cx(i) - barW / 2} y={TOP} width={barW} height={H} rx={4} className={'slot' + (i < k ? ' used' : '')} />
      ))}

      {/* The next slot: green where the next bar must land, red elsewhere. */}
      {showZone && (
        <g className="zone">
          <rect x={nx - zoneW / 2} y={TOP} width={zoneW} height={H} rx={4} className="risk" />
          {bands.map((b, i) => (
            <rect
              key={i}
              x={nx - zoneW / 2}
              y={yOf(b.hi)}
              width={zoneW}
              height={yOf(b.lo) - yOf(b.hi) + 0.4}
              className="safe"
              style={{ opacity: 0.22 + 0.73 * (b.p / pMax) }}
            />
          ))}
          {!free && <line x1={cx(k - 1)} y1={yOf(last)} x2={nx + zoneW / 2 + 2} y2={yOf(last)} className="level" />}
          <text x={nx} y={yOf(labelIn) - 2} className="zone-pct">
            {fmtChance(q)}
          </text>
          <text x={nx} y={yOf(labelIn) + 12} className="zone-sub">
            {free ? 'free' : 'safe'}
          </text>
        </g>
      )}

      {/* Idle preview: the pattern to beat. */}
      {k === 0 && !drop && <polyline points={ghost.join(' ')} className="ghost" />}

      {/* Bars */}
      {bars.map((v, i) => (
        <rect key={i} x={cx(i) - barW / 2} y={yOf(v)} width={barW} height={v * H} rx={4} className={'bar' + (i === k - 1 && live ? ' last' : '') + (outcome === 'full' ? ' won' : '')} />
      ))}
      {bars.length > 1 && <polyline points={tops.join(' ')} className={'zig' + (outcome === 'full' ? ' won' : '')} />}
      {bars.map((v, i) => (
        <circle key={i} cx={cx(i)} cy={yOf(v)} r={4} className="tip" />
      ))}

      {drop && (
        <rect
          key={`drop-${k}`}
          x={cx(k) - barW / 2}
          y={yOf(drop.y)}
          width={barW}
          height={drop.y * H}
          rx={4}
          className={'bar dropping' + (drop.safe ? '' : ' bust')}
          style={{ animationDuration: `${growMs}ms` }}
        />
      )}
      {bustBar !== null && (
        <>
          <line x1={cx(k - 1)} y1={yOf(last)} x2={cx(k)} y2={yOf(bustBar)} className="zig broken" />
          <rect x={cx(k) - barW / 2} y={yOf(bustBar)} width={barW} height={bustBar * H} rx={4} className="bar bust" />
        </>
      )}

      {/* Required direction of each step. */}
      {Array.from({ length: n }, (_, i) =>
        i === 0 ? (
          <text key={i} x={cx(0)} y={312} className="any">
            any
          </text>
        ) : (
          <Arrow key={i} dir={dirs[i - 1]} x={cx(i)} y={308} on={live && i === k} />
        ),
      )}
    </svg>
  );
}
