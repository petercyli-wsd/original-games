import type { CSSProperties } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import { beats, players, type Bracket, type MatchRef, type Results } from './math';

export type Orient = 'wide' | 'tall';

interface Geom {
  /** Size along the bracket's axis (leaves at both ends, final in the middle). */
  along: number;
  /** Size across it. */
  across: number;
  /** Positions along the axis of the leaves, then each round's winner slots, on the first side. */
  cols: number[];
  centre: number;
  gap: number;
  pad: number;
  leafR: number;
  nodeR: number;
  donutR: number;
  donutW: number;
  label: number;
  font: number;
}

function geom(n: number, orient: Orient): Geom {
  if (orient === 'wide') {
    return n === 16
      ? { along: 1000, across: 520, cols: [112, 214, 300, 374], centre: 500, gap: 64, pad: 4, leafR: 19, nodeR: 13, donutR: 74, donutW: 16, label: 54, font: 16 }
      : { along: 1000, across: 460, cols: [140, 262, 372], centre: 500, gap: 112, pad: 6, leafR: 24, nodeR: 16, donutR: 84, donutW: 18, label: 62, font: 18 };
  }
  return n === 16
    ? { along: 640, across: 420, cols: [56, 130, 190, 240], centre: 320, gap: 52.5, pad: 0, leafR: 17, nodeR: 12, donutR: 50, donutW: 12, label: 35, font: 13 }
    : { along: 580, across: 420, cols: [58, 138, 196], centre: 290, gap: 105, pad: 0, leafR: 22, nodeR: 15, donutR: 56, donutW: 14, label: 40, font: 15 };
}

export interface BoardProps {
  b: Bracket;
  res: Results;
  held: number;
  odds: number[];
  orient: Orient;
  /** The match about to be (or being) played. */
  next: MatchRef | null;
  playing: boolean;
  /** Set when the round has a champion. */
  champion: number | null;
  /** Whether a seed can be clicked (pick before the bet, switch at a checkpoint). */
  canPick(seed: number): boolean;
  pickTitle(seed: number): string;
  onPick(seed: number): void;
  /** Show live odds labels (false greys them as a preview). */
  live: boolean;
}

const TAU = Math.PI * 2;

export default function BracketBoard({ b, res, held, odds, orient, next, playing, champion, canPick, pickTitle, onPick, live }: BoardProps) {
  const g = geom(b.n, orient);
  const half = b.n / 2;
  const final = b.rounds - 1;
  const W = orient === 'wide' ? g.along : g.across;
  const H = orient === 'wide' ? g.across : g.along;

  const pt = (along: number, across: number) => (orient === 'wide' ? { x: along, y: across } : { x: across, y: along });
  const sideAlong = (side: number, a: number) => (side === 0 ? a : g.along - a);

  /** Position of a first-round slot (k = -1) or of match (k, m)'s winner slot. */
  function pos(k: number, m: number) {
    if (k === final) return pt(g.centre, g.across / 2);
    const per = b.n >> (k + 1); // nodes in this column, both sides
    const side = m < per / 2 ? 0 : 1;
    const local = m - side * (per / 2);
    const span = 2 ** (k + 1);
    return pt(sideAlong(side, g.cols[k + 1]), g.pad + (local + 0.5) * span * g.gap);
  }
  const leafPos = (slot: number) => {
    const side = slot < half ? 0 : 1;
    return pt(sideAlong(side, g.cols[0]), g.pad + (slot - side * half + 0.5) * g.gap);
  };
  const leafSide = (slot: number) => (slot < half ? 0 : 1);

  /** Seed at a feeder: a first-round slot's seed or a played match's winner. */
  const feederSeed = (k: number, m: number) => (k < 0 ? b.order[m] : res[k][m]);
  const feederPos = (k: number, m: number) => (k < 0 ? leafPos(m) : pos(k, m));

  // The held seed's road to the final: the matches it still has to win.
  const heldSlot = b.order.indexOf(held);
  const route = new Set<string>();
  if (odds[held] > 0) for (let k = 0; k < b.rounds; k++) if (res[k][heldSlot >> (k + 1)] < 0) route.add(`${k}-${heldSlot >> (k + 1)}`);

  const elbow = (a: { x: number; y: number }, c: { x: number; y: number }) => {
    if (orient === 'wide') {
      const mx = (a.x + c.x) / 2;
      return `M${a.x} ${a.y} H${mx} V${c.y} H${c.x}`;
    }
    const my = (a.y + c.y) / 2;
    return `M${a.x} ${a.y} V${my} H${c.x} V${c.y}`;
  };

  const lines: JSX.Element[] = [];
  const nodes: JSX.Element[] = [];
  for (let k = 0; k < b.rounds; k++) {
    for (let m = 0; m < res[k].length; m++) {
      const at = pos(k, m);
      const w = res[k][m];
      const isNext = !!next && next.k === k && next.m === m;
      for (const f of [2 * m, 2 * m + 1]) {
        const s = feederSeed(k - 1, f);
        const from = feederPos(k - 1, f);
        let cls = 'ln';
        if (w >= 0) cls += w === s ? (s === held ? ' won mine' : ' won') : ' lost';
        else if (route.has(`${k}-${m}`) && f === heldSlot >> k) cls += ' route';
        if (isNext && s >= 0) cls += ' next';
        lines.push(<path key={`l${k}-${f}`} d={elbow(from, at)} className={cls} />);
      }
      if (k === final) continue;
      const [x, y] = players(b, res, k, m);
      const r = g.nodeR;
      if (w >= 0) {
        nodes.push(
          <g key={`d${k}-${m}`} className={'node done' + (w === held ? ' mine' : '')} transform={`translate(${at.x} ${at.y})`}>
            <circle r={r} />
            <text y={0.5} style={{ fontSize: r * 1.05 }}>
              {w + 1}
            </text>
          </g>,
        );
      } else if (x >= 0 && y >= 0) {
        const px = beats(b, x, y);
        nodes.push(
          <g key={`n${k}-${m}`} className={'node ready' + (isNext ? ' next' : '') + (isNext && playing ? ' playing' : '')} transform={`translate(${at.x} ${at.y})`}>
            <circle r={r} className="bg" />
            <SplitRing r={r} p={px} a={x === held ? 'mine' : 'a'} c={y === held ? 'mine' : 'b'} />
          </g>,
        );
      } else {
        nodes.push(<circle key={`n${k}-${m}`} cx={at.x} cy={at.y} r={r * 0.75} className="node empty" />);
      }
    }
  }

  // Centre: the title ring. Every live seed's slice is its title chance.
  const c = pt(g.centre, g.across / 2);
  const slices: JSX.Element[] = [];
  const liveSeeds = b.order.filter((s) => odds[s] > 0);
  let a0 = 0;
  const gapTurn = liveSeeds.length > 1 ? 0.004 : 0;
  liveSeeds.forEach((s, i) => {
    const len = odds[s];
    const start = a0 + gapTurn / 2;
    const end = a0 + Math.max(len - gapTurn / 2, start - a0 + 0.0005);
    a0 += len;
    slices.push(<path key={s} d={annulus(c.x, c.y, g.donutR, g.donutW, start, Math.max(start + 0.0005, end))} className={'slice' + (s === held ? ' mine' : i % 2 ? ' alt' : '')} />);
  });

  const centreText =
    champion !== null ? (
      <>
        <text x={c.x} y={c.y - g.donutR * 0.2} className={'c-big' + (champion === held ? ' mine' : '')} style={{ fontSize: g.donutR * 0.62 }}>
          {champion + 1}
        </text>
        <text x={c.x} y={c.y + g.donutR * 0.36} className="c-small" style={{ fontSize: g.font * 0.8 }}>
          champion
        </text>
      </>
    ) : (
      <>
        <text x={c.x} y={c.y - g.donutR * 0.12} className={'c-big mine' + (live ? '' : ' idle')} style={{ fontSize: g.donutR * 0.36 }}>
          {fmtChance(odds[held])}
        </text>
        <text x={c.x} y={c.y + g.donutR * 0.3} className="c-small" style={{ fontSize: g.font * 0.78 }}>
          seed {held + 1} title
        </text>
      </>
    );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`bk-svg ${orient}`} role="img" aria-label={`Knockout bracket of ${b.n} seeds. Seed ${held + 1} has a ${fmtChance(odds[held])} title chance.`}>
      <g className="lines">{lines}</g>
      <circle cx={c.x} cy={c.y} r={g.donutR + g.donutW / 2} className="donut-hole" />
      <circle cx={c.x} cy={c.y} r={g.donutR} className="donut-track" style={{ strokeWidth: g.donutW }} />
      {slices}
      {centreText}
      {nodes}
      {b.order.map((s, slot) => {
        const p = leafPos(slot);
        const out = odds[s] === 0;
        const mine = s === held;
        const r = g.leafR;
        const pick = canPick(s);
        const side = leafSide(slot);
        const lbl = orient === 'wide' ? { x: p.x + (side ? g.label : -g.label), y: p.y } : { x: p.x, y: p.y + (side ? g.label : -g.label) };
        const len = odds[s];
        return (
          <g
            key={s}
            className={'leaf' + (mine ? ' mine' : '') + (out ? ' out' : '') + (pick ? ' pick' : '') + (champion === s ? ' champ' : '')}
            onClick={pick ? () => onPick(s) : undefined}
            role={pick ? 'button' : undefined}
            aria-label={pick ? pickTitle(s) : undefined}
          >
            <title>{pickTitle(s)}</title>
            <circle cx={p.x} cy={p.y} r={r + 5} className="hit" />
            <circle cx={p.x} cy={p.y} r={r + 4.5} className="ring-track" />
            {!out && len > 0 && <path d={arcPath(p.x, p.y, r + 4.5, 0, len)} className="ring" />}
            <circle cx={p.x} cy={p.y} r={r} className="tok" />
            <text x={p.x} y={p.y + 0.5} className="seed" style={{ fontSize: r * 0.95 }}>
              {s + 1}
            </text>
            <text x={lbl.x} y={lbl.y + 0.5} className={'pct' + (live ? '' : ' idle')} style={{ fontSize: g.font }}>
              {out ? 'out' : fmtChance(odds[s])}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** A small ring split by a match's odds: the first seed's share clockwise from the top. */
function SplitRing({ r, p, a, c }: { r: number; p: number; a: string; c: string }) {
  const R = r + 3;
  return (
    <>
      <path d={arcPath(0, 0, R, 0, p)} className={'split ' + a} />
      <path d={arcPath(0, 0, R, p, 1)} className={'split ' + c} />
    </>
  );
}

const polar = (cx: number, cy: number, r: number, turn: number) => ({ x: cx + r * Math.sin(turn * TAU), y: cy - r * Math.cos(turn * TAU) });

function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  // Long arcs go in two halves, so a full circle never collapses to one point.
  if (to - from > 0.5) return `${arcPath(cx, cy, r, from, from + 0.5)} ${arcPath(cx, cy, r, from + 0.5, to).replace(/^M[^A]*/, '')}`;
  const len = to - from;
  const a = polar(cx, cy, r, from);
  const z = polar(cx, cy, r, from + len);
  return `M${a.x.toFixed(2)} ${a.y.toFixed(2)} A${r} ${r} 0 ${len > 0.5 ? 1 : 0} 1 ${z.x.toFixed(2)} ${z.y.toFixed(2)}`;
}

function annulus(cx: number, cy: number, r: number, w: number, from: number, to: number): string {
  if (to - from > 0.5) return `${annulus(cx, cy, r, w, from, from + 0.5)} ${annulus(cx, cy, r, w, from + 0.5, to)}`;
  const len = to - from;
  const ro = r + w / 2;
  const ri = r - w / 2;
  const large = len > 0.5 ? 1 : 0;
  const a = polar(cx, cy, ro, from);
  const z = polar(cx, cy, ro, from + len);
  const zi = polar(cx, cy, ri, from + len);
  const ai = polar(cx, cy, ri, from);
  const f = (v: number) => v.toFixed(2);
  return `M${f(a.x)} ${f(a.y)} A${ro} ${ro} 0 ${large} 1 ${f(z.x)} ${f(z.y)} L${f(zi.x)} ${f(zi.y)} A${ri} ${ri} 0 ${large} 0 ${f(ai.x)} ${f(ai.y)} Z`;
}

export interface DuelProps {
  b: Bracket;
  x: number;
  y: number;
  px: number;
  /** The held seed's title chance if x wins / if y wins. */
  ax: number;
  ay: number;
  now: number;
  held: number;
  title: string;
  /** Where the draw landed (0..1) while the match plays, else null. */
  landing: number | null;
  ms: number;
  /** Bumped per match so the sweep restarts. */
  seq: number;
}

/** The next match as a bar split by its odds, and the title chance each result would leave you with. */
export function Duel({ b, x, y, px, ax, ay, now, held, title, landing, ms, seq }: DuelProps) {
  // When the two results (or now) would print the same, show more digits so the move is visible.
  const close = new Set([fmtChance(ax), fmtChance(ay), fmtChance(now)]).size < 3;
  const fmt = (v: number) => (close && v > 0 && v < 1 ? `${(v * 100).toPrecision(4)}%` : fmtChance(v));
  const after = (v: number) => {
    if (v === 0) return <b className="down">you're out</b>;
    if (v === 1) return <b className="up">you win</b>;
    const cls = v > now + 1e-12 ? 'up' : v < now - 1e-12 ? 'down' : '';
    return (
      <>
        you <b className={cls}>{fmt(v)}</b>
      </>
    );
  };
  const tag = (s: number) => (s === held ? 'mine' : '');
  return (
    <div className="bk-duel" aria-live="polite">
      <div className="bk-duel-head">
        <span>{title}</span>
        <span className="muted">if it goes this way</span>
      </div>
      <div className="bk-duel-names">
        <span className={tag(x)}>
          Seed {x + 1} <small>{b.ratings[x]}</small>
        </span>
        <span className={tag(y)}>
          <small>{b.ratings[y]}</small> Seed {y + 1}
        </span>
      </div>
      <div className="bk-duel-bar">
        <i className={'a ' + tag(x)} style={{ width: `${px * 100}%` }} />
        <i className={'c ' + tag(y)} style={{ width: `${(1 - px) * 100}%` }} />
        {landing !== null && <em key={seq} className="needle" style={{ '--u': landing, animationDuration: `${ms}ms` } as CSSProperties} />}
      </div>
      <div className="bk-duel-after">
        <span>
          <b>{fmtChance(px)}</b> → {after(ax)}
        </span>
        <span>
          {after(ay)} ← <b>{fmtChance(1 - px)}</b>
        </span>
      </div>
    </div>
  );
}
