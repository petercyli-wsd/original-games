import { useEffect, useState } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import { DICE, duelChances, gridCells, matchOf, opponentsOf, titleChance, type State } from './math';

export interface Rolling {
  /** Final faces of the roll-off being played (yours, opponent's). */
  fa: number;
  fb: number;
  ms: number;
}

export interface DuelResult {
  fa: number;
  fb: number;
  won: boolean;
}

export interface BoardProps {
  /** The die you backed. */
  die: number;
  /** Roll-offs played so far, and whether you lost one. */
  s: State;
  /** The roll-off shown in the face-pair grid. */
  grid: State;
  /** Result of each roll-off played so far. */
  results: (DuelResult | null)[];
  /** The result of the roll-off shown in the grid, marked until the next roll. */
  mark: { fa: number; fb: number } | null;
  rolling: Rolling | null;
}

const GRID_X = 50;
const GRID_Y = 382;
const GRID_W = 300;
const GRID_H = 168;
const TILE = 64;

/** Face to show while a die tumbles: cycles through every face of the die. */
const tumbleFace = (tick: number, offset: number, n: number) => ((tick * 7 + offset) % n) + 1;

function useTumble(rolling: Rolling | null) {
  const [tick, setTick] = useState(0);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    setLocked(false);
    if (!rolling) return;
    let k = 0;
    let elapsed = 0;
    let id = 0;
    const lockAt = rolling.ms * 0.72;
    const run = () => {
      const delay = Math.max(25, rolling.ms * 0.03 * (1 + k * 0.12));
      id = window.setTimeout(() => {
        elapsed += delay;
        k++;
        if (elapsed >= lockAt) return setLocked(true);
        setTick((t) => t + 1);
        run();
      }, delay);
    };
    run();
    return () => window.clearTimeout(id);
  }, [rolling]);
  return { tick, locked };
}

export default function Board({ die, s, grid, results, mark, rolling }: BoardProps) {
  const { tick, locked } = useTumble(rolling);
  const tumbling = !!rolling && !locked;
  const m = matchOf(die, grid);
  const g = gridCells(die, grid);
  const cw = GRID_W / m.b;
  const ch = GRID_H / m.a;
  const chances = duelChances(die);
  const opps = opponentsOf(die);

  // The pair shown on the dice and in the grid: the tumbling pair, the landed pair, or the last result.
  const shown = rolling ? (locked ? { fa: rolling.fa, fb: rolling.fb } : { fa: tumbleFace(tick, 0, m.a), fb: tumbleFace(tick, 3, m.b) }) : mark;
  const landed = shown && !tumbling ? g.grid[shown.fa - 1]?.[shown.fb - 1] : undefined;
  const youWon = landed === 'good';
  const decided = !!shown && !tumbling;

  // The literal derivation of the overall chance: the roll-offs still to win.
  const left = s.lost ? [] : chances.slice(s.j);
  const total = titleChance(die, s);
  const product = s.lost ? 'Lost a roll-off · 0%' : left.length === 0 ? 'Won all three roll-offs' : `${fmtChance(total)} = ${left.map(fmtChance).join(' × ')}`;

  const tile = (x: number, who: number, f: number | null, mine: boolean, win: boolean) => (
    <g className={'die' + (mine ? ' mine' : '') + (win ? ' won' : '') + (tumbling ? ' tumble' : '')} style={{ transform: `translate(${x}px, 34px)` }}>
      <rect width={TILE} height={TILE} rx="10" className="tile" />
      <text x="8" y="16" className="dname left">
        d{DICE[who]}
      </text>
      <text x={TILE / 2} y={TILE / 2 + 18} className="face">
        {f ?? ''}
      </text>
    </g>
  );

  return (
    <svg viewBox="0 0 400 620" className="ladder" role="img" aria-label={`Stepladder: your d${m.a} against the d${m.b}, roll-off ${grid.j + 1} of 3. ${g.good} of ${g.total} face pairs are green. Chance to win all three: ${product}.`}>
      <text x="200" y="20" className="head">
        Roll-off {Math.min(grid.j, 2) + 1} of 3
      </text>
      {tile(60, die, shown ? shown.fa : null, true, decided && youWon)}
      <text x="200" y="74" className="vs">
        vs
      </text>
      {tile(276, m.opp, shown ? shown.fb : null, false, decided && !youWon)}

      {opps.map((o, i) => {
        const y = 118 + i * 38;
        const r = results[i];
        const now = i === grid.j;
        const status = r ? `${r.won ? 'won' : 'lost'} ${r.fa}–${r.fb}` : '';
        return (
          <g key={`duel${i}`} className={'duel' + (now ? ' now' : '') + (r ? (r.won ? ' won' : ' lost') : '')}>
            <rect x="6" y={y - 6} width="388" height="32" rx="6" className="duel-bg" />
            <text x="16" y={y + 14} className="tname left">
              {i + 1}. d{DICE[die]} vs d{DICE[o]}
            </text>
            <rect x="130" y={y + 5} width="120" height="10" rx="4" className="bar-bg" />
            <rect x="130" y={y + 5} width={Math.max(2, chances[i] * 120)} height="10" rx="4" className="bar" />
            <text x="288" y={y + 14} className="tpct right">
              {fmtChance(chances[i])}
            </text>
            <text x="384" y={y + 14} className="tstat right">
              {status}
            </text>
          </g>
        );
      })}

      <text x="200" y="262" className="small">
        Win all three to win the round
      </text>
      <text x="200" y="290" className={'product' + (s.lost ? ' bad' : '')}>
        {product}
      </text>

      <text x="8" y="326" className="head left">
        Your d{m.a} vs the d{m.b}
      </text>
      <text x="8" y="344" className="small left">
        Your d{m.a} faces down the side, the d{m.b} across. <tspan className="g">Green</tspan> = your die wins.
      </text>
      <text x="8" y="360" className="small left">
        Highest roll wins; a tie goes to the bigger die (the d{Math.max(m.a, m.b)}).
      </text>

      {Array.from({ length: m.b }, (_, c) => (
        <text key={`c${c}`} x={GRID_X + (c + 0.5) * cw} y={GRID_Y - 3} className="axis">
          {c + 1}
        </text>
      ))}
      {Array.from({ length: m.a }, (_, r) => (
        <text key={`r${r}`} x={GRID_X - 5} y={GRID_Y + (r + 0.5) * ch + 3} className="axis right">
          {r + 1}
        </text>
      ))}
      {g.grid.map((row, r) => row.map((k, c) => <rect key={`${r}-${c}`} x={GRID_X + c * cw + 0.5} y={GRID_Y + r * ch + 0.5} width={cw - 1} height={ch - 1} rx="2" className={'cell ' + k} />))}
      {shown && (
        <rect
          x={GRID_X + (shown.fb - 1) * cw - 1}
          y={GRID_Y + (shown.fa - 1) * ch - 1}
          width={cw + 2}
          height={ch + 2}
          rx="3"
          className={'pair' + (tumbling ? ' tumbling' : ' landed') + (landed ? ' ' + landed : '')}
        />
      )}

      <rect x={GRID_X} y={GRID_Y + GRID_H + 12} width={GRID_W} height="10" rx="4" className="share-bg" />
      <rect x={GRID_X} y={GRID_Y + GRID_H + 12} width={Math.max(0, (g.good / g.total) * GRID_W)} height="10" rx="4" className="share" />
      <text x={GRID_X + GRID_W / 2} y={GRID_Y + GRID_H + 42} className="share-label">
        <tspan className="g">{g.good}</tspan> of {g.total} pairs are green = {fmtChance(g.good / g.total)}
      </text>
    </svg>
  );
}
