import { useId } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import { SHAPES, cutChance, shadow, type Pt, type Shape, type ShapeId } from './math';

/** Arena centre and radius in SVG units; arena coordinates have radius 1. */
const C = { x: 200, y: 194 };
const R = 166;
/** The flat ruler under the arena. */
const FB = { x0: 46, x1: 354, y: 400, h: 12 };

const px = (p: Pt) => ({ x: C.x + R * p.x, y: C.y + R * p.y });
const deg = (rad: number) => (rad * 180) / Math.PI;
const flatX = (offset: number) => FB.x0 + ((offset + 1) / 2) * (FB.x1 - FB.x0);
/** Half-length of the chord at offset p, in SVG units. */
const halfChord = (p: number) => R * Math.sqrt(Math.max(0, 1 - p * p));

export interface BoardProps {
  shape: ShapeId;
  mode: 'idle' | 'live' | 'over';
  /** Direction of the ruler (radians, may exceed 2π while spinning), or null before aiming. */
  angle: number | null;
  /** Offset of the line while it sweeps or after it lands, or null. */
  p: number | null;
  /** The line has landed. */
  settled: boolean;
  result: 'win' | 'lose' | null;
}

function ShapeMark({ s, className }: { s: Shape; className: string }) {
  const pts = s.verts.map(px);
  if (pts.length === 2) return <line x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} className={className + ' rod'} />;
  return <polygon points={pts.map((v) => `${v.x.toFixed(2)},${v.y.toFixed(2)}`).join(' ')} className={className} />;
}

export default function Board({ shape, mode, angle, p, settled, result }: BoardProps) {
  const clipId = useId().replace(/:/g, '');
  const s = SHAPES[shape];
  const avg = cutChance(s);

  const sh = angle === null ? null : shadow(s, angle);
  const share = sh ? (sh.hi - sh.lo) / 2 : avg;
  const inside = sh !== null && p !== null && p >= sh.lo && p <= sh.hi;
  const chordTone = p === null ? '' : inside ? 'good' : settled ? 'bad' : 'scan';
  const rot = angle === null ? '' : `translate(${C.x} ${C.y}) rotate(${deg(angle).toFixed(3)})`;

  return (
    <svg viewBox="0 0 400 420" className={'lc-board ' + mode} role="img" aria-label={`${s.name}: ${fmtChance(share)} chance the line cuts it`}>
      <defs>
        <clipPath id={clipId}>
          <circle cx={0} cy={0} r={R} />
        </clipPath>
      </defs>

      {/* The arena. */}
      <circle cx={C.x} cy={C.y} r={R} className="arena" />

      {/* The slab: every line in this direction that cuts the shape, drawn by its two edges. */}
      {sh && (
        <g transform={rot}>
          <g clipPath={`url(#${clipId})`}>
            <line x1={sh.lo * R} y1={-R} x2={sh.lo * R} y2={R} className="slab-edge" />
            <line x1={sh.hi * R} y1={-R} x2={sh.hi * R} y2={R} className="slab-edge" />
          </g>
        </g>
      )}

      {/* The ruler (a diameter) and the shape's shadow on it. */}
      {sh && (
        <g transform={rot}>
          <line x1={-R} y1={0} x2={R} y2={0} className="ruler" />
          <line x1={sh.lo * R} y1={0} x2={sh.hi * R} y2={0} className="shadow" />
        </g>
      )}

      {/* Your shape. */}
      <ShapeMark s={s} className={'shape' + (result ? ` ${result}` : '')} />

      {/* The line. */}
      {sh && p !== null && (
        <g transform={rot}>
          <line x1={p * R} y1={-halfChord(p)} x2={p * R} y2={halfChord(p)} className={'chord ' + chordTone + (settled ? ' settled' : '')} />
          <circle cx={p * R} cy={0} r={5} className={'cut-dot ' + chordTone} />
        </g>
      )}

      {/* The flat ruler: the same odds as a length (the round-over card sits here when the round ends). */}
      {mode !== 'over' && <FlatRuler s={s} lo={sh?.lo ?? null} hi={sh?.hi ?? null} p={p} settled={settled} chordTone={chordTone} />}
    </svg>
  );
}

function FlatRuler({
  s,
  lo,
  hi,
  p,
  settled,
  chordTone,
}: {
  s: Shape;
  /** The shadow's ends on the ruler, or null before the ruler has a direction. */
  lo: number | null;
  hi: number | null;
  p: number | null;
  settled: boolean;
  chordTone: string;
}) {
  const { x0, x1, y, h } = FB;
  const avg = cutChance(s);
  const aimed = lo !== null && hi !== null;
  // Before aiming, the average shadow sits in the middle of the ruler.
  const a = flatX(aimed ? Math.max(-1, lo) : -avg);
  const b = flatX(aimed ? Math.min(1, hi) : avg);

  return (
    <g className="flat">
      <rect x={x0} y={y} width={x1 - x0} height={h} rx={h / 2} className="bar" />
      <rect x={a} y={y} width={Math.max(1.5, b - a)} rx={2} height={h} className="bar-in" />
      {aimed && p !== null && (
        <g className={'needle ' + chordTone + (settled ? ' settled' : '')}>
          <line x1={flatX(p)} y1={y - 6} x2={flatX(p)} y2={y + h + 6} />
          <circle cx={flatX(p)} cy={y - 6} r={3.5} />
        </g>
      )}
    </g>
  );
}

/** Small glyphs for the shape chips. */
export function Glyph({ id }: { id: ShapeId }) {
  return (
    <svg viewBox="0 0 16 16" className="lc-glyph" aria-hidden="true">
      {id === 'pin' && <line x1={6.5} y1={9.5} x2={9.5} y2={6.5} className="g-rod" />}
      {id === 'triangle' && <polygon points="8,1.5 11,14 5,14" />}
      {id === 'square' && <rect x={3.5} y={3.5} width={9} height={9} transform="rotate(15 8 8)" />}
      {id === 'rod' && <line x1={2.5} y1={12.5} x2={13.5} y2={3.5} className="g-rod" />}
      {id === 'plank' && <rect x={0.8} y={5.6} width={14.4} height={4.8} transform="rotate(-17 8 8)" />}
    </svg>
  );
}
