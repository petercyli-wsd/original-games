// Round state machine. The wallet lives in the host; the reducer only plays the
// round. A finished round's multiplier is `result.mult`, which the app settles.
// Randomness is injected through the `pick` action so the reducer stays pure.

import { PRESETS, prize, winProbability, type Colour, type PresetId } from './math';

export type Phase = 'idle' | 'drawing' | 'checkpoint' | 'over';

export type Outcome =
  | 'cashed' // player took M × P_t
  | 'won' // blue held the majority after the last draw
  | 'lost'
  | 'clinched' // blue's majority became certain before the last draw
  | 'sealed'; // red's majority became certain before the last draw

export interface Round {
  preset: PresetId;
  draws: number;
  bet: number;
  prize: number;
  /** Urn contents in the order they went in; twins are appended. */
  balls: Colour[];
  blue: number;
  red: number;
  /** Colour of each draw so far. */
  history: Colour[];
  /** Win chance after t draws; probs[0] is the starting chance. */
  probs: number[];
}

export interface GameState {
  phase: Phase;
  round: Round | null;
  /** Draws still to make in the current burst, and the burst's size (for pacing). */
  pending: number;
  burst: number;
  /** Index of the ball being drawn, while it is shown lifted out of the urn. */
  picked: number | null;
  result: { mult: number; outcome: Outcome } | null;
  recent: { id: number; mult: number }[];
}

export type Action =
  | { type: 'start'; bet: number; preset: PresetId; draws: number }
  | { type: 'draw'; count: number }
  | { type: 'pick'; index: number }
  | { type: 'apply' }
  | { type: 'cashOut' }
  | { type: 'clear' };

export const initialState = (): GameState => ({
  phase: 'idle',
  round: null,
  pending: 0,
  burst: 0,
  picked: null,
  result: null,
  recent: [],
});

/** The starting urn, colours spread evenly so it looks mixed. Order doesn't affect the odds. */
export function startingBalls(preset: PresetId): Colour[] {
  const { blue, red } = PRESETS[preset];
  const total = blue + red;
  return Array.from({ length: total }, (_, i) =>
    Math.floor(((i + 1) * blue) / total) > Math.floor((i * blue) / total) ? 'blue' : 'red',
  );
}

export const currentCash = (r: Round) => r.prize * r.probs[r.probs.length - 1];
export const drawsLeft = (r: Round) => r.draws - r.history.length;

function finish(state: GameState, round: Round, mult: number, outcome: Outcome): GameState {
  const id = (state.recent[0]?.id ?? 0) + 1;
  return {
    ...state,
    phase: 'over',
    round,
    pending: 0,
    picked: null,
    result: { mult, outcome },
    recent: [{ id, mult }, ...state.recent].slice(0, 8),
  };
}

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'start': {
      const { blue, red } = PRESETS[action.preset];
      const round: Round = {
        preset: action.preset,
        draws: action.draws,
        bet: action.bet,
        prize: prize(action.preset, action.draws),
        balls: startingBalls(action.preset),
        blue,
        red,
        history: [],
        probs: [winProbability(blue, red, action.draws)],
      };
      // The first draw happens straight away; there's nothing to cash before it.
      return { ...state, phase: 'drawing', round, pending: 1, burst: 1, picked: null, result: null };
    }

    case 'draw': {
      if (state.phase !== 'checkpoint' || !state.round) return state;
      const count = Math.min(action.count, drawsLeft(state.round));
      return { ...state, phase: 'drawing', pending: count, burst: count };
    }

    case 'pick':
      return state.phase === 'drawing' ? { ...state, picked: action.index } : state;

    case 'apply': {
      const r = state.round;
      if (state.phase !== 'drawing' || !r || state.picked === null) return state;
      const colour = r.balls[state.picked];
      const blue = r.blue + (colour === 'blue' ? 1 : 0);
      const red = r.red + (colour === 'red' ? 1 : 0);
      const left = r.draws - r.history.length - 1;
      const p = winProbability(blue, red, left);
      const round: Round = {
        ...r,
        balls: [...r.balls, colour],
        blue,
        red,
        history: [...r.history, colour],
        probs: [...r.probs, p],
      };
      if (p === 1) return finish(state, round, r.prize, left === 0 ? 'won' : 'clinched');
      if (p === 0) return finish(state, round, 0, left === 0 ? 'lost' : 'sealed');
      const pending = state.pending - 1;
      return { ...state, round, picked: null, pending, phase: pending > 0 ? 'drawing' : 'checkpoint' };
    }

    case 'cashOut':
      if (state.phase !== 'checkpoint' || !state.round) return state;
      return finish(state, state.round, currentCash(state.round), 'cashed');

    case 'clear':
      return state.phase === 'over' ? { ...state, phase: 'idle', round: null, result: null } : state;
  }
}
