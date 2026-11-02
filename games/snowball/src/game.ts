// Round state machine. The wallet lives in the host; the reducer only plays the
// round. A finished round's multiplier is `result.mult`, which the app settles.
// Randomness is injected through the `draw` action (the ball index is chosen
// when the draw starts), so the reducer stays pure and a draw's result is fixed
// before its animation plays.

import { MAJORITY, PRESETS, prize, winChance, type Colour, type PresetId } from './math';

/** live: waiting for Draw or Cash out. drawing: a ball is out of the urn. */
export type Phase = 'idle' | 'live' | 'drawing' | 'over';

export type Outcome =
  | 'cashed' // player took M × P_t
  | 'won' // blue reached the majority of draws
  | 'lost'; // red did

export interface Round {
  preset: PresetId;
  bet: number;
  prize: number;
  /** Urn contents in the order they went in; twins are appended. */
  balls: Colour[];
  /** Colour of each draw so far. */
  history: Colour[];
  /** Win chance after t draws; probs[0] is the starting chance. */
  probs: number[];
}

export interface Drawing {
  /** Index of the ball taken out of the urn. */
  index: number;
  /** True once its twin is shown next to it, just before both go back in. */
  twin: boolean;
}

export interface GameState {
  phase: Phase;
  round: Round | null;
  /** The ball being drawn, while it is out of the urn. */
  drawing: Drawing | null;
  /** The last ball drawn (its twin is the last ball in the urn), for highlighting. */
  lastDrawn: number | null;
  result: { mult: number; outcome: Outcome } | null;
  recent: { id: number; mult: number }[];
}

export type Action =
  | { type: 'start'; bet: number; preset: PresetId }
  | { type: 'draw'; index: number }
  | { type: 'twin' }
  | { type: 'apply' }
  | { type: 'cashOut' }
  | { type: 'clear' };

export const initialState = (): GameState => ({
  phase: 'idle',
  round: null,
  drawing: null,
  lastDrawn: null,
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

export const newRound = (preset: PresetId, bet: number): Round => ({
  preset,
  bet,
  prize: prize(preset),
  balls: startingBalls(preset),
  history: [],
  probs: [winChance(preset, 0, 0)],
});

export const drawnCounts = (r: Round) => {
  const blue = r.history.filter((c) => c === 'blue').length;
  return { blue, red: r.history.length - blue };
};
export const currentChance = (r: Round) => r.probs[r.probs.length - 1];
export const currentCash = (r: Round) => r.prize * currentChance(r);

function finish(state: GameState, round: Round, mult: number, outcome: Outcome): GameState {
  const id = (state.recent[0]?.id ?? 0) + 1;
  return {
    ...state,
    phase: 'over',
    round,
    drawing: null,
    result: { mult, outcome },
    recent: [{ id, mult }, ...state.recent].slice(0, 8),
  };
}

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'start':
      // Betting only fills the urn; the first ball comes out on Draw.
      return {
        ...state,
        phase: 'live',
        round: newRound(action.preset, action.bet),
        drawing: null,
        lastDrawn: null,
        result: null,
      };

    case 'draw':
      if (state.phase !== 'live' || !state.round) return state;
      return { ...state, phase: 'drawing', drawing: { index: action.index, twin: false }, lastDrawn: null };

    case 'twin':
      return state.phase === 'drawing' && state.drawing ? { ...state, drawing: { ...state.drawing, twin: true } } : state;

    case 'apply': {
      const r = state.round;
      if (state.phase !== 'drawing' || !r || !state.drawing) return state;
      const colour = r.balls[state.drawing.index];
      const history = [...r.history, colour];
      const blue = history.filter((c) => c === 'blue').length;
      const red = history.length - blue;
      const p = winChance(r.preset, blue, red);
      const round: Round = { ...r, balls: [...r.balls, colour], history, probs: [...r.probs, p] };
      const next = { ...state, lastDrawn: state.drawing.index };
      if (blue >= MAJORITY) return finish(next, round, r.prize, 'won');
      if (red >= MAJORITY) return finish(next, round, 0, 'lost');
      return { ...next, round, drawing: null, phase: 'live' };
    }

    case 'cashOut':
      // Nothing to cash before the first draw.
      if (state.phase !== 'live' || !state.round || state.round.history.length === 0) return state;
      return finish(state, state.round, currentCash(state.round), 'cashed');

    case 'clear':
      return state.phase === 'over' ? { ...state, phase: 'idle', round: null, result: null, lastDrawn: null } : state;
  }
}

/**
 * What the round is worth right now, counting a draw already under way as
 * done: leaving mid-animation settles at the drawn result, not the old value.
 */
export function settledValue(state: GameState): number {
  if (state.phase === 'over' && state.result) return state.result.mult;
  if (!state.round) return 0;
  if (state.phase === 'drawing') return settledValue(reducer(state, { type: 'apply' }));
  return currentCash(state.round);
}
