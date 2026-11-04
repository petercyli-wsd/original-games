// Stepladder: four dice (d6, d8, d12, d20). You back one die. It must roll off
// against each of the other three dice in turn, smallest opponent first. In a
// roll-off both dice are rolled once; the higher face wins, and a tie goes to
// the bigger die. Win all three roll-offs and the round pays.
//
// Exact maths. A die of size a against a die of size b rolls (x, y) uniformly
// from the a * b face pairs. It wins when x > y, or x = y and a > b. Sizes in the
// set are all different, so a < b: P = (a - 1) / (2b); a > b: P = 1 - (b - 1) / (2a).
// The face-pair grid on the board lights exactly the winning pairs.
//
// The three roll-offs use fresh, independent rolls, so
//     P(win the round) = p1 * p2 * p3,
// the product of the three duel chances (shown literally on the board).
//
// Pricing (pattern 1, fixed prize): a full win pays prize = RTP / P(win). After
// j roll-offs won, the cash-out is prize * (product of the remaining duel
// chances) = prize * P(win | state). That is a conditional expectation of the
// final payout, hence a martingale from RTP: each roll-off multiplies the
// cash-out by 1/p on a win (p * 1/p = 1) and sets it to 0 on a loss, leaving the
// expectation unchanged, so every stopping rule returns RTP. The die you back
// changes the risk (64:1 range in P(win)), never the value.

export const RTP = 0.99;

/** Die sizes. */
export const DICE = [6, 8, 12, 20] as const;
export const ROLL_OFFS = DICE.length - 1;

export type Level = 'low' | 'medium' | 'high' | 'extreme';

/** One die per volatility level: the d20 is the favourite, the d6 the long shot. */
export const VOLATILITY: Record<Level, number> = { low: 3, medium: 2, high: 1, extreme: 0 };

export interface State {
  /** Roll-offs played so far (0..3). */
  j: number;
  /** True once the backed die has lost a roll-off. */
  lost: boolean;
}

export const START: State = { j: 0, lost: false };

/** Opponents of die x, smallest first: the order of the roll-offs. */
export const opponentsOf = (x: number): number[] => DICE.map((_, i) => i).filter((i) => i !== x);

/** Does a die of size a showing x beat a die of size b showing y? Ties go to the bigger die. */
export const wins = (a: number, x: number, b: number, y: number) => x > y || (x === y && a > b);

/** P(a die of size a beats a die of size b), by exact pair count. */
export function duelChance(a: number, b: number): number {
  let n = 0;
  for (let x = 1; x <= a; x++) for (let y = 1; y <= b; y++) if (wins(a, x, b, y)) n++;
  return n / (a * b);
}

/** The roll-off played from state s by the backer of x. */
export function matchOf(x: number, s: State) {
  const opp = opponentsOf(x)[Math.min(s.j, ROLL_OFFS - 1)];
  return { opp, a: DICE[x], b: DICE[opp] };
}

/** Chances of the three roll-offs of the backer of x, in order. */
export const duelChances = (x: number): number[] => opponentsOf(x).map((o) => duelChance(DICE[x], DICE[o]));

/** P(backer of x wins the round | state s): product of the roll-offs still to play. */
export function titleChance(x: number, s: State): number {
  if (s.lost) return 0;
  return duelChances(x)
    .slice(s.j)
    .reduce((p, c) => p * c, 1);
}

/** State after a roll-off with the given faces (x = your face, y = opponent's). */
export function step(x: number, s: State, fx: number, fy: number): State {
  const { a, b } = matchOf(x, s);
  return { j: s.j + 1, lost: !wins(a, fx, b, fy) };
}

/** Full-win prize for backing die x. */
export const prizeOf = (x: number) => RTP / titleChance(x, START);

export const MAX_MULTIPLIER = Math.ceil(prizeOf(0) * 100) / 100;

/** Cash-out multiplier for backer of die x in state s. */
export const cashOf = (x: number, s: State) => prizeOf(x) * titleChance(x, s);

export function levelOf(x: number): Level {
  const p = titleChance(x, START);
  return p > 0.4 ? 'low' : p > 0.1 ? 'medium' : p > 0.02 ? 'high' : 'extreme';
}

/** The colour of every cell (rows = your faces 1..a, columns = opponent faces 1..b): green = your die wins. */
export function gridCells(x: number, s: State): { grid: ('good' | 'bad')[][]; good: number; total: number } {
  const { a, b } = matchOf(x, s);
  let good = 0;
  const grid: ('good' | 'bad')[][] = [];
  for (let fx = 1; fx <= a; fx++) {
    const row: ('good' | 'bad')[] = [];
    for (let fy = 1; fy <= b; fy++) {
      const w = wins(a, fx, b, fy);
      row.push(w ? 'good' : 'bad');
      if (w) good++;
    }
    grid.push(row);
  }
  return { grid, good, total: a * b };
}
