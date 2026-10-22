import { fmtChance } from '@originals/game-sdk/ui';
import { perimeter, type Side } from './math';

const W = 400;
const G = 300; // grid size
const X0 = (W - G) / 2;
const Y0 = 8;

export interface BoardProps {
  n: number;
  k: number;
  /** Seeds that have landed, in order. */
  seeds: number[];
  /** Infected cells on screen (seeds plus spread). */
  infected: number;
  /** The wave that just spread, for a flash. */
  fresh: number;
  /** The seed in flight, before it lands. */
  landing: number | null;
  /** Chance the grid ends full, for the split bar. */
  pFull: number;
  side: Side;
  /** Over: whether the grid ended full. */
  finalFull: boolean | null;
  live: boolean;
}

/** The infected set's boundary: every edge between an infected cell and a healthy one or the grid's edge. */
function perimeterPath(S: number, n: number, cell: number): string {
  let d = '';
  const inf = (r: number, c: number) => r >= 0 && r < n && c >= 0 && c < n && (S & (1 << (r * n + c))) !== 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!inf(r, c)) continue;
      const x = X0 + c * cell;
      const y = Y0 + r * cell;
      if (!inf(r - 1, c)) d += `M${x} ${y}h${cell}`;
      if (!inf(r + 1, c)) d += `M${x} ${y + cell}h${cell}`;
      if (!inf(r, c - 1)) d += `M${x} ${y}v${cell}`;
      if (!inf(r, c + 1)) d += `M${x + cell} ${y}v${cell}`;
    }
  }
  return d;
}

export default function Board({ n, k, seeds, infected, fresh, landing, pFull, side, finalFull, live }: BoardProps) {
  const cell = G / n;
  const per = perimeter(infected, n);
  const left = k - seeds.length - (landing !== null ? 1 : 0);
  const need = 4 * n;
  const total = per + 4 * left;
  const short = total < need;

  // Budget bar: 0 … 4k edges.
  const BX = 40;
  const BW = 320;
  const scale = BW / (4 * k);
  const BY = Y0 + G + 34;

  // Split bar: Full grid share on the left, Not full on the right.
  const SY = BY + 66;
  const fullW = BW * pFull;
  const yours = side === 'full' ? 'left' : 'right';

  return (
    <svg viewBox={`0 0 ${W} ${SY + 44}`} className="bs" role="img" aria-label={`Perimeter ${per}, budget ${total} of ${need} needed`}>
      {/* the grid */}
      {Array.from({ length: n * n }, (_, i) => {
        const r = Math.floor(i / n);
        const c = i % n;
        const on = (infected & (1 << i)) !== 0;
        const isSeed = seeds.includes(i);
        const cls = 'cell' + (on ? (isSeed ? ' seed' : ' sick') : '') + ((fresh & (1 << i)) !== 0 ? ' fresh' : '') + (landing === i ? ' landing' : '');
        return <rect key={i} x={X0 + c * cell + 3} y={Y0 + r * cell + 3} width={cell - 6} height={cell - 6} rx={6} className={cls} />;
      })}
      {seeds.map((i, j) => (
        <text key={i} x={X0 + (i % n) * cell + cell / 2} y={Y0 + Math.floor(i / n) * cell + cell / 2 + 6} className="seed-no">
          {j + 1}
        </text>
      ))}
      {landing !== null && (
        <circle cx={X0 + (landing % n) * cell + cell / 2} cy={Y0 + Math.floor(landing / n) * cell + cell / 2} r={cell * 0.3} className="drop" />
      )}
      <path d={perimeterPath(infected, n, cell)} className="perim" />
      {finalFull === true && <rect x={X0} y={Y0} width={G} height={G} rx={4} className="frame won" />}

      {/* perimeter budget: now + 4 per seed left, against the 4n the full grid needs */}
      <text x={BX} y={BY - 10} className="lbl">
        Perimeter budget
      </text>
      <text x={BX + BW} y={BY - 10} className={'lbl end' + (short ? ' bad' : '')}>
        {per} + 4 × {left} = {total} {short ? '<' : '≥'} {need} needed
      </text>
      <rect x={BX} y={BY} width={BW} height={16} rx={3} className="track" />
      <rect x={BX} y={BY} width={Math.min(BW, per * scale)} height={16} rx={3} className={'b-now' + (short ? ' bad' : '')} />
      <rect x={BX + per * scale} y={BY} width={Math.max(0, Math.min(BW - per * scale, 4 * left * scale))} height={16} className={'b-left' + (short ? ' bad' : '')} />
      {Array.from({ length: left }, (_, j) => (
        <line key={j} x1={BX + (per + 4 * (j + 1)) * scale} x2={BX + (per + 4 * (j + 1)) * scale} y1={BY} y2={BY + 16} className="tick" />
      ))}
      <line x1={BX + need * scale} x2={BX + need * scale} y1={BY - 4} y2={BY + 22} className="need" />
      <text x={BX + need * scale} y={BY + 34} className="lbl mid">
        full grid = {need}
      </text>

      {/* the odds, as a split */}
      <text x={BX} y={SY - 8} className={'lbl' + (yours === 'left' ? ' you' : '')}>
        Full grid {fmtChance(pFull)}
        {yours === 'left' ? ' · your bet' : ''}
      </text>
      <text x={BX + BW} y={SY - 8} className={'lbl end' + (yours === 'right' ? ' you' : '')}>
        {yours === 'right' ? 'your bet · ' : ''}Not full {fmtChance(1 - pFull)}
      </text>
      <rect x={BX} y={SY} width={BW} height={16} rx={3} className={'split ' + (yours === 'right' ? 'win' : 'lose')} />
      <rect x={BX} y={SY} width={fullW} height={16} rx={3} className={'split ' + (yours === 'left' ? 'win' : 'lose')} />
      {live && fullW > 1 && fullW < BW - 1 && <line x1={BX + fullW} x2={BX + fullW} y1={SY - 3} y2={SY + 19} className="cut" />}
    </svg>
  );
}
