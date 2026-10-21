import type { Presser } from '@originals/crocodile-dentist/croc';
import { buildLadder, fmtMult, type Step } from './math';

export type Phase = 'idle' | 'playing' | 'over';
export type Tone = 'neutral' | 'win' | 'lose';

export interface Round {
  bet: number;
  N: number;
  k: number;
  traps: number[];
  pressed: (Presser | null)[];
  ladder: Step[];
  safe: number; // safe presses so far
}

// Balance lives in the host wallet; the reducer only plays the round. A
// finished round's multiplier is history[0].mult, which the app settles.
export interface GameState {
  phase: Phase;
  round: Round | null;
  history: { mult: number; win: boolean }[];
  message: { text: string; tone: Tone };
  fx: { id: number; kind: Presser | null }; // drives the chomp animation
}

export type Action =
  | { type: 'start'; bet: number; N: number; k: number; rtp: number; traps: number[] }
  | { type: 'press'; i: number }
  | { type: 'cashOut' }
  | { type: 'clear' };

export function initialState(): GameState {
  return {
    phase: 'idle',
    round: null,
    history: [],
    message: { text: 'Place a bet to open wide.', tone: 'neutral' },
    fx: { id: 0, kind: null },
  };
}

/** Cash-out multiplier banked so far (0 before the first safe press). */
export const banked = (rd: Round) => (rd.safe > 0 ? rd.ladder[rd.safe - 1].mult : 0);

function finish(s: GameState, round: Round, mult: number, text: string, tone: Tone, chomp: boolean): GameState {
  return {
    ...s,
    round,
    phase: 'over',
    history: [{ mult, win: mult > 0 }, ...s.history].slice(0, 14),
    message: { text, tone },
    fx: chomp ? { id: s.fx.id + 1, kind: 'you' } : s.fx,
  };
}

export function reducer(s: GameState, a: Action): GameState {
  switch (a.type) {
    case 'start': {
      if (s.phase === 'playing' || !(a.bet > 0)) return s;
      return {
        ...s,
        phase: 'playing',
        round: {
          bet: a.bet,
          N: a.N,
          k: a.k,
          traps: a.traps,
          pressed: Array(a.N).fill(null),
          ladder: buildLadder(a.N, a.k, a.rtp),
          safe: 0,
        },
        message: { text: 'Pick a tooth. Gently…', tone: 'neutral' },
      };
    }

    case 'press': {
      const rd = s.round;
      if (s.phase !== 'playing' || !rd || rd.pressed[a.i]) return s;
      const pressed = rd.pressed.slice();
      pressed[a.i] = 'you';
      if (rd.traps.includes(a.i)) {
        return finish(s, { ...rd, pressed }, 0, 'CHOMP! You got bitten.', 'lose', true);
      }
      const round = { ...rd, pressed, safe: rd.safe + 1 };
      const mult = banked(round);
      if (round.safe === rd.N - rd.k) {
        return finish(s, round, mult, `Every good tooth pressed! Paid ${fmtMult(mult)}`, 'win', false);
      }
      return { ...s, round, message: { text: `Safe. Cash out at ${fmtMult(mult)}, or press another.`, tone: 'neutral' } };
    }

    case 'cashOut': {
      const rd = s.round;
      if (s.phase !== 'playing' || !rd || rd.safe === 0) return s;
      const mult = banked(rd);
      return finish(s, rd, mult, `Cashed out at ${fmtMult(mult)}`, 'win', false);
    }

    case 'clear':
      if (s.phase !== 'over') return s;
      return { ...s, phase: 'idle', round: null, message: initialState().message };
  }
}
