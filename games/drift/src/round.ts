import { cashMultiplier, endingAt, type AutoRules, type Ending } from './math';

export type Phase = 'idle' | 'running' | 'paused' | 'over';
export type Outcome = Ending | 'cash-out';

export interface Round {
  bet: number;
  W: number;
  x0: number;
  rules: AutoRules;
  /** Every position so far, starting with x0. */
  path: number[];
  /** Step indices where the round paused at a checkpoint. */
  checkpoints: number[];
  /** Steps left in the current burst (Infinity = run until paused). */
  burstLeft: number;
  outcome: Outcome | null;
  mult: number;
}

// Balance lives in the host wallet; the reducer only plays the round. When
// phase becomes 'over', round.mult is the multiplier the app settles.
export interface GameState {
  phase: Phase;
  round: Round | null;
  history: { mult: number; outcome: Outcome; id: number }[];
}

export type Action =
  | { type: 'start'; bet: number; W: number; x0: number; rules: AutoRules; burst: number }
  /** One step of the walk; the ±1 is drawn from the host RNG by the caller. */
  | { type: 'step'; dx: 1 | -1 }
  | { type: 'pause' }
  | { type: 'continue'; burst: number }
  | { type: 'cashOut' }
  | { type: 'clear' };

export const initialState = (): GameState => ({ phase: 'idle', round: null, history: [] });

export const position = (r: Round) => r.path[r.path.length - 1];

function finish(s: GameState, round: Round, outcome: Outcome): GameState {
  const mult = cashMultiplier(position(round), round.x0);
  const id = (s.history[0]?.id ?? 0) + 1;
  return {
    phase: 'over',
    round: { ...round, outcome, mult },
    history: [{ mult, outcome, id }, ...s.history].slice(0, 12),
  };
}

const burstSteps = (burst: number) => (burst > 0 ? burst : Infinity);

export function reducer(s: GameState, a: Action): GameState {
  const r = s.round;
  switch (a.type) {
    case 'start':
      if (s.phase === 'running' || s.phase === 'paused') return s;
      return {
        ...s,
        phase: 'running',
        round: {
          bet: a.bet,
          W: a.W,
          x0: a.x0,
          rules: a.rules,
          path: [a.x0],
          checkpoints: [],
          burstLeft: burstSteps(a.burst),
          outcome: null,
          mult: 0,
        },
      };
    case 'step': {
      if (s.phase !== 'running' || !r) return s;
      const x = position(r) + a.dx;
      const round = { ...r, path: [...r.path, x], burstLeft: r.burstLeft - 1 };
      const ending = endingAt(x, r.W, r.rules);
      if (ending) return finish(s, round, ending);
      if (round.burstLeft <= 0) return { ...s, phase: 'paused', round: { ...round, checkpoints: [...r.checkpoints, round.path.length - 1] } };
      return { ...s, round };
    }
    case 'pause':
      if (s.phase !== 'running' || !r) return s;
      return { ...s, phase: 'paused', round: { ...r, burstLeft: 0, checkpoints: [...r.checkpoints, r.path.length - 1] } };
    case 'continue':
      if (s.phase !== 'paused' || !r) return s;
      return { ...s, phase: 'running', round: { ...r, burstLeft: burstSteps(a.burst) } };
    case 'cashOut':
      if ((s.phase !== 'running' && s.phase !== 'paused') || !r) return s;
      return finish(s, r, 'cash-out');
    case 'clear':
      return s.phase === 'over' ? { ...s, phase: 'idle', round: null } : s;
  }
}
