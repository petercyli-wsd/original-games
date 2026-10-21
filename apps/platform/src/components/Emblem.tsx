import type { Mechanic } from '@originals/game-sdk';

// One geometric glyph per maths family, drawn in the tile's accent colour.
const GLYPHS: Record<Mechanic, JSX.Element> = {
  mines: (
    <>
      {[0, 1, 2].flatMap((r) =>
        [0, 1, 2].map((c) => (
          <rect key={`${r}${c}`} x={5 + c * 10} y={5 + r * 10} width={8} height={8} rx={2} className={r === 1 && c === 2 ? 'em-on' : 'em-cell'} />
        )),
      )}
    </>
  ),
  crash: <path d="M5 33 C 15 31, 24 24, 33 6" className="em-line" />,
  'random-walk': <path d="M4 20 L9 15 L13 22 L18 12 L23 18 L28 9 L34 14" className="em-line" />,
  graph: (
    <>
      <path d="M8 28 L19 10 L31 26 Z M8 28 L31 26" className="em-line" />
      {[[8, 28], [19, 10], [31, 26]].map(([x, y]) => (
        <circle key={x} cx={x} cy={y} r={3.6} className="em-on" />
      ))}
    </>
  ),
  urn: (
    <>
      <path d="M10 8 h18 l-2 24 a3 3 0 0 1 -3 3 h-8 a3 3 0 0 1 -3 -3 Z" className="em-stroke" />
      <circle cx={16} cy={26} r={3} className="em-on" />
      <circle cx={23} cy={22} r={3} className="em-fill" />
    </>
  ),
  geometry: (
    <>
      <circle cx={19} cy={19} r={13} className="em-stroke em-dim" />
      <path d="M19 6 A13 13 0 0 1 32 19" className="em-line" />
      <path d="M19 19 L27 11" className="em-line" />
    </>
  ),
  combinatorics: (
    <>
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={10 + i * 9} cy={12} r={3.4} className={i === 1 ? 'em-on' : 'em-fill'} />
      ))}
      <path d="M10 27 C 14 19, 24 19, 28 27" className="em-line" />
    </>
  ),
  'number-theory': (
    <>
      {[0, 1, 2, 3].flatMap((r) =>
        [0, 1, 2, 3].map((c) => (
          <circle key={`${r}${c}`} cx={8 + c * 7.3} cy={8 + r * 7.3} r={2.2} className={(r + 1) % (c + 1) && (c + 1) % (r + 1) ? 'em-on' : 'em-cell'} />
        )),
      )}
    </>
  ),
  process: (
    <>
      <path d="M19 32 L19 22 M19 22 L11 13 M19 22 L27 13 M11 13 L7 6 M11 13 L15 6" className="em-line" />
      <circle cx={27} cy={13} r={3} className="em-on" />
    </>
  ),
  inference: (
    <>
      <path d="M5 31 C 12 31, 14 9, 19 9 C 24 9, 26 31, 33 31" className="em-line" />
      <path d="M19 9 L19 31" className="em-stroke em-dim" />
    </>
  ),
  duel: (
    <>
      <path d="M8 30 L30 8 M8 8 L30 30" className="em-line" />
      <circle cx={19} cy={19} r={4} className="em-on" />
    </>
  ),
  other: <rect x={9} y={9} width={20} height={20} rx={5} className="em-stroke" />,
};

export function Emblem({ mechanic }: { mechanic: Mechanic }) {
  return (
    <div className="tile-emblem">
      <svg viewBox="0 0 38 38" aria-hidden="true">
        {GLYPHS[mechanic]}
      </svg>
    </div>
  );
}
