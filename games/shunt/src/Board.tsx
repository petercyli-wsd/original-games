import { allOrders, blocks, clearingOrders, topOf, wouldJam, type Yard } from './math';

// Knuth's railway, drawn literally. Cars come in from the right along the main
// line, reach the junction, and either drive straight on to the exit (top row,
// which must read 1, 2, 3, …) or back down into the siding, a dead-end stub
// that works last in, first out. The cars still to come wait in the yard on
// the right; the ones bigger than the siding's top car are red, because any
// of them arriving next would jam it.

const VW = 520;
const VH = 384;
const W = 40;
const H = 28;
const LINE_Y = 100;
const JX = 180;
const ENTRY_X = 484;
const SIDING_TOP = 142;
const SIDING_PITCH = 30;
const POOL_X = 318;
const POOL_Y = 170;
const EXIT_Y = 36;

export type FlyAt = 'entry' | 'junction';

export interface View {
  yard: Yard;
  /** A car on the move along the main line. */
  fly: { car: number; at: FlyAt } | null;
}

export interface BoardProps {
  view: View;
  /** Changes for every new round, so cars start fresh in the yard. */
  roundKey: number;
  legMs: number;
  live: boolean;
  over: boolean;
}

const slotX = (k: number) => 96 + (k - 1) * 46;
const sidingY = (n: number, i: number) => SIDING_TOP + (n - 2 - i) * SIDING_PITCH;
const poolPos = (idx: number) => ({ x: POOL_X + (idx % 4) * 48, y: POOL_Y + Math.floor(idx / 4) * 36 });

export default function Board({ view, roundKey, legMs, live, over }: BoardProps) {
  const { yard, fly } = view;
  const { n, stack, out, rest, jammed } = yard;
  const top = topOf(yard);
  const nextCar = out.length + 1;
  const red = rest.filter((c) => wouldJam(yard, c));
  const cleared = out.length === n;
  const sizes = blocks(yard);
  const sidingBottom = sidingY(n, 0) + H / 2 + 8;

  type Car = { car: number; x: number; y: number; cls: string };
  const cars: Car[] = [];
  out.forEach((c) => cars.push({ car: c, x: slotX(c), y: EXIT_Y, cls: 'out' }));
  stack.forEach((c, i) => cars.push({ car: c, x: JX, y: sidingY(n, i), cls: 'held' + (jammed !== null && i === stack.length - 1 ? ' blocked' : '') }));
  rest.forEach((c, i) => {
    const p = poolPos(i);
    cars.push({ car: c, x: p.x, y: p.y, cls: 'wait' + (wouldJam(yard, c) && !over ? ' red' : '') });
  });
  if (jammed !== null) cars.push({ car: jammed, x: JX, y: sidingY(n, stack.length), cls: 'jam' });
  if (fly) cars.push({ car: fly.car, x: fly.at === 'entry' ? ENTRY_X : JX, y: LINE_Y, cls: 'fly' });
  cars.sort((a, b) => a.car - b.car);

  const orders = clearingOrders(yard);
  const total = allOrders(yard);
  const risk = rest.length ? red.length / rest.length : 0;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="shunt" role="img" aria-label={`${out.length} of ${n} cars out, ${rest.length} still to come`}>
      {/* Exit row: the order the cars must leave in. */}
      <text x={20} y={EXIT_Y + 5} className="tag">
        EXIT
      </text>
      {Array.from({ length: n }, (_, i) => i + 1).map((k) => (
        <g key={k}>
          <rect x={slotX(k) - W / 2} y={EXIT_Y - H / 2} width={W} height={H} rx={6} className={'slot' + (live && k === nextCar && !cleared ? ' due' : '')} />
          <text x={slotX(k)} y={EXIT_Y + 5} className="slot-num">
            {k}
          </text>
        </g>
      ))}

      {/* Track: main line, exit ramp and the siding. */}
      <path d={`M ${ENTRY_X + 22} ${LINE_Y} H 46 Q 30 ${LINE_Y} 30 ${LINE_Y - 16} V 62`} className="rail" />
      <path d={`M 24 68 L 30 58 L 36 68`} className="rail-arrow" />
      <line x1={JX} y1={LINE_Y} x2={JX} y2={sidingBottom} className="rail" />
      <line x1={JX - 16} y1={sidingBottom} x2={JX + 16} y2={sidingBottom} className="buffer" />
      <circle cx={JX} cy={LINE_Y} r={5} className="switch" />
      <text x={VW - 12} y={LINE_Y - 20} className="tag end">
        IN
      </text>
      {Array.from({ length: n - 1 }, (_, i) => (
        <rect key={i} x={JX - W / 2} y={sidingY(n, i) - H / 2} width={W} height={H} rx={6} className="bay" />
      ))}

      {/* Siding notes, left of the stub. */}
      <text x={JX - 32} y={SIDING_TOP - 22} className="tag end">
        SIDING
      </text>
      {jammed !== null ? (
        <>
          <text x={JX - 32} y={sidingY(n, stack.length) + 5} className="note red end">
            {jammed} can't sit on {top}
          </text>
          <text x={JX - 32} y={sidingY(n, stack.length) + 23} className="note muted end">
            {top} must leave first
          </text>
        </>
      ) : over ? null : top !== null ? (
        <>
          <text x={JX - 32} y={sidingY(n, stack.length - 1) + 5} className="note end">
            top car {top}
          </text>
          <text x={JX - 32} y={sidingY(n, stack.length - 1) + 23} className="note red end">
            {top < n ? `cars above ${top} jam` : 'nothing can jam'}
          </text>
        </>
      ) : (
        <text x={JX - 32} y={SIDING_TOP + 5} className="note muted end">
          empty: no car can jam
        </text>
      )}

      {/* The yard: cars still to come, in an unknown order. */}
      {rest.length > 0 && (
        <text x={POOL_X - 20} y={POOL_Y - 30} className="tag">
          TO COME · ANY ORDER
        </text>
      )}

      {cars.map((c) => (
        <g
          key={`${roundKey}-${c.car}`}
          className={'car ' + c.cls}
          style={{ transform: `translate(${c.x}px, ${c.y}px)`, transitionDuration: `${legMs}ms` }}
        >
          <rect x={-W / 2} y={-H / 2} width={W} height={H} rx={6} />
          <text y={5}>{c.car}</text>
        </g>
      ))}

      {/* The odds, as counts. */}
      {rest.length > 0 && jammed === null && !over && (
        <g>
          <text x={POOL_X - 20} y={286} className={'note' + (red.length ? ' red' : ' green')}>
            {red.length ? `${red.length} of ${rest.length} would jam next` : `next car can't jam`}
          </text>
          <rect x={POOL_X - 20} y={296} width={192} height={8} rx={4} className="meter-bg" />
          {risk > 0 && <rect x={POOL_X - 20 + 192 * (1 - risk)} y={296} width={192 * risk} height={8} rx={4} className="meter-red" />}
          <text x={POOL_X - 20} y={328} className="note muted">
            orders that clear: {orders.toLocaleString('en-US')} of {total.toLocaleString('en-US')}
          </text>
          <text x={POOL_X - 20} y={348} className="note muted small">
            {sizes.filter((m) => m > 0).map((m) => `C${sub(m)}`).join(' × ')} = {orders.toLocaleString('en-US')} · Catalan per block
          </text>
        </g>
      )}
      {over && (
        <text x={POOL_X - 20} y={286} className={'note ' + (cleared ? 'green' : jammed !== null ? 'red' : 'muted')}>
          {cleared ? `all ${n} out in order` : jammed !== null ? `jammed with ${out.length} of ${n} out` : `stopped with ${out.length} of ${n} out`}
        </text>
      )}
    </svg>
  );
}

const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const sub = (m: number) => String(m).replace(/\d/g, (d) => SUBS[Number(d)]);
