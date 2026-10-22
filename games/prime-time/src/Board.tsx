import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { BET_PLURAL, coreScale, matches, placeName, valuesAt, type Bet, type Cell, type FanStat, type GridView } from './math';

// Two arrangements, in viewBox units: "wide" puts the digits and the fan
// beside a large dot field (desktop), "tall" stacks them (narrow frames).
interface Geo {
  wide: boolean;
  W: number;
  H: number;
  /** Centre of the tile row. */
  cx: number;
  tw: number;
  th: number;
  tg: number;
  tileY: number;
  fanH: number;
  fanBase: number;
  grid: { x: number; y: number; w: number; h: number };
  /** The labelled fan for the marked digit (wide only). */
  detail: { x: number; y: number; w: number; h: number } | null;
  legendY: number;
  legendX: number;
  /** Where the round-over card sits (wide only; tall boards use the kit's bottom placement). */
  overlay: { x: number; y: number; w: number; h: number } | null;
}

const TALL: Geo = {
  wide: false,
  W: 440,
  H: 548,
  cx: 220,
  tw: 62,
  th: 72,
  tg: 12,
  tileY: 26,
  fanH: 22,
  fanBase: 26 + 72 + 12 + 22,
  grid: { x: 8, y: 182, w: 424, h: 336 },
  detail: null,
  legendY: 540,
  legendX: 8,
  overlay: null,
};

const WIDE: Geo = {
  wide: true,
  W: 800,
  H: 480,
  cx: 150,
  tw: 52,
  th: 64,
  tg: 10,
  tileY: 26,
  fanH: 24,
  fanBase: 26 + 64 + 12 + 24,
  grid: { x: 330, y: 4, w: 470, h: 472 },
  detail: { x: 8, y: 196, w: 284, h: 120 },
  legendY: 456,
  legendX: 8,
  overlay: { x: 0, y: 136, w: 316, h: 214 },
};

const BLOCK_GAP = 12;
const LABEL_BAND = 15;
const MAX_PITCH = 42;
/** Lit cores smaller than this (as a share of the dot's radius) get a ring so they can be found. */
const FAINT = 0.22;

export interface TileView {
  pos: number;
  value: number | null;
  /** hidden: not shown yet; shown: opened in play; rolling: being revealed; auto: shown after the round ended. */
  state: 'hidden' | 'shown' | 'rolling' | 'auto';
}

export interface BoardProps {
  digits: number;
  bet: Bet;
  tiles: TileView[];
  /** The hidden digit that opens next (Space / the reveal button). */
  pointer: number | null;
  pointerLabel: string;
  /** Click handler for hidden tiles; leave out when tiles can't be picked. */
  onTile?: (pos: number) => void;
  /** One per hidden digit: how its reveal could move the odds. */
  fans: FanStat[];
  chance: number;
  view: GridView;
  /** Fade the dots in (a fresh grid rather than dots moving into place). */
  enter: boolean;
  /** The round is over and the dimmed dots are the neighbours N could have been: dim them less. */
  settled?: boolean;
  /** N, ringed once the round is over. */
  target: number | null;
  targetWins: boolean;
  verdict: string | null;
  candidates: number;
  winners: number;
  rollMs: number;
  moveMs: number;
  /** The round-over card, given whether the board is in its wide arrangement. */
  overlay?: (wide: boolean) => ReactNode;
}

/** Place names that fit inside a tile. */
const TILE_PLACE = ['units', 'tens', 'hundreds', 'thousands', '10 000s'];
const tilePlace = (digits: number, pos: number) => TILE_PLACE[digits - 1 - pos];

const tileX = (g: Geo, digits: number, pos: number) => g.cx - (digits * g.tw + (digits - 1) * g.tg) / 2 + pos * (g.tw + g.tg);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmtPct = (p: number) => {
  if (p <= 0) return '0%';
  if (p >= 1) return '100%';
  const v = p * 100;
  return (v < 1 ? v.toPrecision(2) : v < 10 ? v.toFixed(2) : v.toFixed(1)) + '%';
};
const fmtN = (n: number) => n.toLocaleString('en-US');
/** Compact percentages for the detail bars: 40%, 4.4%, 0.44%. */
const shortPct = (c: number) => {
  const v = c * 100;
  return (v >= 9.95 ? Math.round(v).toString() : v >= 0.995 ? v.toFixed(1) : v.toFixed(2)) + '%';
};

interface Placed {
  cell: Cell;
  x: number;
  y: number;
}

interface Layout {
  pitch: number;
  placed: Placed[];
  blocks: { x: number; y: number; w: number; h: number; label: string }[];
}

/** Arranges the blocks (in whichever number of rows gives the biggest dots) and the dots inside them, centred in the grid area. */
function layout(g: Geo, view: GridView): Layout {
  const { grid } = g;
  const nb = view.blocks;
  const gap = nb > 1 ? BLOCK_GAP : 0;
  const band = nb > 1 ? LABEL_BAND : 0;
  let best = { bc: 1, br: nb, pitch: 0 };
  for (let bc = 1; bc <= nb; bc++) {
    const br = Math.ceil(nb / bc);
    const pitch = Math.min((grid.w - (bc - 1) * gap) / (bc * view.cols), (grid.h - br * band - (br - 1) * 4) / (br * view.rows));
    if (pitch > best.pitch + 1e-9) best = { bc, br, pitch };
  }
  const pitch = Math.min(best.pitch, MAX_PITCH);
  const bw = view.cols * pitch;
  const bh = view.rows * pitch;
  const totalH = best.br * (bh + band) + (best.br - 1) * 4;
  // Wide boards centre the dots; tall ones keep them near the top, clear of the round-over card.
  const y0 = grid.y + (g.wide ? (grid.h - totalH) / 2 : Math.min(8, (grid.h - totalH) / 2));
  const origin = (b: number) => {
    const row = Math.floor(b / best.bc);
    const inRow = Math.min(best.bc, nb - row * best.bc);
    const rowW = inRow * bw + (inRow - 1) * gap;
    return { x: grid.x + (grid.w - rowW) / 2 + (b % best.bc) * (bw + gap), y: y0 + row * (bh + band + 4) + band };
  };
  const blocks: Layout['blocks'] = [];
  const placed = view.cells.map((cell) => {
    const o = origin(cell.block);
    if (nb > 1 && cell.row === 0 && cell.col === 0) {
      const label = cell.pattern.map((v, i) => (i === view.row || i === view.col || view.folded.includes(i) || v === null ? '·' : v)).join('');
      blocks.push({ x: o.x, y: o.y, w: bw, h: bh, label });
    }
    return { cell, x: o.x + (cell.col + 0.5) * pitch, y: o.y + (cell.row + 0.5) * pitch };
  });
  return { pitch, placed, blocks };
}

function Reel({ g, pos, value, x, ms }: { g: Geo; pos: number; value: number; x: number; ms: number }) {
  const vals = valuesAt(pos);
  const k = vals.length;
  const at = vals.indexOf(value);
  const L = 16;
  const strip = Array.from({ length: L }, (_, i) => vals[(((at - (L - 1 - i)) % k) + k) % k]);
  return (
    <g clipPath={`url(#pt-clip-${pos})`}>
      <g className="reel" style={{ '--to': `${-(L - 1) * g.th}px`, animationDuration: `${ms}ms` } as CSSProperties}>
        {strip.map((v, i) => (
          <text key={i} x={x + g.tw / 2} y={g.tileY + g.th / 2 - 4 + i * g.th} className="digit">
            {v}
          </text>
        ))}
      </g>
    </g>
  );
}

/** One bar per value the digit could show: the win chance after it (red tick = bust, green = sure win). */
function Bars({ f, x, w, base, h, pmax, gap }: { f: FanStat; x: number; w: number; base: number; h: number; pmax: number; gap: number }) {
  const bw = w / f.values.length;
  return (
    <>
      {f.chances.map((c, i) => {
        const bx = x + i * bw + gap / 2;
        const width = bw - gap;
        if (c === 0) return <rect key={i} x={bx} y={base - 3} width={width} height={3} className="bar bust" />;
        const bh = Math.max(1.5, (h * c) / pmax);
        return <rect key={i} x={bx} y={base - bh} width={width} height={bh} className={'bar' + (c === 1 ? ' sure' : '')} />;
      })}
    </>
  );
}

function Fan({ g, f, digits, pmax, chance }: { g: Geo; f: FanStat; digits: number; pmax: number; chance: number }) {
  const x = tileX(g, digits, f.pos);
  const nowY = g.fanBase - (g.fanH * chance) / pmax;
  const ly = g.fanBase + 13;
  return (
    <g className="fan">
      <rect x={x} y={g.fanBase - g.fanH} width={g.tw} height={g.fanH} className="fan-bg" rx={2} />
      <Bars f={f} x={x} w={g.tw} base={g.fanBase} h={g.fanH} pmax={pmax} gap={1.2} />
      <line x1={x - 2} x2={x + g.tw + 2} y1={nowY} y2={nowY} className="now" />
      {f.bust > 0 && f.sure > 0 ? (
        <>
          <text x={x + g.tw / 2} y={ly} className="fan-label bust">
            {pct(f.bust)} bust
          </text>
          <text x={x + g.tw / 2} y={ly + 12} className="fan-label sure">
            {pct(f.sure)} win
          </text>
        </>
      ) : (
        <text x={x + g.tw / 2} y={ly} className={'fan-label' + (f.bust > 0 ? ' bust' : f.sure > 0 ? ' sure' : '')}>
          {f.bust > 0 ? `${pct(f.bust)} bust` : f.sure > 0 ? `${pct(f.sure)} win` : 'no bust'}
        </text>
      )}
    </g>
  );
}

/** The marked digit's fan, large and labelled value by value. */
function Detail({ g, f, digits, pmax, chance }: { g: Geo; f: FanStat; digits: number; pmax: number; chance: number }) {
  const box = g.detail!;
  const top = box.y + 30;
  const base = box.y + box.h - 18;
  // Bars stop short of the top so every value label sits above its bar.
  const h = base - top - 14;
  const bw = box.w / f.values.length;
  const nowY = base - (h * chance) / pmax;
  return (
    <g className="detail">
      <text x={box.x} y={box.y + 8} className="detail-title start">
        If the {placeName(digits, f.pos)} digit opens next
      </text>
      <rect x={box.x} y={top} width={box.w} height={base - top} className="fan-bg" rx={3} />
      <Bars f={f} x={box.x} w={box.w} base={base} h={h} pmax={pmax} gap={6} />
      {f.chances.map((c, i) => (
        <g key={i}>
          <text x={box.x + (i + 0.5) * bw} y={base + 13} className="detail-digit">
            {f.values[i]}
          </text>
          <text
            x={box.x + (i + 0.5) * bw}
            y={c === 0 ? base - 7 : base - Math.max(1.5, (h * c) / pmax) - 4}
            className={'detail-val' + (c === 0 ? ' bust' : c === 1 ? ' sure' : '')}
          >
            {c === 0 ? '✕' : c === 1 ? '✓' : shortPct(c)}
          </text>
        </g>
      ))}
      <line x1={box.x - 3} x2={box.x + box.w + 3} y1={nowY} y2={nowY} className="now" />
      <text x={box.x + box.w} y={box.y + 22} className="detail-note end">
        bars average to the dashed line: {fmtPct(chance)} now
      </text>
    </g>
  );
}

export default function Board(props: BoardProps) {
  const {
    digits,
    bet,
    tiles,
    pointer,
    pointerLabel,
    onTile,
    fans,
    chance,
    view,
    enter,
    settled,
    target,
    targetWins,
    verdict,
    candidates,
    winners,
    rollMs,
    moveMs,
    overlay,
  } = props;

  // Pick the arrangement from the space the board has, and find where the
  // overlay region lands on screen (the SVG is letterboxed inside the board).
  const svg = useRef<SVGSVGElement>(null);
  const [wide, setWide] = useState(false);
  const [box, setBox] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    const el = svg.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const measure = () => {
      const w = host.clientWidth >= 720;
      setWide(w);
      const geo = w ? WIDE : TALL;
      const o = geo.overlay;
      if (!o) return setBox(null);
      const s = el.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      const scale = Math.min(s.width / geo.W, s.height / geo.H);
      const ox = s.left - h.left + (s.width - geo.W * scale) / 2;
      const oy = s.top - h.top + (s.height - geo.H * scale) / 2;
      setBox({ left: ox + o.x * scale, top: oy + o.y * scale, width: o.w * scale, height: o.h * scale });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const g = wide ? WIDE : TALL;

  const { pitch, placed, blocks } = layout(g, view);
  const r = pitch * (pitch >= 26 ? 0.44 : 0.4);
  const folded = view.size > 1;
  const labelled = pitch >= 26;
  const numFont = Math.min(12.5, (pitch * 0.92) / (digits * 0.6));
  const pmax = Math.max(chance, ...fans.flatMap((f) => f.chances)) || 1;
  const ringed = target !== null ? placed.find((p) => matches(p.cell.pattern, target)) : undefined;
  const plural = BET_PLURAL[bet];
  const singular = plural.replace(/s$/, '');
  const marked = fans.find((f) => f.pos === pointer);

  const key = (pos: number) => (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onTile?.(pos);
    }
  };

  // A ring marks a dot whose winners are too few for its lit core to show.
  const ringedDot = (c: Cell) => folded && c.hits > 0 && coreScale(c) < FAINT;
  const anyRing = placed.some((p) => ringedDot(p.cell));
  const legend = folded
    ? [`each dot = ${fmtN(view.size)} numbers`, `lit area = their share of ${plural}` + (anyRing ? ' · ring = a few' : '')]
    : [`each dot = one number · lit = ${singular}`];

  return (
    <>
      <svg
        ref={svg}
        viewBox={`0 0 ${g.W} ${g.H}`}
        className={'pt' + (g.wide ? ' wide' : ' tall')}
        role="group"
        aria-label={`${winners} ${plural} among ${candidates} candidates`}
        style={{ '--move': `${moveMs}ms` } as CSSProperties}
      >
        <defs>
          {tiles.map((t) => (
            <clipPath key={t.pos} id={`pt-clip-${t.pos}`}>
              <rect x={tileX(g, digits, t.pos)} y={g.tileY + 2} width={g.tw} height={g.th - 20} />
            </clipPath>
          ))}
        </defs>

        {/* The hidden number, one tile per digit. */}
        {tiles.map((t) => {
          const x = tileX(g, digits, t.pos);
          const ptr = pointer === t.pos && t.state === 'hidden';
          const clickable = !!onTile && t.state === 'hidden';
          const mid = x + g.tw / 2;
          return (
            <g
              key={t.pos}
              className={`tile ${t.state}` + (ptr ? ' ptr' : '') + (clickable ? ' click' : '')}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={clickable ? `Reveal the ${placeName(digits, t.pos)} digit` : undefined}
              onClick={clickable ? () => onTile(t.pos) : undefined}
              onKeyDown={clickable ? key(t.pos) : undefined}
            >
              <rect x={x} y={g.tileY} width={g.tw} height={g.th} rx={10} className="face" />
              {t.state === 'hidden' && (
                <text x={mid} y={g.tileY + g.th / 2 - 4} className="q">
                  ?
                </text>
              )}
              {(t.state === 'shown' || t.state === 'auto') && (
                <text x={mid} y={g.tileY + g.th / 2 - 4} className="digit">
                  {t.value}
                </text>
              )}
              {t.state === 'rolling' && t.value !== null && <Reel g={g} pos={t.pos} value={t.value} x={x} ms={rollMs} />}
              <text x={mid} y={g.tileY + g.th - 8} className="place">
                {tilePlace(digits, t.pos)}
              </text>
              {ptr && (
                <>
                  <path d={`M ${mid - 6} ${g.tileY - 9} L ${mid + 6} ${g.tileY - 9} L ${mid} ${g.tileY - 3} Z`} className="caret" />
                  <text x={mid} y={g.tileY - 13} className="caret-label">
                    {pointerLabel}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* How each possible reveal would move the odds: one bar per digit value. */}
        {fans.map((f) => (
          <Fan key={f.pos} g={g} f={f} digits={digits} pmax={pmax} chance={chance} />
        ))}
        {g.detail && marked && <Detail g={g} f={marked} digits={digits} pmax={pmax} chance={chance} />}
        {verdict && (
          <text x={g.cx} y={g.fanBase - 4} className={'verdict' + (targetWins ? ' win' : ' lose')}>
            N = {verdict}
          </text>
        )}

        {/* The count behind the odds. */}
        {g.wide ? (
          <g className="tally">
            <text x={8} y={372} className="tally-big start">
              <tspan className="lit">{fmtN(winners)}</tspan>
              <tspan className="of"> / {fmtN(candidates)}</tspan>
            </text>
            <text x={8} y={394} className="tally-sub start">
              {winners === 1 ? singular : plural} lit among the candidates
            </text>
            <text x={8} y={414} className="tally-sub start">
              chance N is {bet === 'composite' ? 'not prime' : bet === 'prime' ? 'prime' : 'a square'}: <tspan className="lit">{fmtPct(chance)}</tspan>
            </text>
          </g>
        ) : (
          <>
            <text x={g.grid.x} y={g.grid.y - 10} className="head start">
              {fmtN(candidates)} candidate{candidates === 1 ? '' : 's'}
            </text>
            <text x={g.grid.x + g.grid.w} y={g.grid.y - 10} className="head end">
              <tspan className="lit">{fmtN(winners)}</tspan> {winners === 1 ? singular : plural} lit · <tspan className="lit">{fmtPct(chance)}</tspan>
            </text>
          </>
        )}

        {blocks.map((b) => (
          <g key={b.label} className="block">
            <rect x={b.x - 3} y={b.y - 3} width={b.w + 6} height={b.h + 6} rx={6} />
            <text x={b.x} y={b.y - 6}>
              {b.label}
            </text>
          </g>
        ))}

        <g className={'cells' + (enter ? ' enter' : '') + (settled ? ' settled' : '')}>
          {placed.map(({ cell, x, y }) => {
            const s = coreScale(cell);
            const lit = s > 0.999;
            return (
              <g key={cell.key} className={'cell' + (cell.dead ? ' dead' : '')} style={{ transform: `translate(${x}px, ${y}px)` }}>
                <circle r={r} className="dot" />
                <circle r={r * s} className="core" />
                {ringedDot(cell) && <circle r={r} className="ring" />}
                {labelled && (
                  <text y={numFont * 0.36} className={'num' + (lit ? ' on' : '')} style={{ fontSize: numFont }}>
                    {cell.pattern.join('')}
                  </text>
                )}
              </g>
            );
          })}
        </g>
        {ringed && <circle cx={ringed.x} cy={ringed.y} r={r + Math.max(3, pitch * 0.12)} className={'target' + (targetWins ? ' win' : ' lose')} />}

        <g className="legend">
          <circle cx={g.legendX + 6} cy={g.legendY - 4} r={5} className="dot" />
          <circle cx={g.legendX + 6} cy={g.legendY - 4} r={5 * (folded ? 0.6 : 1)} className="core" />
          {anyRing && <circle cx={g.legendX + 6} cy={g.legendY - 4} r={5} className="ring" />}
          {g.wide || legend.length === 1 ? (
            legend.map((line, i) => (
              <text key={i} x={g.legendX + 16} y={g.legendY + i * 15} className="start">
                {line}
              </text>
            ))
          ) : (
            <text x={g.legendX + 16} y={g.legendY} className="start">
              {legend.join(' · ')}
            </text>
          )}
        </g>
      </svg>
      {overlay && (
        <div className={'pt-overlay' + (box && wide ? '' : ' fill')} style={box && wide ? box : undefined}>
          {overlay(wide && !!box)}
        </div>
      )}
    </>
  );
}
