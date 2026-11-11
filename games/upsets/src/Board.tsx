import type { CSSProperties } from 'react';
import { ORDER, counts, isUpset, players, rating, type Results } from './math';

// Tree geometry: eight leaves down the left, winners advance to the right.
const COL = [78, 160, 242, 324];
const ROW = 34;
const TOP = 22;
const leafY = (slot: number) => TOP + slot * ROW;
/** Position of the winner slot of match i. */
function slotPos(i: number): { x: number; y: number } {
  if (i < 4) return { x: COL[1], y: (leafY(2 * i) + leafY(2 * i + 1)) / 2 };
  if (i < 6) return { x: COL[2], y: (slotPos(2 * (i - 4)).y + slotPos(2 * (i - 4) + 1).y) / 2 };
  return { x: COL[3], y: (slotPos(4).y + slotPos(5).y) / 2 };
}
const elbow = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const mx = (a.x + b.x) / 2;
  return `M${a.x} ${a.y} H${mx} V${b.y} H${b.x}`;
};

export interface TreeProps {
  res: Results;
  /** The match about to be (or being) played, if any. */
  next: number | null;
}

/** The knockout. A played match shows its winner: green if it was an upset, red if the favourite won. */
export function Tree({ res, next }: TreeProps) {
  const lines: JSX.Element[] = [];
  const nodes: JSX.Element[] = [];
  const out = new Set<number>();
  for (let i = 0; i < 7; i++) {
    const at = slotPos(i);
    const [x, y] = i < res.length || next === i || i < 4 ? players(res, i) : [-1, -1];
    const played = i < res.length;
    if (played) out.add(res[i] === x ? y : x);
    for (const f of [0, 1]) {
      const from = i < 4 ? { x: COL[0], y: leafY(2 * i + f) } : slotPos(2 * (i - 4) + f);
      const seed = f === 0 ? x : y;
      let cls = 'ln';
      if (played) cls += res[i] === seed ? ' won' : ' lost';
      else if (next === i) cls += ' next';
      lines.push(<path key={`l${i}-${f}`} d={elbow(from, at)} className={cls} />);
    }
    if (played) {
      nodes.push(
        <g key={`n${i}`} className={'node ' + (isUpset(res, i, res[i]) ? 'up' : 'fav')} transform={`translate(${at.x} ${at.y})`}>
          <circle r={14} />
          <text>{res[i] + 1}</text>
        </g>,
      );
    } else {
      nodes.push(<circle key={`n${i}`} cx={at.x} cy={at.y} r={11} className={'node empty' + (next === i ? ' next' : '')} />);
    }
  }
  const { up, fav } = counts(res);
  return (
    <svg viewBox="0 0 360 290" className="up-tree" role="img" aria-label={`Knockout of 8 seeds: ${up} upsets, ${fav} favourite wins so far.`}>
      <g>{lines}</g>
      {nodes}
      {ORDER.map((s, slot) => (
        <g key={s} className={'leaf' + (out.has(s) ? ' out' : '')}>
          <text x={24} y={leafY(slot)} className="rate">
            {rating(s)}
          </text>
          <circle cx={COL[0]} cy={leafY(slot)} r={13} className="tok" />
          <text x={COL[0]} y={leafY(slot)} className="seed">
            {s + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

export interface DuelProps {
  fav: number;
  und: number;
  /** The underdog's chance: the green share of the bar. */
  pu: number;
  /** Where the draw landed (0..1), or null before a draw. Left of the split is an upset. */
  u: number | null;
  ms: number;
  seq: number;
  title: string;
  /** The next match's seeds, shown once this one has landed. */
  upNext?: string | null;
}

/** One match as a flat bar split by its odds; a marker sweeps to the draw and stays there. */
export function Duel({ fav, und, pu, u, ms, seq, title, upNext }: DuelProps) {
  return (
    <div className="up-duel" aria-live="polite">
      <span className="up-head">{title}</span>
      <div className="up-row">
        <span className="up-name">{`Underdog ${und + 1}`}</span>
        <div className="up-bar">
          <i className="u" style={{ width: `${pu * 100}%` }} />
          <i className="f" style={{ width: `${(1 - pu) * 100}%` }} />
          {u !== null && <em key={seq} className="needle" style={{ '--u': u, animationDuration: `${ms}ms` } as CSSProperties} />}
        </div>
        <span className="up-name r">{`Favourite ${fav + 1}`}</span>
      </div>
      <span className="up-key">Green: upset chance. Left numbers: ratings</span>
      {upNext && <span className="up-key">{upNext}</span>}
    </div>
  );
}

export function Pips({ label, n, filled, kind }: { label: string; n: number; filled: number; kind: 'up' | 'fav' }) {
  return (
    <div className="up-pips">
      <span>{label}</span>
      <div>
        {Array.from({ length: n }, (_, i) => (
          <i key={i} className={i < filled ? 'on ' + kind : ''} />
        ))}
      </div>
    </div>
  );
}
