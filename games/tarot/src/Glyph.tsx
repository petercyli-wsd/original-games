// Geometric glyphs for the arcana and the card back. Line art only, drawn in
// currentColor inside a -50…50 box, so every card shares one visual language.

import type { Arcana } from './math';

function starPoints(n: number, outer: number, inner: number, rot = -Math.PI / 2) {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (i * Math.PI) / n;
    pts.push(`${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

const STAR_8 = starPoints(8, 40, 15);
const STAR_4_SMALL = starPoints(4, 7, 2.2);

function rays(n: number, r1: number, r2: number, alt?: number) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i * 2 * Math.PI) / n;
    const outer = alt !== undefined && i % 2 === 1 ? alt : r2;
    return <line key={i} x1={r1 * Math.cos(a)} y1={r1 * Math.sin(a)} x2={outer * Math.cos(a)} y2={outer * Math.sin(a)} />;
  });
}

function GlyphShape({ arcana }: { arcana: Arcana }) {
  switch (arcana) {
    case 'tower':
      return (
        <>
          <path d="M-20 42 L-14 -14 H-19 V-32 H-11 V-24 H-4 V-32 H4 V-24 H11 V-32 H19 V-14 H14 L20 42 Z" className="tr-g-soft" />
          <path d="M-5 8 V0 A5 5 0 0 1 5 0 V8 Z" className="tr-g-fill" />
          <line x1={-16} y1={22} x2={16} y2={22} className="tr-g-thin" />
          <polyline points="40,-50 18,-20 32,-17 8,14" className="tr-g-bolt" />
        </>
      );
    case 'moon':
      return (
        <>
          <path d="M12 -30 A32 32 0 1 0 12 30 A36 36 0 0 1 12 -30 Z" className="tr-g-soft" />
          <polygon points={STAR_4_SMALL} transform="translate(30,-24)" className="tr-g-fill" />
          <polygon points={STAR_4_SMALL} transform="translate(34,18) scale(0.7)" className="tr-g-fill" />
        </>
      );
    case 'hermit':
      return (
        <>
          <line x1={0} y1={-44} x2={0} y2={-24} />
          <polygon points="0,-24 20,-12 20,14 0,26 -20,14 -20,-12" />
          <circle cx={0} cy={1} r={7} className="tr-g-fill" />
          <g className="tr-g-thin">{rays(8, 30, 38)}</g>
        </>
      );
    case 'temperance':
      return (
        <>
          <circle cx={-12} cy={0} r={22} />
          <circle cx={12} cy={0} r={22} />
          <line x1={-42} y1={0} x2={42} y2={0} className="tr-g-thin" />
          <circle cx={0} cy={0} r={4} className="tr-g-fill" />
        </>
      );
    case 'star':
      return (
        <>
          <polygon points={STAR_8} className="tr-g-soft" />
          <circle cx={0} cy={0} r={6} className="tr-g-fill" />
        </>
      );
    case 'chariot':
      return (
        <>
          <path d="M-30 -14 L0 -38 L30 -14" />
          <rect x={-28} y={-14} width={56} height={28} rx={4} />
          <circle cx={-17} cy={26} r={10} />
          <circle cx={17} cy={26} r={10} />
          <polygon points={STAR_4_SMALL} transform="translate(0,0)" className="tr-g-fill" />
        </>
      );
    case 'fortune':
      return (
        <>
          <circle cx={0} cy={0} r={36} />
          <circle cx={0} cy={0} r={24} className="tr-g-thin" />
          <circle cx={0} cy={0} r={8} className="tr-g-fill" />
          <g>{rays(8, 8, 36)}</g>
        </>
      );
    case 'sun':
      return (
        <>
          <circle cx={0} cy={0} r={17} className="tr-g-soft" />
          <g>{rays(16, 24, 42, 33)}</g>
        </>
      );
    case 'world':
      return (
        <>
          <ellipse cx={0} cy={0} rx={24} ry={36} />
          <ellipse cx={0} cy={0} rx={18} ry={30} className="tr-g-thin" />
          <polygon points="0,-12 9,0 0,12 -9,0" className="tr-g-fill" />
          <circle cx={-38} cy={-38} r={5} className="tr-g-fill" />
          <circle cx={38} cy={-38} r={5} className="tr-g-fill" />
          <circle cx={-38} cy={38} r={5} className="tr-g-fill" />
          <circle cx={38} cy={38} r={5} className="tr-g-fill" />
        </>
      );
  }
}

export function Glyph({ arcana, className }: { arcana: Arcana; className?: string }) {
  return (
    <svg viewBox="-50 -50 100 100" className={'tr-glyph' + (className ? ` ${className}` : '')} aria-hidden="true">
      <GlyphShape arcana={arcana} />
    </svg>
  );
}

/** The shared card back: nested diamonds around an eye, framed. */
export function CardBack() {
  return (
    <svg viewBox="0 0 100 160" className="tr-back-art" aria-hidden="true" preserveAspectRatio="none">
      <rect x={6} y={6} width={88} height={148} rx={7} className="tr-b-frame" />
      <rect x={11} y={11} width={78} height={138} rx={4} className="tr-b-frame thin" />
      <g transform="translate(50,80)">
        <polygon points="0,-58 36,0 0,58 -36,0" className="tr-b-line" />
        <polygon points="0,-42 26,0 0,42 -26,0" className="tr-b-line thin" />
        <path d="M-22 0 Q0 -16 22 0 Q0 16 -22 0 Z" className="tr-b-line" />
        <circle r={6} className="tr-b-dot" />
        <polygon points={starPoints(4, 6, 1.8)} transform="translate(0,-66)" className="tr-b-dot" />
        <polygon points={starPoints(4, 6, 1.8)} transform="translate(0,66)" className="tr-b-dot" />
        <circle cx={-30} cy={-50} r={1.8} className="tr-b-dot" />
        <circle cx={30} cy={-50} r={1.8} className="tr-b-dot" />
        <circle cx={-30} cy={50} r={1.8} className="tr-b-dot" />
        <circle cx={30} cy={50} r={1.8} className="tr-b-dot" />
      </g>
    </svg>
  );
}
