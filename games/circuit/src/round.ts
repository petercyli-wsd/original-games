import { TOPOLOGIES, analysis, cashMultiplier, isLost, isWon, prize, type TopologyId } from './math';

export type Phase = 'idle' | 'probing' | 'checkpoint' | 'over';
export type Outcome = 'won' | 'lost' | 'cashed';

export interface Round {
  topo: TopologyId;
  bet: number;
  /** Shuffled reveal order, fixed at the start of the round. */
  order: number[];
  live: number;
  dead: number;
  /** The wire currently being tested (animating). */
  probing: number | null;
  /** The wire revealed most recently, for its hold/snap effect. */
  last: number | null;
  /** Reliability after each reveal, starting with R0. */
  trail: number[];
  outcome: Outcome | null;
  /** Settled multiplier once the round is over. */
  mult: number;
}

// Balance lives in the host wallet; the reducer only plays the round. When the
// phase becomes 'over' the app settles round.mult.
export interface GameState {
  phase: Phase;
  round: Round | null;
  history: { mult: number; outcome: Outcome }[];
}

export type Action =
  | { type: 'start'; topo: TopologyId; bet: number; order: number[]; first: number }
  | { type: 'probe'; wire: number }
  | { type: 'resolve'; holds: boolean }
  | { type: 'cashOut' }
  | { type: 'clear' };

export const initialState = (): GameState => ({ phase: 'idle', round: null, history: [] });

function finish(s: GameState, round: Round, outcome: Outcome, mult: number): GameState {
  return {
    phase: 'over',
    round: { ...round, outcome, mult, probing: null },
    history: [{ mult, outcome }, ...s.history].slice(0, 12),
  };
}

export function reducer(s: GameState, a: Action): GameState {
  switch (a.type) {
    case 'start': {
      if (s.phase === 'probing' || s.phase === 'checkpoint') return s;
      const t = TOPOLOGIES[a.topo];
      return {
        ...s,
        phase: 'probing',
        round: {
          topo: a.topo,
          bet: a.bet,
          order: a.order,
          live: 0,
          dead: 0,
          probing: a.first,
          last: null,
          trail: [analysis(t, 0, 0).r],
          outcome: null,
          mult: 0,
        },
      };
    }

    case 'probe':
      if (s.phase !== 'checkpoint' || !s.round) return s;
      return { ...s, phase: 'probing', round: { ...s.round, probing: a.wire } };

    case 'resolve': {
      const rd = s.round;
      if (s.phase !== 'probing' || !rd || rd.probing === null) return s;
      const t = TOPOLOGIES[rd.topo];
      const bit = 1 << rd.probing;
      const live = a.holds ? rd.live | bit : rd.live;
      const dead = a.holds ? rd.dead : rd.dead | bit;
      const r = analysis(t, live, dead).r;
      const round: Round = { ...rd, live, dead, probing: null, last: rd.probing, trail: [...rd.trail, r] };
      if (isWon(t, live)) return finish(s, round, 'won', prize(t));
      if (isLost(t, dead)) return finish(s, round, 'lost', 0);
      return { ...s, phase: 'checkpoint', round };
    }

    case 'cashOut': {
      const rd = s.round;
      if (s.phase !== 'checkpoint' || !rd) return s;
      const t = TOPOLOGIES[rd.topo];
      return finish(s, rd, 'cashed', cashMultiplier(t, analysis(t, rd.live, rd.dead).r));
    }

    case 'clear':
      return s.phase === 'over' ? { ...s, phase: 'idle', round: null } : s;
  }
}
