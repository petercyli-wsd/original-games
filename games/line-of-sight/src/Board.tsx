import { fmtChance } from '@originals/game-sdk/ui';
import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { BET_PHRASE, blockers, chanceOf, gcd, litCount, litRows, wins, type Settings, type Target } from './math';

/** Geometry of the drawing, in viewBox units. */
const W = 440;
const H = 520;
const OX = 40;
const OY = 488;
const G = 384;
const TRACK_Y = 22;
const TOKEN_R = 14;

/** A reveal in progress: the strip or the row marker sweeps to `value`, starting at `from`. */
export interface Flight {
  kind: 'column' | 'row';
  index: number;
  value: number;
  from: number;
  ms: number;
  key: number;
  /** Row reveals only: the marker has arrived and the line of sight is being drawn. */
  landed: boolean;
}

export interface BoardProps {
  settings: Settings;
  /** Reveals that have happened (the in-flight one is in `flight`). */
  targets: Target[];
  flight: Flight | null;
  lineMs: number;
  over: boolean;
}

/** Slides an SVG group from an offset back to its place, once per key. */
function useSweep(key: number | null, dx: number, dy: number, ms: number) {
  const ref = useRef<SVGGElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (key === null || !el || typeof el.animate !== 'function') return;
    const anim = el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }], {
      duration: ms,
      easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)',
    });
    return () => anim.cancel();
    // Only a new key restarts the sweep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ref;
}

/** A pie sector from 12 o'clock, clockwise, covering share p of the disc. */
function sector(cx: number, cy: number, r: number, p: number) {
  const a = 2 * Math.PI * p;
  const x = cx + r * Math.sin(a);
  const y = cy - r * Math.cos(a);
  return `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 ${p > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`;
}

function ticks(N: number) {
  if (N <= 10) return Array.from({ length: N }, (_, i) => i + 1);
  const step = N <= 20 ? 5 : 10;
  const multiples = Array.from({ length: N / step }, (_, i) => (i + 1) * step);
  // Tick 1 would crowd the observer once the grid is fine.
  return N <= 20 ? [1, ...multiples] : multiples;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export default function Board({ settings, targets, flight, lineMs, over }: BoardProps) {
  const { bet, size: N, count } = settings;
  const s = G / N;
  const X = (a: number) => OX + a * s;
  const Y = (b: number) => OY - b * s;
  const phrase = BET_PHRASE[bet];

  // The target in focus: the one being revealed, else the latest one with a column.
  let focus = flight ? flight.index : -1;
  if (!flight) for (let i = targets.length - 1; i >= 0 && focus < 0; i--) if (targets[i]?.a != null) focus = i;
  const ft = focus >= 0 ? targets[focus] : undefined;
  const colA = flight?.kind === 'column' ? flight.value : ft?.a ?? null;
  const colScanning = flight?.kind === 'column';
  const rowB = flight?.kind === 'row' ? flight.value : ft?.b ?? null;
  const rowScanning = flight?.kind === 'row' && !flight.landed;
  const resolved = ft?.b != null;
  // The strip shows while this target is open (and after a loss, to show why); once a target is
  // cleared, the next one starts from the whole orchard again.
  const lostHere = resolved && !wins(bet, ft!.a!, ft!.b!);
  const showStrip = colA !== null && (!resolved || (over && lostHere));
  const colLit = showStrip && !colScanning;
  const showHit = rowB !== null && colA !== null && !rowScanning;

  const rLit = Math.min(9, s * 0.27);
  const rDim = Math.min(5.5, s * 0.16);

  const trees = useMemo(() => {
    const out = [];
    for (let a = 1; a <= N; a++) {
      for (let b = 1; b <= N; b++) {
        const lit = wins(bet, a, b);
        const inCol = colLit && a === colA;
        const dim = colLit && a !== colA;
        out.push(
          <circle
            key={a * 64 + b}
            cx={X(a)}
            cy={Y(b)}
            r={lit ? rLit : rDim}
            className={'tree ' + (lit ? 'lit' : 'unlit') + (inCol ? ' col' : '') + (dim ? ' dim' : '')}
          />,
        );
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bet, N, colA, colLit]);

  const colRef = useSweep(colScanning ? flight!.key : null, (flight?.from ?? 0) * s - (colA ?? 0) * s, 0, flight?.ms ?? 0);
  const rowRef = useSweep(flight?.kind === 'row' ? flight.key : null, 0, ((rowB ?? 0) - (flight?.from ?? 0)) * s, flight?.ms ?? 0);

  const lit = colA !== null ? litRows(bet, colA, N) : 0;
  const total = litCount(bet, N);

  // The tracker: one pie per target, its green share the target's chance. They multiply to the win chance.
  const spacing = count > 1 ? Math.min(54, 350 / (count - 1)) : 0;
  const tx = (i: number) => W / 2 - (spacing * (count - 1)) / 2 + i * spacing;

  const lineStyle = (delay: number, dur: number): CSSProperties => ({ animationDelay: `${delay}ms`, animationDuration: `${dur}ms` });

  function ray(t: Target, i: number, emphasis: boolean) {
    const a = t.a!;
    const b = t.b!;
    const g = gcd(a, b);
    const first = { x: X(a / g), y: Y(b / g) };
    const end = { x: X(a), y: Y(b) };
    const animate = emphasis && flight?.kind === 'row' && flight.landed;
    const drawMs = lineMs * (g === 1 ? 0.85 : 0.55);
    const done = t.b != null && !(flight?.kind === 'row' && flight.index === i);
    const win = done && wins(bet, a, b);
    const cls = emphasis ? 'ray' : 'ray past';
    return (
      <g key={`ray-${i}`} className={emphasis ? 'focus' : 'past'}>
        <line
          x1={OX}
          y1={OY}
          x2={first.x}
          y2={first.y}
          pathLength={1}
          className={cls + ' seen' + (animate ? ' draw' : '')}
          style={animate ? lineStyle(0, drawMs) : undefined}
        />
        {g > 1 && (
          <line
            x1={first.x}
            y1={first.y}
            x2={end.x}
            y2={end.y}
            className={cls + ' blocked' + (animate ? ' fade' : '')}
            style={animate ? lineStyle(drawMs, lineMs - drawMs) : undefined}
          />
        )}
        {emphasis &&
          blockers(a, b).map(([bx, by], k) => (
            <circle
              key={k}
              cx={X(bx)}
              cy={Y(by)}
              r={Math.max(rLit + 2.5, 4.5)}
              className={'blocker' + (k === 0 ? ' first' : '') + (animate ? ' pop' : '')}
              style={animate ? lineStyle(drawMs, 160) : undefined}
            />
          ))}
        <circle
          cx={end.x}
          cy={end.y}
          r={emphasis ? Math.max(s * 0.46, 7) : Math.max(s * 0.36, 5)}
          className={'hit' + (done ? (win ? ' win' : ' lose') : ' pending') + (emphasis ? '' : ' small')}
        />
      </g>
    );
  }

  // The label by the focus target: its gcd, and how many trees block the view.
  let hitLabel: { x: number; y: number; anchor: 'start' | 'end'; text: string; win: boolean } | null = null;
  if (showHit && resolved && ft) {
    const g = gcd(colA!, rowB!);
    const right = X(colA!) < W - 150;
    hitLabel = {
      x: X(colA!) + (right ? 1 : -1) * Math.max(s * 0.6, 10),
      y: clamp(Y(rowB!) - Math.max(s * 0.55, 10), 104, OY - 12),
      anchor: right ? 'start' : 'end',
      text: `gcd ${g} · ` + (g === 1 ? 'clear view' : `${g - 1} tree${g > 2 ? 's' : ''} in the way`),
      win: wins(bet, colA!, rowB!),
    };
  }

  const topY = Y(N) - s / 2;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="sight"
      style={{ '--fx': `${Math.round(lineMs * 0.45)}ms`, '--lit-k': N >= 50 ? 1.6 : 1.15, '--unlit-k': N >= 50 ? 2.2 : 1.45 } as CSSProperties}
      role="img"
      aria-label={`${N} by ${N} orchard, ${total} of ${N * N} trees ${phrase}`}
    >
      {/* Tracker: each target's chance as a pie. */}
      <g className="tracker">
        {Array.from({ length: count }, (_, i) => {
          const t = targets[i];
          const done = t?.b != null && !(flight?.kind === 'row' && flight.index === i);
          const p = done ? (wins(bet, t!.a!, t!.b!) ? 1 : 0) : chanceOf(settings, t);
          const current = !over && (flight ? flight.index === i : !done && (i === 0 || targets[i - 1]?.b != null) && targets.length > 0);
          const x = tx(i);
          const label = done ? `(${t!.a},${t!.b})` : t?.a != null && !(flight?.kind === 'column' && flight.index === i) ? `${litRows(bet, t.a, N)}/${N}` : fmtChance(p);
          return (
            <g key={i} className={'token' + (done ? (p === 1 ? ' won' : ' lost') : '') + (current ? ' current' : '')}>
              {i > 0 && (
                <text x={x - spacing / 2} y={TRACK_Y + 4.5} className="times">
                  ×
                </text>
              )}
              {current && <circle cx={x} cy={TRACK_Y} r={TOKEN_R + 4} className="ring" />}
              <circle cx={x} cy={TRACK_Y} r={TOKEN_R} className="bg" />
              {p >= 1 ? <circle cx={x} cy={TRACK_Y} r={TOKEN_R} className="share" /> : p > 0 && <path d={sector(x, TRACK_Y, TOKEN_R, p)} className="share" />}
              {done && (
                <text x={x} y={TRACK_Y + 5} className="mark">
                  {p === 1 ? '✓' : '✕'}
                </text>
              )}
              <text x={x} y={TRACK_Y + TOKEN_R + 18} className="tlabel">
                {label}
              </text>
            </g>
          );
        })}
      </g>

      {/* Axes from the observer's corner. */}
      <line x1={OX} y1={OY} x2={X(N) + s * 0.5} y2={OY} className="axis" />
      <line x1={OX} y1={OY} x2={OX} y2={topY} className="axis" />
      {ticks(N).map((v) => (
        <g key={v}>
          {!(colLit && Math.abs(v - colA!) * s < 24) && (
            <text x={X(v)} y={OY + 18} className="tick">
              {v}
            </text>
          )}
          {!(showStrip && showHit && Math.abs(v - rowB!) * s < 15) && (
            <text x={OX - 10} y={Y(v) + 4} className="tick y">
              {v}
            </text>
          )}
        </g>
      ))}

      {/* The column strip of the focus target. */}
      {showStrip && (
        <g ref={colRef} key={`strip-${focus}`} className={'strip' + (colScanning ? ' scanning' : '')}>
          <rect x={X(colA!) - s / 2} y={topY} width={s} height={N * s} rx={Math.min(s / 2, 8)} />
        </g>
      )}

      <g className="trees">{trees}</g>

      {/* The row marker: sweeps up or down the column to row b. */}
      {showStrip && rowB !== null && (
        <g ref={rowRef} key={`row-${focus}`} className={'rowmark' + (rowScanning ? ' scanning' : '')}>
          <line x1={OX} y1={Y(rowB)} x2={X(colA!)} y2={Y(rowB)} />
          {!showHit && <rect x={X(colA!) - s / 2} y={Y(rowB) - s / 2} width={s} height={s} rx={Math.min(s / 3, 5)} />}
        </g>
      )}

      {/* Lines of sight: earlier targets faint, the focus target in full. */}
      {targets.map((t, i) => (t?.a != null && t.b != null && i !== focus ? ray(t, i, false) : null))}
      {showHit && ray({ a: colA, b: rowB }, focus, true)}

      {/* Axis pills for the revealed coordinates. */}
      {colLit && (
        <g className="pill">
          <rect x={X(colA!) - 15} y={OY + 6} width={30} height={17} rx={8.5} />
          <text x={X(colA!)} y={OY + 18.5}>
            {colA}
          </text>
        </g>
      )}
      {showStrip && showHit && (
        <g className="pill">
          <rect x={OX - 33} y={Y(rowB!) - 8.5} width={30} height={17} rx={8.5} />
          <text x={OX - 18} y={Y(rowB!) + 4}>
            {rowB}
          </text>
        </g>
      )}

      {/* The observer. */}
      <circle cx={OX} cy={OY} r={11} className="eye-ring" />
      <circle cx={OX} cy={OY} r={4.5} className="eye" />

      {/* The odds in words: the lit count of the column, or of the whole orchard. */}
      {colLit ? (
        <text x={clamp(X(colA!), 70, W - 70)} y={topY - 9} className={'count' + (lit === 0 ? ' zero' : '')}>
          <tspan className="num">{lit}</tspan>
          <tspan className="of">{` of ${N} ${phrase}`}</tspan>
        </text>
      ) : (
        !colScanning && (
          <text x={W / 2} y={topY - 9} className="count orchard">
            <tspan className="num">{total}</tspan>
            <tspan className="of">{` of ${N * N} trees ${phrase} · ${fmtChance(total / (N * N))}`}</tspan>
          </text>
        )
      )}

      {hitLabel && (
        <text x={hitLabel.x} y={hitLabel.y} style={{ textAnchor: hitLabel.anchor }} className={'hitlabel ' + (hitLabel.win ? 'win' : 'lose')}>
          {hitLabel.text}
        </text>
      )}
    </svg>
  );
}
