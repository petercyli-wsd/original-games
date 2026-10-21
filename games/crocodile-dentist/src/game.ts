import { buildLadder, fmtMult, type Rung } from './math';

export type Phase = 'idle' | 'you' | 'house' | 'over';
export type Presser = 'you' | 'house';
export type Tone = 'neutral' | 'win' | 'lose';

export interface Round {
  bet: number;
  N: number;
  k: number;
  J: number;
  traps: number[];
  pressed: (Presser | null)[];
  ladder: Rung[];
  r: number; // index of the current rung
  cashMult: number; // 0 until the first round is survived
}

// Balance lives in the host wallet; the reducer only plays the round. A
// finished round's multiplier is history[0].mult, which the app settles.
export interface GameState {
  phase: Phase;
  round: Round | null;
  history: { mult: number; win: boolean }[];
  message: { text: string; tone: Tone };
  fx: { id: number; kind: Presser | null }; // drives the chomp animation
  houseTarget: number | null;
}

export type Action =
  | { type: 'start'; bet: number; N: number; k: number; J: number; rtp: number; traps: number[] }
  | { type: 'pressYou'; i: number }
  | { type: 'houseTarget'; i: number }
  | { type: 'pressHouse'; i: number }
  | { type: 'cashOut' }
  | { type: 'clear' };

export function initialState(): GameState {
  return {
    phase: 'idle',
    round: null,
    history: [],
    message: { text: 'Place a bet to open wide.', tone: 'neutral' },
    fx: { id: 0, kind: null },
    houseTarget: null,
  };
}

function finish(s: GameState, round: Round, mult: number, text: string, tone: Tone, chomp: Presser | null): GameState {
  return {
    ...s,
    round,
    phase: 'over',
    history: [{ mult, win: mult > 0 }, ...s.history].slice(0, 14),
    message: { text, tone },
    fx: chomp ? { id: s.fx.id + 1, kind: chomp } : s.fx,
    houseTarget: null,
  };
}

export function reducer(s: GameState, a: Action): GameState {
  switch (a.type) {
    case 'start': {
      if (s.phase === 'you' || s.phase === 'house') return s;
      if (!(a.bet > 0)) return s;
      return {
        ...s,
        phase: 'you',
        round: {
          bet: a.bet,
          N: a.N,
          k: a.k,
          J: a.J,
          traps: a.traps,
          pressed: Array(a.N).fill(null),
          ladder: buildLadder(a.N, a.k, a.J, a.rtp),
          r: 0,
          cashMult: 0,
        },
        message: { text: 'Your turn. Pick a tooth.', tone: 'neutral' },
        houseTarget: null,
      };
    }

    case 'pressYou': {
      const rd = s.round;
      if (s.phase !== 'you' || !rd || rd.pressed[a.i]) return s;
      const pressed = rd.pressed.slice();
      pressed[a.i] = 'you';
      const round = { ...rd, pressed };
      if (rd.traps.includes(a.i)) {
        return finish(s, round, 0, 'CHOMP! You got bitten.', 'lose', 'you');
      }
      return { ...s, round, phase: 'house', message: { text: "Phew, that one was safe. Now it's the House's turn…", tone: 'neutral' } };
    }

    case 'houseTarget':
      return s.phase === 'house' ? { ...s, houseTarget: a.i } : s;

    case 'pressHouse': {
      const rd = s.round;
      if (s.phase !== 'house' || !rd || rd.pressed[a.i]) return s;
      const pressed = rd.pressed.slice();
      pressed[a.i] = 'house';
      const rung = rd.ladder[rd.r];
      if (rd.traps.includes(a.i)) {
        return finish(s, { ...rd, pressed }, rung.bite, `CHOMP! The House got bitten. You win ${fmtMult(rung.bite)}`, 'win', 'house');
      }
      const round = { ...rd, pressed, r: rd.r + 1, cashMult: rung.next };
      const safeLeft = rd.N - rd.k - pressed.filter(Boolean).length;
      if (safeLeft <= 0) {
        return finish(s, round, rung.next, `All the good teeth are gone. Auto cash-out at ${fmtMult(rung.next)}`, 'win', null);
      }
      return {
        ...s,
        round,
        phase: 'you',
        houseTarget: null,
        message: { text: `Both safe. Cash out at ${fmtMult(rung.next)}, or press on.`, tone: 'neutral' },
      };
    }

    case 'cashOut': {
      const rd = s.round;
      if (s.phase !== 'you' || !rd || rd.r === 0) return s;
      return finish(s, rd, rd.cashMult, `Cashed out at ${fmtMult(rd.cashMult)}`, 'win', null);
    }

    case 'clear':
      if (s.phase !== 'over') return s;
      return { ...s, phase: 'idle', round: null, message: initialState().message };
  }
}
