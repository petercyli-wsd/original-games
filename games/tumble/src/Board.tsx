import { DIRS, PLACES, cubeChance, forecast, placeOf, rollChances, type Dir, type Face, type Place } from './math';

// Board geometry, in viewBox units. Each cube gets a column: the cube sits in
// the middle of a cross of cells (the four ways it can tip next), and its
// forecast bar sits underneath. The bottom line multiplies the bars.
const CROSS_TOP = 40;
const BAR_H = 22;

const OFFSET: Record<Dir, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const PLACE_LABEL: Record<Place, string> = { top: 'top', side: 'side', bottom: 'bottom' };
export const CALL_LABEL: Record<Place, string> = { top: 'on top', side: 'on a side', bottom: 'on the bottom' };

const pct = (p: number) => (p >= 1 ? '100%' : p <= 0 ? '0%' : p < 0.001 ? `${(p * 100).toFixed(3)}%` : p < 0.1 ? `${(p * 100).toFixed(2)}%` : `${(p * 100).toFixed(1)}%`);

export interface BoardProps {
  faces: Face[];
  /** Rolls still to come. */
  left: number;
  rolls: number;
  target: Place;
  /** The directions the cubes are tipping right now (null when at rest). */
  tipping: Dir[] | null;
  /** Changes every landed roll, so each cube re-mounts at rest in its cell. */
  stepKey: number;
  rollMs: number;
  over: boolean;
}

function Cube({ face, size }: { face: Face; size: number }) {
  const h = size / 2;
  const i = size * 0.27;
  const sideFill = (d: Dir) => (face === d ? 'red' : d === 'N' || d === 'S' ? 'ns' : 'ew');
  const trap: Record<Dir, string> = {
    N: `${-h},${-h} ${h},${-h} ${i},${-i} ${-i},${-i}`,
    E: `${h},${-h} ${h},${h} ${i},${i} ${i},${-i}`,
    S: `${h},${h} ${-h},${h} ${-i},${i} ${i},${i}`,
    W: `${-h},${h} ${-h},${-h} ${-i},${-i} ${-i},${i}`,
  };
  return (
    <g className="cube">
      {face === 'bottom' && <rect x={-h - 7} y={-h - 7} width={size + 14} height={size + 14} rx={8} className="under" />}
      {DIRS.map((d) => (
        <polygon key={d} points={trap[d]} className={'face ' + sideFill(d)} />
      ))}
      <rect x={-i} y={-i} width={2 * i} height={2 * i} className={'face ' + (face === 'top' ? 'red' : 'top')} />
    </g>
  );
}

export default function Board({ faces, left, rolls, target, tipping, stepKey, rollMs, over }: BoardProps) {
  const k = faces.length;
  const VB_W = k === 1 ? 380 : k === 2 ? 480 : 540;
  const colW = VB_W / k;
  const c = k === 1 ? 84 : k === 2 ? 72 : 58;
  const CROSS_Y = CROSS_TOP + 1.5 * c;
  const BAR_Y = CROSS_TOP + 3 * c + 20;
  const VB_H = BAR_Y + BAR_H + 16;
  const bw = Math.min(colW - 28, 300);
  const per = faces.map((f) => cubeChance(placeOf(f), left, target));
  const total = per.reduce((a, b) => a * b, 1);
  const done = rolls - left;
  const pipGap = 22;
  const pipX0 = VB_W / 2 - ((rolls - 1) * pipGap) / 2;

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="tumble" role="img" aria-label={`Win chance ${pct(total)}`}>
      {/* Roll counter: one pip per roll, filled once rolled. */}
      <g className="pips">
        {Array.from({ length: rolls }, (_, j) => (
          <circle key={j} cx={pipX0 + j * pipGap} cy={20} r={6} className={j < done ? 'done' : tipping && j === done ? 'now' : 'todo'} />
        ))}
      </g>

      {faces.map((f, idx) => {
        const cx = colW * (idx + 0.5);
        const cy = CROSS_Y;
        const now = per[idx];
        const next = rollChances(f, left, target);
        const dir = tipping?.[idx];
        const bar = forecast(placeOf(f), left);
        const x0 = cx - bw / 2;
        let acc = 0;
        const ti = PLACES.indexOf(target);
        const tx = x0 + bw * (bar.slice(0, ti).reduce((a, b) => a + b, 0) + bar[ti] / 2);
        const [dx, dy] = dir ? OFFSET[dir] : [0, 0];
        return (
          <g key={idx}>
            {/* The four cells the cube can tip into, each ¼; the number is this cube's chance if it goes there. */}
            {DIRS.map((d, j) => {
              const [ox, oy] = OFFSET[d];
              const p = next[j];
              const tone = left === 0 ? 'off' : p > now + 1e-12 ? 'up' : p < now - 1e-12 ? 'down' : 'same';
              return (
                <g key={d} className={'cell ' + tone}>
                  <rect x={cx + ox * c - c * 0.44} y={cy + oy * c - c * 0.44} width={c * 0.88} height={c * 0.88} rx={6} />
                </g>
              );
            })}
            <rect x={cx - c * 0.44} y={cy - c * 0.44} width={c * 0.88} height={c * 0.88} rx={6} className={'home' + (over ? (now === 1 ? ' won' : now === 0 ? ' lost' : '') : '')} />
            <g
              key={stepKey}
              className="mover"
              style={{
                transform: `translate(${cx + dx * c}px, ${cy + dy * c}px)`,
                transitionDuration: dir ? `${rollMs}ms` : '0ms',
              }}
            >
              <g className={dir ? 'tip' : undefined} style={{ animationDuration: `${rollMs}ms` }}>
                <Cube face={f} size={c * 0.74} />
              </g>
            </g>

            {/* Forecast: where this red face ends, as exact shares of the bar. */}
            {PLACES.map((p, j) => {
              const w = bw * bar[j];
              const x = x0 + bw * acc;
              acc += bar[j];
              if (w <= 0) return null;
              return (
                <g key={p} className={'seg' + (p === target ? ' target' : '')}>
                  <rect x={x} y={BAR_Y} width={w} height={BAR_H} />
                  {w >= 46 && (
                    <text x={x + w / 2} y={BAR_Y + 15.5}>
                      {PLACE_LABEL[p]}
                    </text>
                  )}
                </g>
              );
            })}
            <rect x={x0} y={BAR_Y} width={bw} height={BAR_H} className="bar-frame" />
            <path d={`M ${tx} ${BAR_Y + BAR_H + 2} l -5 7 h 10 Z`} className={'bar-mark' + (over ? (now === 1 ? ' won' : now === 0 ? ' lost' : '') : '')} />
          </g>
        );
      })}
    </svg>
  );
}
