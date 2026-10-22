import { useId } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import { SHAPES, SHAPE_IDS, centre, cutChance, perimeter, shadow, type Pt, type Shape, type ShapeId, type Side } from './math';

/** Arena centre and radius in SVG units; arena coordinates have radius 1. */
const C = { x: 200, y: 194 };
const R = 166;
/** The flat ruler under the arena. */
const FB = { x0: 46, x1: 354, y: 418, h: 12 };

const px = (p: Pt) => ({ x: C.x + R * p.x, y: C.y + R * p.y });
const deg = (rad: number) => (rad * 180) / Math.PI;
const flatX = (offset: number) => FB.x0 + ((offset + 1) / 2) * (FB.x1 - FB.x0);
/** Half-length of the chord at offset p, in SVG units. */
const halfChord = (p: number) => R * Math.sqrt(Math.max(0, 1 - p * p));

/** Where each shape's odds label sits, relative to its centre (arena units). */
const LABEL_AT: Record<ShapeId, Pt> = {
  circle: { x: 0, y: 0.02 },
  rod: { x: 0.08, y: -0.13 },
  square: { x: 0, y: 0.02 },
  triangle: { x: 0, y: 0.2 },
  dot: { x: 0, y: -0.09 },
};

export interface CutLine {
  phi: number;
  p: number;
  hit: boolean;
}

export interface BoardProps {
  shape: ShapeId;
  side: Side;
  lines: number;
  mode: 'idle' | 'live' | 'over';
  /** Direction of the current line's ruler (radians, may exceed 2π while spinning), or null before aiming. */
  angle: number | null;
  /** Offset of the current line while it sweeps or after it lands, or null. */
  p: number | null;
  /** The current line has landed. */
  settled: boolean;
  /** Earlier lines that missed. */
  past: CutLine[];
  result: 'win' | 'lose' | null;
  /** The ruler is still spinning (its shadow label waits until it stops). */
  spinning: boolean;
  onPick?: (id: ShapeId) => void;
}

function ShapeMark({ s, className }: { s: Shape; className: string }) {
  if (s.kind === 'disc') {
    const c = px(s.c);
    return <circle cx={c.x} cy={c.y} r={Math.max(2.6, s.r * R)} className={className} />;
  }
  const pts = s.verts.map(px);
  if (pts.length === 2) return <line x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} className={className + ' rod'} />;
  return <polygon points={pts.map((v) => `${v.x.toFixed(2)},${v.y.toFixed(2)}`).join(' ')} className={className} />;
}

/** An invisible, generous click target over a shape. */
function HitArea({ s, onClick }: { s: Shape; onClick(): void }) {
  const c = px(centre(s));
  if (s.kind === 'poly' && s.verts.length === 2) {
    const [a, b] = s.verts.map(px);
    return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="hit-area wide" onClick={onClick} />;
  }
  const r = s.kind === 'disc' ? Math.max(18, s.r * R + 6) : 46;
  return <circle cx={c.x} cy={c.y} r={r} className="hit-area" onClick={onClick} />;
}

/** The selected shape's outline, unrolled onto the arena rim: its angle is the per-line chance × 360°. */
function rimArc(s: Shape) {
  const c = centre(s);
  const mid = Math.atan2(c.y, c.x);
  const len = perimeter(s); // radians on a unit rim
  const r = R + 9;
  const a = { x: C.x + r * Math.cos(mid - len / 2), y: C.y + r * Math.sin(mid - len / 2) };
  const b = { x: C.x + r * Math.cos(mid + len / 2), y: C.y + r * Math.sin(mid + len / 2) };
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${len > Math.PI ? 1 : 0} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

/** Tick marks round the rim, every 10°. */
const RIM_TICKS = Array.from({ length: 36 }, (_, i) => {
  const a = (i / 36) * 2 * Math.PI;
  const r0 = R + 3;
  const r1 = R + (i % 9 === 0 ? 9 : 6);
  return { x1: C.x + r0 * Math.cos(a), y1: C.y + r0 * Math.sin(a), x2: C.x + r1 * Math.cos(a), y2: C.y + r1 * Math.sin(a) };
});

export default function Board({ shape, side, lines, mode, angle, p, settled, past, result, spinning, onPick }: BoardProps) {
  const clipId = useId().replace(/:/g, '');
  const s = SHAPES[shape];
  const lineNo = past.length + 1;
  const last = lineNo === lines;
  // Colours by meaning for the player: what a line in the shadow does, and what one outside it does.
  const inTone = side === 'hit' ? 'good' : 'bad';
  const outTone = last ? (side === 'hit' ? 'bad' : 'good') : 'next';

  const sh = angle === null ? null : shadow(s, angle);
  const share = sh ? (sh.hi - sh.lo) / 2 : cutChance(s);
  const inside = sh !== null && p !== null && p >= sh.lo && p <= sh.hi;
  const chordTone = p === null ? '' : inside ? inTone : settled ? outTone : 'scan';
  const rot = angle === null ? '' : `translate(${C.x} ${C.y}) rotate(${deg(angle).toFixed(3)})`;
  const ticks = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];

  // The shadow's label sits beside the ruler, on the side away from the shape.
  let shadowLabel: Pt | null = null;
  if (sh && angle !== null && !spinning) {
    const u = { x: Math.cos(angle), y: Math.sin(angle) };
    const v = { x: -u.y, y: u.x };
    const c = centre(s);
    const away = c.x * v.x + c.y * v.y >= 0 ? -1 : 1;
    const mid = (sh.lo + sh.hi) / 2;
    // Clear the ruler by the text box's extent across it (about 44 × 14 px) plus a margin.
    const d = (10 + 22 * Math.abs(v.x) + 7 * Math.abs(v.y)) / R;
    shadowLabel = px({ x: mid * u.x + away * d * v.x, y: mid * u.y + away * d * v.y });
  }

  const winText = side === 'hit' ? (lines === 1 ? 'the line cuts it' : 'any line cuts it') : lines === 1 ? 'the line misses it' : 'every line misses it';

  return (
    <svg viewBox="0 0 400 452" className={'lc-board ' + mode} role="img" aria-label={`${s.name}: ${fmtChance(share)} chance this line cuts it`}>
      <defs>
        <clipPath id={clipId}>
          <circle cx={0} cy={0} r={R} />
        </clipPath>
        <radialGradient id={clipId + 'g'} cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.07" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Corner legends: lines used, and what wins. */}
      <text x={10} y={20} className="legend">
        LINES
      </text>
      {Array.from({ length: lines }, (_, i) => {
        const state =
          i < past.length ? 'missed' : i === past.length && mode !== 'idle' ? (result ? (result === 'win' ? 'won' : 'lost') : 'now') : 'todo';
        return <rect key={i} x={10 + i * 15} y={28} width={11} height={4} rx={2} className={'pip ' + state} />;
      })}
      <text x={390} y={20} className="legend end">
        WIN IF
      </text>
      <text x={390} y={36} className="win-if end">
        {winText}
      </text>

      {/* The arena. */}
      <circle cx={C.x} cy={C.y} r={R} className="arena" />
      <circle cx={C.x} cy={C.y} r={R} fill={`url(#${clipId}g)`} />
      {RIM_TICKS.map((t, i) => (
        <line key={i} {...t} className="rim-tick" />
      ))}

      {/* Idle: the chosen outline unrolled on the rim. */}
      {mode === 'idle' && <path d={rimArc(s)} className="rim-arc" />}

      {/* Earlier lines that missed. */}
      {past.map((l, i) => (
        <g key={i} transform={`translate(${C.x} ${C.y}) rotate(${deg(l.phi).toFixed(3)})`}>
          <line x1={l.p * R} y1={-halfChord(l.p)} x2={l.p * R} y2={halfChord(l.p)} className="past" />
        </g>
      ))}

      {/* The current line's slab: every line in this direction that cuts the shape. */}
      {sh && (
        <g transform={rot}>
          <g clipPath={`url(#${clipId})`}>
            <rect x={sh.lo * R} y={-R} width={(sh.hi - sh.lo) * R} height={2 * R} className={'slab ' + inTone} />
          </g>
          <line x1={sh.lo * R} y1={-halfChord(sh.lo)} x2={sh.lo * R} y2={halfChord(sh.lo)} className={'slab-edge ' + inTone} />
          <line x1={sh.hi * R} y1={-halfChord(sh.hi)} x2={sh.hi * R} y2={halfChord(sh.hi)} className={'slab-edge ' + inTone} />
        </g>
      )}

      {/* The other shapes. */}
      {SHAPE_IDS.filter((id) => id !== shape).map((id) => (
        <ShapeMark key={id} s={SHAPES[id]} className="shape" />
      ))}

      {/* The ruler (a diameter) and the shadow on it. */}
      {sh && (
        <g transform={rot}>
          <line x1={-R} y1={0} x2={R} y2={0} className={'ruler ' + outTone} />
          {ticks.map((t) => (
            <line key={t} x1={t * R} y1={t === 0 ? -6 : -3.5} x2={t * R} y2={t === 0 ? 6 : 3.5} className="tick" />
          ))}
          <line x1={sh.lo * R} y1={0} x2={sh.hi * R} y2={0} className={'shadow ' + inTone} />
          <circle cx={-R} cy={0} r={4.5} className="cap" />
          <path d={`M ${R - 2} -6 L ${R + 9} 0 L ${R - 2} 6 Z`} className="cap" />
        </g>
      )}

      {/* Your shape, above the ruler so it never hides. */}
      <ShapeMark s={s} className={'shape on' + (result ? ` ${result}` : '')} />

      {/* The line. */}
      {sh && p !== null && (
        <g transform={rot}>
          <line x1={p * R} y1={-halfChord(p)} x2={p * R} y2={halfChord(p)} className={'chord ' + chordTone + (settled ? ' settled' : '')} />
          <circle cx={p * R} cy={0} r={5} className={'cut-dot ' + chordTone} />
        </g>
      )}

      {shadowLabel && (
        <text x={shadowLabel.x} y={shadowLabel.y + 4} className={'shadow-label ' + inTone}>
          {fmtChance(share)}
        </text>
      )}

      {/* Idle labels: each shape's chance per line. */}
      {mode === 'idle' &&
        SHAPE_IDS.map((id) => {
          const c = centre(SHAPES[id]);
          const at = px({ x: c.x + LABEL_AT[id].x, y: c.y + LABEL_AT[id].y });
          return (
            <text key={id} x={at.x} y={at.y + 4} className={'odds' + (id === shape ? ' on' : '')}>
              {Math.round(cutChance(SHAPES[id]) * 100)}%
            </text>
          );
        })}

      {onPick &&
        SHAPE_IDS.map((id) => (
          <g key={id} role="button" aria-label={`Pick the ${SHAPES[id].name}`}>
            <HitArea s={SHAPES[id]} onClick={() => onPick(id)} />
          </g>
        ))}

      {/* The flat ruler: the same odds as a length (the round-over card sits here when the round ends). */}
      {mode !== 'over' && <FlatRuler
        mode={angle === null ? 'rim' : 'ruler'}
        lo={sh ? sh.lo : -cutChance(s)}
        hi={sh ? sh.hi : cutChance(s)}
        share={share}
        p={p}
        settled={settled}
        inTone={inTone}
        outTone={outTone}
        chordTone={chordTone}
        label={angle === null ? `One line: ${s.name.toLowerCase()} outline ÷ rim` : `Line ${lineNo} of ${lines}: shadow ÷ ruler`}
        perim={perimeter(s)}
      />}
    </svg>
  );
}

function FlatRuler({
  mode,
  lo,
  hi,
  share,
  p,
  settled,
  inTone,
  outTone,
  chordTone,
  label,
  perim,
}: {
  mode: 'rim' | 'ruler';
  lo: number;
  hi: number;
  share: number;
  p: number | null;
  settled: boolean;
  inTone: string;
  outTone: string;
  chordTone: string;
  label: string;
  perim: number;
}) {
  const { x0, x1, y, h } = FB;
  const a = flatX(Math.max(-1, lo));
  const b = flatX(Math.min(1, hi));
  return (
    <g className={'flat ' + mode}>
      <text x={x0 - 8} y={y - 12} className="flat-label">
        {label}
      </text>
      <text x={x1 + 8} y={y - 11} className={'flat-pct ' + (mode === 'rim' ? 'accent' : inTone)}>
        {fmtChance(share)}
        <tspan className="flat-unit">{mode === 'rim' ? ' per line' : ' cuts'}</tspan>
      </text>
      <rect x={x0} y={y} width={x1 - x0} height={h} rx={h / 2} className={'bar ' + (mode === 'rim' ? 'rim' : outTone)} />
      <rect x={a} y={y} width={Math.max(1.5, b - a)} rx={2} height={h} className={'bar-in ' + (mode === 'rim' ? 'accent' : inTone)} />
      {mode === 'ruler' ? (
        <>
          <circle cx={x0 - 9} cy={y + h / 2} r={4} className="cap" />
          <path d={`M ${x1 + 5} ${y + h / 2 - 5} L ${x1 + 14} ${y + h / 2} L ${x1 + 5} ${y + h / 2 + 5} Z`} className="cap" />
          <text x={x0} y={y + h + 16} className="flat-end">
            −1
          </text>
          <text x={(x0 + x1) / 2} y={y + h + 16} className="flat-end mid">
            each spot on the ruler is equally likely
          </text>
          <text x={x1} y={y + h + 16} className="flat-end end">
            +1
          </text>
          {p !== null && (
            <g className={'needle ' + chordTone + (settled ? ' settled' : '')}>
              <line x1={flatX(p)} y1={y - 6} x2={flatX(p)} y2={y + h + 6} />
              <circle cx={flatX(p)} cy={y - 6} r={3.5} />
            </g>
          )}
        </>
      ) : (
        <>
          <text x={x0} y={y + h + 16} className="flat-end">
            outline {perim.toFixed(2)}
          </text>
          <text x={x1} y={y + h + 16} className="flat-end end">
            rim 2π ≈ 6.28
          </text>
        </>
      )}
    </g>
  );
}

/** Small glyphs for the shape chips. */
export function Glyph({ id }: { id: ShapeId }) {
  return (
    <svg viewBox="0 0 16 16" className="lc-glyph" aria-hidden="true">
      {id === 'circle' && <circle cx={8} cy={8} r={6} />}
      {id === 'rod' && <line x1={2.5} y1={12.5} x2={13.5} y2={3.5} className="g-rod" />}
      {id === 'square' && <rect x={3} y={3} width={10} height={10} transform="rotate(15 8 8)" />}
      {id === 'triangle' && <polygon points="8,2.2 14,13 2,13" />}
      {id === 'dot' && <circle cx={8} cy={8} r={2} className="g-dot" />}
    </svg>
  );
}
