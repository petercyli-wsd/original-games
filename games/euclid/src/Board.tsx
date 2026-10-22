import { useMemo } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import { slopes, tree, wins, type Bet, type Clues, type Pair, type Size } from './math';

// ---------------------------------------------------------------------------
// The rectangle: Euclid's algorithm as squares cut from a box.
// ---------------------------------------------------------------------------

/** Stand-in shape (long/short) for the unexplored remainder. */
const TAIL = 1.618;
/** At most this many squares are drawn per cut; bigger quotients are labelled. */
const CAP = 5;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CutGeom {
  q: number;
  /** The box this cut was made in. */
  box: Box;
  squares: Box[];
  /** The span the squares cover. */
  strip: Box;
  side: number;
}

/**
 * Lays out the cuts. Sizes are exact once the run has finished (when no
 * quotient exceeds CAP); before that the fogged remainder is drawn with a
 * stand-in shape, since its true shape is exactly what is still hidden.
 */
function layout(quotients: readonly number[], done: boolean) {
  const n = quotients.length;
  const shown = quotients.map((q) => Math.min(q, CAP));
  // x[j] = long/short ratio of the box cut at step j.
  const x: number[] = new Array(n);
  let next = done ? Infinity : TAIL;
  for (let j = n - 1; j >= 0; j--) {
    x[j] = shown[j] + (Number.isFinite(next) ? 1 / next : 0);
    next = x[j];
  }
  const outer: Box = { x: 0, y: 0, w: n ? x[0] : TAIL, h: 1 };
  const cuts: CutGeom[] = [];
  let box = outer;
  for (let j = 0; j < n; j++) {
    const d = j % 4;
    const horizontal = d % 2 === 0;
    const s = horizontal ? box.h : box.w;
    const k = shown[j];
    const squares: Box[] = [];
    for (let i = 0; i < k; i++) {
      if (d === 0) squares.push({ x: box.x + i * s, y: box.y, w: s, h: s });
      if (d === 1) squares.push({ x: box.x, y: box.y + i * s, w: s, h: s });
      if (d === 2) squares.push({ x: box.x + box.w - (i + 1) * s, y: box.y, w: s, h: s });
      if (d === 3) squares.push({ x: box.x, y: box.y + box.h - (i + 1) * s, w: s, h: s });
    }
    const len = k * s;
    let strip: Box;
    let rest: Box;
    if (d === 0) [strip, rest] = [{ ...box, w: len }, { ...box, x: box.x + len, w: box.w - len }];
    else if (d === 1) [strip, rest] = [{ ...box, h: len }, { ...box, y: box.y + len, h: box.h - len }];
    else if (d === 2) [strip, rest] = [{ ...box, x: box.x + box.w - len, w: len }, { ...box, w: box.w - len }];
    else [strip, rest] = [{ ...box, y: box.y + box.h - len, h: len }, { ...box, h: box.h - len }];
    cuts.push({ q: quotients[j], box, squares, strip, side: s });
    box = rest;
  }
  return { outer, cuts, fog: done ? null : box };
}

const RW = 400;
const TOP = 46;
const RH = 330;

export interface RectProps {
  /** Quotients to draw (the whole run once the round is over). */
  quotients: number[];
  done: boolean;
  /** How many of those cuts the player actually revealed (the rest are drawn as ghosts). */
  revealed: number;
  scale: number | null;
  /** The hidden pair, once the round is over. */
  pair: Pair | null;
  size: Size;
  /** Zoom on the newest cut (live) or show the whole rectangle. */
  zoomAll: boolean;
  /** The cut that is animating in. */
  fresh: number | null;
  ms: number;
}

export function RectView({ quotients, done, revealed, scale, pair, size, zoomAll, fresh, ms }: RectProps) {
  const { outer, cuts, fog } = layout(quotients, done);
  const n = cuts.length;
  const focus = zoomAll || n === 0 ? outer : cuts[n - 1].box;
  const pad = 14;
  const k = Math.min((RW - 2 * pad) / focus.w, (RH - TOP - 2 * pad) / focus.h);
  const tx = RW / 2 - k * (focus.x + focus.w / 2);
  const ty = TOP + (RH - TOP) / 2 - k * (focus.y + focus.h / 2);
  const onScreen = (x: number, y: number) => {
    const sx = k * x + tx;
    const sy = k * y + ty;
    return sx > 24 && sx < RW - 24 && sy > TOP + 8 && sy < RH - 8;
  };
  const font = (side: number) => Math.min(0.36 * side, 26 / k);

  const cf =
    quotients.length === 0
      ? '[ ? ]'
      : `[${quotients[0]}${quotients.length > 1 || !done ? ';' : ''} ${quotients.slice(1).join(', ')}${done ? '' : quotients.length > 1 ? ', …' : '…'}]`;
  const lastSquare = done && n ? cuts[n - 1].squares[cuts[n - 1].squares.length - 1] : null;

  return (
    <svg viewBox={`0 0 ${RW} ${RH}`} className="eu-rect" role="img" aria-label={`Euclid's algorithm: a / b = ${cf}`}>
      <defs>
        <clipPath id="eu-clip">
          <rect x={0} y={TOP - 6} width={RW} height={RH - TOP + 6} rx={10} />
        </clipPath>
        <radialGradient id="eu-fog">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0.04" />
        </radialGradient>
      </defs>
      <text x={RW / 2} y={20} className="cf">
        {pair ? `${pair.a} / ${pair.b} = ${cf}` : `a / b = ${cf}`}
      </text>
      <text x={RW / 2} y={38} className="cf-sub">
        {pair
          ? `gcd(${pair.a}, ${pair.b}) = ${pair.g} · ${pair.q.length} cut${pair.q.length === 1 ? '' : 's'}`
          : n === 0
            ? `hidden pair 1 ≤ b < a ≤ ${size}`
            : done
              ? scale === null
                ? 'run finished · the scale is still hidden'
                : `final square ${scale} × ${scale}`
              : `${n} cut${n === 1 ? '' : 's'} so far · the fog is still to cut`}
      </text>
      <g clipPath="url(#eu-clip)">
        <g className="zoom" style={{ transform: `translate(${tx}px, ${ty}px) scale(${k})`, transitionDuration: `${ms}ms` }}>
          <rect x={outer.x} y={outer.y} width={outer.w} height={outer.h} className="outer" />
          {cuts.map((c, j) => {
            const cls = 'cut' + (j >= revealed ? ' ghost' : '') + (j === n - 1 && !zoomAll ? ' newest' : '') + (j === fresh ? ' fresh' : '');
            return (
              <g key={j} className={cls} style={{ animationDuration: `${ms}ms` }}>
                {c.squares.map((s, i) => (
                  <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} className={'sq' + (lastSquare === s ? ' final' : '')} />
                ))}
                {c.side * k > 9 && onScreen(c.strip.x + c.strip.w / 2, c.strip.y + c.strip.h / 2) && (
                  <text
                    x={c.strip.x + c.strip.w / 2}
                    y={c.strip.y + c.strip.h / 2}
                    dy="0.35em"
                    className="q"
                    style={{ fontSize: font(c.side) }}
                  >
                    {c.q > CAP ? `${c.q} squares` : `×${c.q}`}
                  </text>
                )}
              </g>
            );
          })}
          {lastSquare && lastSquare.w * k > 26 && (
            <text
              x={lastSquare.x + lastSquare.w / 2}
              y={lastSquare.y + lastSquare.h * 0.82}
              className="gtag"
              style={{ fontSize: Math.min(0.2 * lastSquare.w, 14 / k) }}
            >
              {scale === null ? 'side g = ?' : `side ${scale}`}
            </text>
          )}
          {fog && (
            <g className="fog">
              <rect x={fog.x} y={fog.y} width={fog.w} height={fog.h} />
              <text x={fog.x + fog.w / 2} y={fog.y + fog.h / 2} dy="0.35em" style={{ fontSize: Math.min(0.5 * Math.min(fog.w, fog.h), 34 / k) }}>
                ?
              </text>
            </g>
          )}
        </g>
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The pairs: every (b, a) with b < a ≤ N as a dot; lit dots are the candidates.
// ---------------------------------------------------------------------------

const PW = 320;
const PH = 330;
const X0 = 34;
const Y0 = 300;
const L = 270;

export interface PairsProps {
  size: Size;
  bet: Bet;
  /** The clues that decide which pairs are still candidates. */
  clues: Clues;
  candidates: Pair[];
  winners: number;
  pair: Pair | null;
}

export function PairsView({ size, bet, clues, candidates, winners, pair }: PairsProps) {
  const cell = L / (size + 0.5);
  const dn = cell * (size <= 60 ? 0.78 : 0.92);
  const d = dn.toFixed(2);
  const paths = useMemo(() => {
    const lit = new Set(candidates);
    let win = '';
    let lose = '';
    let dim = '';
    for (const p of tree(size).pairs) {
      const sq = `M${(X0 + p.b * cell - dn / 2).toFixed(1)} ${(Y0 - p.a * cell - dn / 2).toFixed(1)}h${d}v${d}h-${d}z`;
      if (!lit.has(p)) dim += sq;
      else if (wins(p, bet)) win += sq;
      else lose += sq;
    }
    return { win, lose, dim };
  }, [size, bet, candidates, cell, d, dn]);

  const rays = slopes(clues).map(({ num, den }) => ({ x: X0 + ((size * den) / num) * cell, y: Y0 - size * cell }));
  const total = candidates.length;
  const hidden = pair ? { x: X0 + pair.b * cell, y: Y0 - pair.a * cell } : null;

  return (
    <svg viewBox={`0 0 ${PW} ${PH}`} className="eu-pairs" role="img" aria-label={`${winners} of ${total} candidate pairs win`}>
      <text x={X0} y={18} className="head" textAnchor="start">
        Candidate pairs (b, a)
      </text>
      <path d={`M${X0} ${Y0}V${Y0 - L}H${X0 + L}`} className="axis" />
      {rays.length === 2 && <path d={`M${X0} ${Y0}L${rays[0].x} ${rays[0].y}H${rays[1].x}Z`} className="wedge" />}
      <path d={paths.dim} className="dot dim" />
      <path d={paths.lose} className="dot lose" />
      <path d={paths.win} className="dot win" />
      {rays.map((r, i) => (
        <line key={i} x1={X0} y1={Y0} x2={r.x} y2={r.y} className="ray" />
      ))}
      {hidden && <circle cx={hidden.x} cy={hidden.y} r={Math.max(5, cell * 1.4)} className="hidden-pair" />}
      <text x={X0 - 8} y={Y0 - L + 4} className="tick" textAnchor="end">
        {size}
      </text>
      <text x={X0 - 8} y={Y0 + 4} className="tick" textAnchor="end">
        0
      </text>
      <text x={X0 + L} y={Y0 + 16} className="tick" textAnchor="end">
        b →
      </text>
      <text x={X0 - 10} y={Y0 - L / 2} className="tick" textAnchor="end">
        a
      </text>
      <text x={X0 + L} y={Y0 - 74} className="pct" textAnchor="end">
        {fmtChance(total ? winners / total : 0)}
      </text>
      <text x={X0 + L} y={Y0 - 52} className="frac" textAnchor="end">
        <tspan className="w">{winners.toLocaleString('en-US')}</tspan> win of {total.toLocaleString('en-US')}
      </text>
      <text x={X0 + L} y={Y0 - 34} className="legend" textAnchor="end">
        lit pairs fit every cut so far
      </text>
    </svg>
  );
}
