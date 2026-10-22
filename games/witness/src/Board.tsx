import { useMemo, type CSSProperties } from 'react';
import { candidates, describe, isPrime, weight, winWeight, type Bet, type RangeIx, type TestResult } from './math';

const W = 520;
const H = 470;
const PAD = 10;
const TRACK = { y: 8, h: 54 };
const FIELD = { x: PAD, y: 104, w: W - 2 * PAD, h: 270 };
const BAR = { y: 404, h: 18 };

export type SlotState = 'sealed' | 'running' | 'pass' | 'witness' | 'unused';

export interface BoardProps {
  range: RangeIx;
  bet: Bet;
  tests: number;
  /** Passes so far (the posterior the dots show). */
  passes: number;
  /** Results so far, in order. Bases are only shown once the round is over. */
  results: TestResult[];
  /** Index of the test running now, or tests for the reveal, or null. */
  running: number | null;
  /** N once revealed (round over). */
  n: number | null;
  won: boolean;
  chance: number;
  scanMs: number;
}

/** Grid columns giving the largest pitch for n dots in a w × h box. */
function grid(n: number, w: number, h: number) {
  let best = { cols: n, rows: 1, pitch: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const pitch = Math.min(w / cols, h / rows);
    if (pitch > best.pitch) best = { cols, rows, pitch };
  }
  return best;
}

const pct = (p: number) => {
  if (p <= 0) return '0%';
  if (p >= 1) return '100%';
  const v = p * 100;
  return (v < 0.1 ? v.toPrecision(2) : v < 10 ? v.toFixed(2) : v.toFixed(1)) + '%';
};

const WIN_WORD: Record<Bet, string> = { prime: 'primes', composite: 'composites', fooled: 'composites that fool every test' };

export default function Board({ range, bet, tests, passes, results, running, n, won, chance, scanMs }: BoardProps) {
  const c = candidates(range);
  const g = useMemo(() => grid(c.n.length, FIELD.w, FIELD.h), [c]);
  const R0 = g.pitch * 0.44;
  const ox = FIELD.x + (FIELD.w - g.cols * g.pitch) / 2;
  const oy = FIELD.y + (FIELD.h - g.rows * g.pitch) / 2;
  const showNumbers = g.pitch >= 30;
  const over = n !== null;

  // The track: one slot per test, then the reveal.
  const slots = tests + 1;
  const gap = 8;
  const sw = (W - 2 * PAD - gap * (slots - 1)) / slots;
  const witnessAt = results.findIndex((t) => !t.pass);
  const slotState = (i: number): SlotState => {
    if (running === i) return 'running';
    if (i < tests) {
      const t = results[i];
      if (t) return t.pass ? 'pass' : 'witness';
      return over ? 'unused' : 'sealed';
    }
    return over && witnessAt < 0 && results.length === tests && n !== null ? 'pass' : over ? 'unused' : 'sealed';
  };
  const nPrime = n !== null && isPrime(n);

  const dots = c.n.map((num, i) => {
    const x = ox + (i % g.cols) * g.pitch + g.pitch / 2;
    const y = oy + Math.floor(i / g.cols) * g.pitch + g.pitch / 2;
    const w = weight(c, i, passes);
    const l = winWeight(c, i, bet, tests, passes);
    const r = R0 * Math.sqrt(w);
    const core = R0 * Math.sqrt(l);
    const full = l > 0 && l >= w - 1e-12;
    const isN = num === n;
    return (
      <g key={num} className={'cand' + (c.prime[i] ? ' pr' : ' co') + (isN ? ' is-n' : '')}>
        {w === 0 && <circle cx={x} cy={y} r={Math.max(1.2, R0 * 0.12)} className="ghost" />}
        <circle cx={x} cy={y} className={'dot' + (full ? ' lit' : w < 1 && w > 0 ? ' weak' : '') + (!full && l > 0 ? ' liar' : '')} style={{ r } as CSSProperties} />
        {!full && l > 0 && <circle cx={x} cy={y} className="dot lit core" style={{ r: core } as CSSProperties} />}
        {showNumbers && (
          <text x={x} y={y + 4} className={'num' + (full && r > 9 ? ' on-lit' : '') + (w < 0.05 ? ' gone' : '')}>
            {num}
          </text>
        )}
      </g>
    );
  });

  let nMark = null;
  if (n !== null) {
    const i = c.n.indexOf(n);
    const x = ox + (i % g.cols) * g.pitch + g.pitch / 2;
    const y = oy + Math.floor(i / g.cols) * g.pitch + g.pitch / 2;
    nMark = <circle cx={x} cy={y} r={Math.max(R0 + 4, 7)} className={'n-ring' + (won ? ' won' : ' lost')} />;
  }

  const barW = W - 2 * PAD;
  const head = over
    ? describe(n!)
    : `${c.n.length} odd numbers · ${c.primes} prime · N is one of them`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="witness" role="img" aria-label={`Win chance ${pct(chance)}`}>
      {Array.from({ length: slots }, (_, i) => {
        const st = slotState(i);
        const x = PAD + i * (sw + gap);
        const reveal = i === tests;
        const t = results[i];
        let sub = 'sealed base';
        if (reveal) sub = over && n !== null ? (st === 'pass' ? `N = ${n}` : 'not run') : 'after the tests';
        else if (st === 'running') sub = 'testing…';
        else if (st === 'pass') sub = over ? `a = ${t.base} · ${nPrime ? 'passes' : 'liar'}` : 'probably prime';
        else if (st === 'witness') sub = over ? `a = ${t.base} · witness` : 'witness!';
        else if (st === 'unused') sub = 'not run';
        return (
          <g key={i} className={`slot ${st}${reveal ? ' reveal' : ''}`}>
            <rect x={x} y={TRACK.y} width={sw} height={TRACK.h} rx={10} />
            <text x={x + sw / 2} y={TRACK.y + 22} className="slot-title">
              {reveal ? 'Reveal N' : `Test ${i + 1}`}
            </text>
            <text x={x + sw / 2} y={TRACK.y + 41} className="slot-sub">
              {sub}
            </text>
          </g>
        );
      })}

      <text x={W / 2} y={88} className={'head' + (over ? ' over' : '')}>
        {head}
      </text>

      <g className={'field' + (over ? ' settled' : '')}>{dots}</g>
      {nMark}
      {running !== null && running < tests && (
        <rect
          key={`scan-${running}`}
          x={FIELD.x}
          y={FIELD.y - 4}
          width={6}
          height={FIELD.h + 8}
          rx={3}
          className="scan"
          style={{ animationDuration: `${scanMs}ms` }}
        />
      )}

      <text x={PAD} y={BAR.y - 8} className="bar-label">
        {over ? 'Lit area when the round ended' : `Lit area = ${WIN_WORD[bet]}`}
      </text>
      <text x={W - PAD} y={BAR.y - 8} className="bar-value">
        {pct(chance)}
      </text>
      <rect x={PAD} y={BAR.y} width={barW} height={BAR.h} rx={BAR.h / 2} className="bar-track" />
      <rect x={PAD} y={BAR.y} width={Math.max(chance > 0 ? 3 : 0, barW * chance)} height={BAR.h} rx={BAR.h / 2} className="bar-fill" />

      <g className="legend" transform={`translate(${PAD}, ${H - 18})`}>
        <circle cx={6} cy={0} r={6} className="dot lit" />
        <text x={17} y={4}>
          wins your bet
        </text>
        <circle cx={124} cy={0} r={6} className="dot" />
        <text x={135} y={4}>
          loses it
        </text>
        {passes > 0 && (
          <>
            <circle cx={212} cy={0} r={4} className="dot weak" />
            <text x={222} y={4}>
              passed, shrunk
            </text>
          </>
        )}
        <text x={W - 2 * PAD} y={4} className="right">
          area ∝ chance it is N
        </text>
      </g>
    </svg>
  );
}
