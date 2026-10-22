import { COLS, LAST_SQUARE, SQUARES, type Die, type FaceKind } from './math';

/** Cell pitch and size in viewBox units. */
const P = 48;
const S = 42;
const ROWS = SQUARES / COLS;
const W = COLS * P;
const GRID_H = ROWS * P;
const STRIP_Y = GRID_H + 12;
const FACE_H = 34;
const H = STRIP_Y + FACE_H + 2;

/** Top-left corner of square n on the serpentine (rows alternate direction). */
function corner(n: number) {
  const m = Math.min(Math.max(n, 0), LAST_SQUARE);
  const row = Math.floor(m / COLS);
  const k = m % COLS;
  const col = row % 2 === 0 ? k : COLS - 1 - k;
  return { x: col * P + (P - S) / 2, y: row * P + (P - S) / 2 };
}
const centre = (n: number) => {
  const c = corner(n);
  return { x: c.x + S / 2, y: c.y + S / 2 };
};

/** The serpentine through squares a..b, as polyline points. */
const trackPoints = (a: number, b: number) =>
  Array.from({ length: b - a + 1 }, (_, i) => centre(a + i))
    .map(({ x, y }) => `${x},${y}`)
    .join(' ');

/** Compact percentage for the small gate labels. */
function pct(p: number) {
  const v = p * 100;
  if (v >= 9.95) return `${Math.round(v)}%`;
  if (v >= 0.995) return `${v.toFixed(1)}%`;
  if (v >= 0.0995) return `${v.toFixed(2)}%`;
  return `${v.toPrecision(1)}%`;
}

export interface BoardProps {
  die: Die;
  gates: readonly number[];
  /** Index of the next gate; earlier gates are landed. */
  next: number;
  /** The square the odds are measured from. */
  pos: number;
  /** Where the token is drawn: it hops square by square during a roll. */
  tokenAt: number;
  hopMs: number;
  /** Chance of landing on each square (alive); null hides the bars. */
  profile: Float64Array | null;
  /** The die's faces for the roll shown in the strip. */
  faces: FaceKind[];
  /** The face lit on the die, if any. */
  face: number | null;
  /** Squares the token touched down on. */
  landed: readonly number[];
  /** Index of the gate the token jumped over, if it busted. */
  missed: number | null;
  /** Highlight the squares the next roll can reach. */
  showReach: boolean;
  /** Whether a round is in play (the next gate pulses). */
  live: boolean;
  /** Hide the die strip (the round-over card sits there). */
  hideDie: boolean;
  rolling: boolean;
  onPick?: (square: number) => void;
}

export default function Board({ die, gates, next, pos, tokenAt, hopMs, profile, faces, face, landed, missed, showReach, live, hideDie, rolling, onPick }: BoardProps) {
  const last = gates[gates.length - 1];
  const touched = new Set(landed);
  const tok = centre(tokenAt);
  const offTrack = tokenAt > LAST_SQUARE;
  const over = faces.filter((k) => k === 'over').length;
  const hasGate = faces.includes('gate');

  // Faces sit between the die's name (left) and the summary (right).
  const pitch = die === 10 ? 36 : 44;
  const fx0 = 40 + (W - 120 - die * pitch) / 2;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="landing"
      role="img"
      aria-label={`Token on square ${pos}; ${gates.length} gate${gates.length > 1 ? 's' : ''} at ${gates.join(', ')}`}
    >
      <polyline points={trackPoints(0, last)} className="track" />
      {last < LAST_SQUARE && <polyline points={trackPoints(last, LAST_SQUARE)} className="track runoff" />}

      {Array.from({ length: SQUARES }, (_, n) => {
        const { x, y } = corner(n);
        const gi = gates.indexOf(n);
        const isGate = gi >= 0;
        const p = profile && n > pos ? profile[n] : 0;
        const reachIdx = showReach ? n - pos - 1 : -1;
        const reach: FaceKind | null = reachIdx >= 0 && reachIdx < faces.length ? faces[reachIdx] : null;
        const label = !isGate ? '' : gi === missed ? '✕' : gi < next ? '✓' : profile ? pct(profile[n]) : '';
        const gateState = !isGate ? '' : gi === missed ? ' missed' : gi < next ? ' cleared' : gi === next && live ? ' next' : ' ahead';
        const cls =
          'sq' +
          (n < pos ? ' passed' : '') +
          (n > last && !(missed !== null && n <= tokenAt) ? ' runoff' : '') +
          (isGate ? ' gate' + gateState : '') +
          (onPick && n > 0 && !isGate ? ' pickable' : '');
        return (
          <g key={n} data-sq={n} className={cls} onClick={onPick && n > 0 ? () => onPick(n) : undefined}>
            <rect x={x} y={y} width={S} height={S} rx={6} className="cell" />
            {p > 0 && <rect x={x + 3} y={y + S - 3 - p * (S - 6)} width={S - 6} height={p * (S - 6)} rx={2} className="bar" />}
            {reach && <rect x={x + 1.5} y={y + 1.5} width={S - 3} height={S - 3} rx={5} className={`reach ${reach}`} />}
            <text x={x + 4} y={y + 11} className="num">
              {n}
            </text>
            {isGate && (
              <>
                <rect x={x - 1} y={y - 1} width={S + 2} height={S + 2} rx={7} className="gate-ring" />
                <path d={`M ${x + S - 13} ${y - 1} H ${x + S + 1} V ${y + 13} Z`} className="gate-flag" />
                <text x={x + S / 2} y={y + S / 2 + 6} className={'gate-label' + (label.length > 5 ? ' long' : '')}>
                  {label}
                </text>
              </>
            )}
            {touched.has(n) && n !== tokenAt && <circle cx={x + S / 2} cy={y + S / 2 + (isGate ? 13 : 0)} r={3.5} className="dot" />}
          </g>
        );
      })}

      <g className={'token' + (missed !== null && !rolling ? ' bust' : '') + (offTrack ? ' off' : '')} style={{ transform: `translate(${tok.x}px, ${tok.y}px)`, transitionDuration: `${hopMs}ms` }}>
        <circle key={tokenAt} r={11} className="hop" style={{ animationDuration: `${hopMs}ms` }} />
      </g>

      {/* The die: one cell per face, each worth 1/d. Red faces jump the gate, green lands on it. */}
      <g className="die" style={{ visibility: hideDie ? 'hidden' : 'visible' }}>
        <text x={0} y={STRIP_Y + FACE_H / 2 + 5} className="die-name">
          d{die}
        </text>
        {faces.map((k, i) => (
          <g key={i} className={`face ${k}` + (face === i + 1 ? ' lit' : face !== null ? ' dim' : '')}>
            <rect x={fx0 + i * pitch + 3} y={STRIP_Y} width={pitch - 6} height={FACE_H} rx={7} />
            <text x={fx0 + i * pitch + pitch / 2} y={STRIP_Y + FACE_H / 2 + 5}>
              {i + 1}
            </text>
          </g>
        ))}
        {faces.length > 0 && (
          <>
            <text x={W} y={STRIP_Y + FACE_H / 2 - 2} className={'die-sum' + (over ? ' risk' : ' safe')}>
              {over ? `${over}/${die} over` : 'all safe'}
            </text>
            <text x={W} y={STRIP_Y + FACE_H / 2 + 12} className={'die-sub' + (hasGate ? ' hit' : '')}>
              {hasGate ? `1/${die} lands` : `gate ${gates[next] - pos} away`}
            </text>
          </>
        )}
      </g>
    </svg>
  );
}
