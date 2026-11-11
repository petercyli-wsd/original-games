import type { CSSProperties } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import { players, type Bracket, type MatchRef, type Results } from './math';

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
}

function geom(n: number, orient: Orient): Geom {
  if (orient === 'wide') {
    return n === 16
      ? { along: 1000, across: 520, cols: [112, 214, 300, 374], centre: 500, gap: 64, pad: 4, leafR: 19, nodeR: 13 }
      : { along: 1000, across: 460, cols: [140, 262, 372], centre: 500, gap: 112, pad: 6, leafR: 24, nodeR: 16 };
  }
  return n === 16
    ? { along: 640, across: 420, cols: [56, 130, 190, 240], centre: 320, gap: 52.5, pad: 0, leafR: 17, nodeR: 12 }
    : { along: 580, across: 420, cols: [58, 138, 196], centre: 290, gap: 105, pad: 0, leafR: 22, nodeR: 15 };
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
}

export default function BracketBoard({ b, res, held, odds, orient, next, playing, champion, canPick, pickTitle, onPick }: BoardProps) {
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
        nodes.push(
          <g key={`n${k}-${m}`} className={'node ready' + (isNext ? ' next' : '') + (isNext && playing ? ' playing' : '')} transform={`translate(${at.x} ${at.y})`}>
            <circle r={r} />
          </g>,
        );
      } else {
        nodes.push(<circle key={`n${k}-${m}`} cx={at.x} cy={at.y} r={r * 0.75} className="node empty" />);
      }
    }
  }

  // Centre: the final's slot. It shows the champion's seed number once there is one.
  const c = pt(g.centre, g.across / 2);
  const centre = (
    <g className={'node ' + (champion === null ? 'ready' : 'done') + (champion === held ? ' mine' : '')} transform={`translate(${c.x} ${c.y})`}>
      <circle r={g.nodeR * 1.25} />
      {champion !== null && (
        <text y={0.5} style={{ fontSize: g.nodeR * 1.3 }}>
          {champion + 1}
        </text>
      )}
    </g>
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`bk-svg ${orient}`} role="img" aria-label={`Knockout bracket of ${b.n} seeds. Seed ${held + 1} has a ${fmtChance(odds[held])} title chance.`}>
      <g className="lines">{lines}</g>
      {nodes}
      {centre}
      {b.order.map((s, slot) => {
        const p = leafPos(slot);
        const out = odds[s] === 0;
        const mine = s === held;
        const r = g.leafR;
        const pick = canPick(s);
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
            <circle cx={p.x} cy={p.y} r={r} className="tok" />
            <text x={p.x} y={p.y + 0.5} className="seed" style={{ fontSize: r * 0.95 }}>
              {s + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export interface DuelProps {
  x: number;
  y: number;
  /** x's chance to win this match: the bar's split. */
  px: number;
  held: number;
  title: string;
  /** Where the draw landed (0..1): the marker sweeps there. Left of the split is x, right is y. */
  u: number;
  ms: number;
  /** Bumped per match so the sweep restarts. */
  seq: number;
  /** The next match's seeds, shown once this one has landed. */
  upNext?: [number, number] | null;
}

/** A match as a flat bar split by its odds; a marker sweeps to the draw and stays there. */
export function Duel({ x, y, px, held, title, u, ms, seq, upNext }: DuelProps) {
  const tag = (s: number) => (s === held ? 'mine' : '');
  return (
    <div className="bk-duel" aria-live="polite">
      <span className="bk-duel-head">{title}</span>
      <div className="bk-duel-row">
        <span className={'bk-duel-name ' + tag(x)}>Seed {x + 1}</span>
        <div className="bk-duel-bar">
          <i className={'a ' + tag(x)} style={{ width: `${px * 100}%` }} />
          <i className={'c ' + tag(y)} style={{ width: `${(1 - px) * 100}%` }} />
          <em key={seq} className="needle" style={{ '--u': u, animationDuration: `${ms}ms` } as CSSProperties} />
        </div>
        <span className={'bk-duel-name ' + tag(y)}>Seed {y + 1}</span>
      </div>
      {upNext && (
        <span className="bk-duel-next">
          Next · Seed {upNext[0] + 1} vs Seed {upNext[1] + 1}
        </span>
      )}
    </div>
  );
}
