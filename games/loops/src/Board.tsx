import { fmtChance } from '@originals/game-sdk/ui';
import { candidates, homeBox, lastChance, loopsOf, nextBox, openedInLoop, remaining, ruler, type Board as State } from './math';

// The ring: n boxes on a circle, and arrows (chords) from each opened box to
// the box it points at. The ruler below: one equal slot per possible final
// length of the current loop, the limit line, and the closed loops stacked in
// from the right. The green share of the lit slots is the win chance.

const VW = 400;
const VH = 470;
const CX = 200;
const CY = 180;
const RR = 148;
const RX0 = 14;
const RX1 = 386;
const RY = 384;
const RH = 40;

interface P {
  x: number;
  y: number;
}

const boxSize = (n: number) => Math.max(14, Math.min(42, ((2 * Math.PI * RR) / n) * 0.74));
const at = (i: number, n: number, r = RR): P => {
  const a = (i / n) * 2 * Math.PI;
  return { x: CX + r * Math.sin(a), y: CY - r * Math.cos(a) };
};
const f = (p: P) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;

/** Control point of the curved chord a → b: pulled toward the centre, so chords bow inward. */
function ctrl(a: P, b: P): P {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return { x: mx + (CX - mx) * 0.5, y: my + (CY - my) * 0.5 };
}

function unit(from: P, to: P): P {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

/** The arrow from box a to box b: a curve plus a filled head, both trimmed to the box edges. */
function arrow(a: number, b: number, n: number, s: number) {
  if (a === b) {
    const r0 = Math.max(5, s * 0.3);
    const c = at(a, n, RR - s / 2 - r0 + 1);
    return { d: `M ${f({ x: c.x, y: c.y - r0 })} a ${r0} ${r0} 0 1 1 -0.01 0`, head: null, self: true };
  }
  const A = at(a, n);
  const B = at(b, n);
  const C = ctrl(A, B);
  const ua = unit(A, C);
  const ub = unit(B, C);
  const inset = s * 0.56 + 1;
  const start = { x: A.x + ua.x * inset, y: A.y + ua.y * inset };
  const tip = { x: B.x + ub.x * inset, y: B.y + ub.y * inset };
  const h = Math.max(6, Math.min(9, s * 0.32));
  const back = { x: tip.x + ub.x * h, y: tip.y + ub.y * h };
  const w = h * 0.55;
  const p1 = { x: back.x - ub.y * w, y: back.y + ub.x * w };
  const p2 = { x: back.x + ub.y * w, y: back.y - ub.x * w };
  return { d: `M ${f(start)} Q ${f(C)} ${f(back)}`, head: `M ${f(tip)} L ${f(p1)} L ${f(p2)} Z`, self: false };
}

export interface Move {
  from: number;
  to: number;
  kind: 'close' | 'extend' | 'bust';
  ms: number;
  key: number;
}

export interface BoardProps {
  board: State;
  /** The whole permutation, shown faintly once the round is over. */
  reveal: readonly number[] | null;
  /** The arrow being drawn right now. */
  move: Move | null;
  /** The box the last arrow landed on (it pops). */
  landed: { box: number; key: number } | null;
  /** At a checkpoint: show the next box's targets. */
  showTargets: boolean;
  idle: boolean;
  winChance: number;
}

export default function Board({ board, reveal, move, landed, showTargets, idle, winChance }: BoardProps) {
  const { n, limit, status } = board;
  const s = boxSize(n);
  const R = remaining(board);
  const j = openedInLoop(board);
  const inLoop = board.chain.length > 0;
  const last = status === 'live' && lastChance(board);

  // Box roles.
  const loopOf = new Int16Array(n).fill(-1);
  board.loops.forEach((l, i) => l.forEach((x) => (loopOf[x] = i)));
  const inChain = new Uint8Array(n);
  board.chain.forEach((x) => (inChain[x] = 1));
  const targets = new Uint8Array(n);
  if (showTargets && status === 'live') for (const x of candidates(board)) targets[x] = 1;
  const home = status === 'live' ? homeBox(board) : -1;
  const head = status === 'live' ? nextBox(board) : -1;

  // Arrows already known.
  const known: { a: number; b: number; cls: string }[] = [];
  board.inside.forEach((t, a) => {
    if (t < 0) return;
    const cls = loopOf[a] >= 0 ? 'closed' : status === 'bust' ? 'bust' : 'chain';
    known.push({ a, b: t, cls });
  });
  // After the round: the rest of the shuffle, with any loop longer than the limit in red.
  const lenOf = new Int16Array(n);
  let longest = 0;
  if (reveal)
    for (const l of loopsOf(reveal)) {
      for (const x of l) lenOf[x] = l.length;
      longest = Math.max(longest, l.length);
    }
  const ghosts = reveal ? board.inside.flatMap((t, a) => (t < 0 ? [{ a, b: reveal[a], long: lenOf[a] > limit }] : [])) : [];

  // Ruler geometry: one cell per loop length 1..n.
  const cw = (RX1 - RX0) / n;
  const gap = Math.min(2, cw * 0.14);
  const cellX = (k: number) => RX0 + (k - 1) * cw + gap / 2;
  const limitX = RX0 + limit * cw;
  const slots = status === 'live' ? ruler(board) : [];

  const loopNo = board.loops.length + 1;
  const [left, leftTone] = idle
    ? [`FIRST LOOP · any length 1–${n}, equally likely`, '']
    : status === 'bust'
      ? [`LOOP ${loopNo} · ${j + 1} BOXES · TOO LONG`, 'red']
      : status === 'won'
        ? [`LAST ${R} BOXES · ALWAYS FIT`, 'green']
        : last
          ? [`LAST CHANCE · must close at ${j + 1}`, 'red']
          : inLoop
            ? [`LOOP ${loopNo} · ${j + 1} BOXES SO FAR`, '']
            : [`NEXT LOOP · ${R} boxes left`, ''];

  // Closed loops, stacked in from the right end of the ruler.
  let xr = RX1;
  const closed = board.loops.map((l) => {
    const w = l.length * cw;
    xr -= w;
    return { x: xr, w, len: l.length };
  });

  const centre = idle
    ? { big: `≤${limit}`, small: 'boxes in every loop' }
    : reveal
      ? { big: String(longest), small: `longest loop · limit ${limit}` }
      : inLoop
        ? { big: `${j + 1}`, small: `of ${limit} in this loop` }
        : { big: `${R}`, small: 'boxes left' };

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="loops" role="img" aria-label={`${n} boxes, every loop at most ${limit}. Win chance ${fmtChance(winChance)}.`}>
      <circle cx={CX} cy={CY} r={RR} className="track" />

      <g className={'centre' + (idle ? ' idle' : '') + (reveal && longest > limit ? ' over' : '')}>
        <text x={CX} y={CY + 6} className="big">
          {centre.big}
        </text>
        <text x={CX} y={CY + 30} className="small">
          {centre.small}
        </text>
      </g>

      {ghosts.map(({ a, b, long }) => {
        const g = arrow(a, b, n, s);
        return (
          <g key={`ghost-${a}`} className={'arrow ghost' + (long ? ' long' : '')}>
            <path d={g.d} />
            {g.head && <path d={g.head} className="head" />}
          </g>
        );
      })}

      {known.map(({ a, b, cls }) => {
        const g = arrow(a, b, n, s);
        return (
          <g key={`arrow-${a}`} className={`arrow ${cls}`}>
            <path d={g.d} />
            {g.head && <path d={g.head} className="head" />}
          </g>
        );
      })}

      {move &&
        (() => {
          const g = arrow(move.from, move.to, n, s);
          return (
            <g key={`move-${move.key}`} className={`arrow moving ${move.kind}`} style={{ ['--ms' as string]: `${move.ms}ms` }}>
              <path d={g.d} pathLength={1} className="draw" />
              {g.head && <path d={g.head} className="head" />}
            </g>
          );
        })()}

      {Array.from({ length: n }, (_, i) => {
        const p = at(i, n);
        let cls = 'box';
        if (loopOf[i] >= 0) cls += ' closed';
        else if (inChain[i]) cls += status === 'bust' ? ' bust' : ' chain';
        if (i === head && showTargets) cls += ' head';
        if (move && i === move.from) cls += ' opening';
        if (targets[i]) cls += i === home ? ' home' : last ? ' doom' : ' target';
        return (
          <g key={i} className={cls}>
            <rect x={p.x - s / 2} y={p.y - s / 2} width={s} height={s} rx={s * 0.26} />
            <text x={p.x} y={p.y + Math.min(17, s * 0.44) * 0.36} style={{ fontSize: Math.min(17, s * 0.44) }}>
              {i + 1}
            </text>
          </g>
        );
      })}
      {landed && (
        <rect
          key={`pop-${landed.key}`}
          x={at(landed.box, n).x - s / 2}
          y={at(landed.box, n).y - s / 2}
          width={s}
          height={s}
          rx={s * 0.26}
          className="pop"
        />
      )}

      {/* The loop ruler. */}
      <g className="ruler">
        <text x={RX0} y={RY - 16} className={'head-l ' + leftTone}>
          {left}
        </text>
        {closed.length > 0 && (
          <text x={RX1} y={RY - 16} className="head-r">
            CLOSED
          </text>
        )}

        {Array.from({ length: n }, (_, i) => (
          <rect key={`cell-${i}`} x={cellX(i + 1)} y={RY} width={cw - gap} height={RH} rx={Math.min(3, cw * 0.2)} className="cell" />
        ))}

        {/* Lengths this loop has already passed. */}
        {status === 'live' &&
          j > 0 &&
          Array.from({ length: j }, (_, i) => (
            <rect key={`pass-${i}`} x={cellX(i + 1)} y={RY} width={cw - gap} height={RH} rx={Math.min(3, cw * 0.2)} className="passed" />
          ))}

        {/* The lit slots: each final length equally likely. Green height = the rest fits too. */}
        {slots.map((sl) => {
          const x = cellX(sl.length);
          const w = cw - gap;
          if (sl.over) return <rect key={`slot-${sl.length}`} x={x} y={RY} width={w} height={RH} rx={Math.min(3, cw * 0.2)} className="slot over" />;
          return (
            <g key={`slot-${sl.length}`} className="slot fit">
              <rect x={x} y={RY} width={w} height={RH} rx={Math.min(3, cw * 0.2)} className="frame" />
              <rect x={x} y={RY + RH * (1 - sl.fit)} width={w} height={RH * sl.fit} className="fill" />
            </g>
          );
        })}

        {status === 'bust' &&
          Array.from({ length: j + 1 }, (_, i) => (
            <rect key={`bust-${i}`} x={cellX(i + 1)} y={RY} width={cw - gap} height={RH} rx={Math.min(3, cw * 0.2)} className="slot over" />
          ))}
        {status === 'won' &&
          R > 0 &&
          Array.from({ length: R }, (_, i) => (
            <rect key={`sure-${i}`} x={cellX(i + 1)} y={RY} width={cw - gap} height={RH} rx={Math.min(3, cw * 0.2)} className="slot sure" />
          ))}

        {closed.map((c, i) => (
          <g key={`closed-${i}`} className="done">
            <rect x={c.x + gap / 2} y={RY} width={c.w - gap} height={RH} rx={Math.min(4, cw * 0.3)} />
            {c.w >= 11 && (
              <text x={c.x + c.w / 2} y={RY + RH / 2 + 4}>
                {c.len}
              </text>
            )}
          </g>
        ))}

        {/* Where this loop stands now: the length it has if the next box points home. */}
        {status === 'live' && (
          <path
            d={`M ${f({ x: cellX(j + 1) + (cw - gap) / 2, y: RY - 2 })} l -5 -7 l 10 0 Z`}
            className={'caret' + (last ? ' last' : '')}
          />
        )}

        <line x1={limitX} x2={limitX} y1={RY - 6} y2={RY + RH + 3} className="limit" />
        <text x={Math.max(RX0 + 24, Math.min(RX1 - 24, limitX))} y={RY + RH + 18} className="limit-label">
          limit {limit}
        </text>

        <g className="legend">
          <rect x={RX0} y={VH - 19} width={10} height={10} rx={2} className="sw-green" />
          <text x={RX0 + 15} y={VH - 10} className="lg">
            green share = <tspan className="lg-p">{fmtChance(winChance)}</tspan> win chance
          </text>
          <text x={RX1 - 15} y={VH - 10} className="lg end">
            loop too long
          </text>
          <rect x={RX1 - 10} y={VH - 19} width={10} height={10} rx={2} className="sw-red" />
        </g>
      </g>
    </svg>
  );
}
