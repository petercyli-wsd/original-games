// Fairness audit: can any way of playing Waldegrave beat the RTP?
//
// The round is a Markov chain on (champion's streak s, position of the backed
// seat in the queue). Each duel is a fair coin (rng.next() < ½). The cash-out
// is prize × P(win | state) from an exact rational solve of the chain, and
// the round settles at the prize or 0 the moment someone takes the pot, so
// the value is a bounded martingale starting at RTP; by optional stopping
// every rule returns RTP.
//
// Decisions mid-round: cash out, play one duel, or "Play it out" (every duel
// until the pot is taken, no stop in between). Seat, back / lay, players and
// streak are locked while live. "Play it out" is just a stopping rule that
// never stops, so every way of playing is a stopping rule on this chain. Bet
// plays the opening duel straight away: no decision at streak 0.
//
// Checks, with the game's own functions (newDuel, playDuel, cashValue,
// winChance, prizeFor) and Game.tsx's settlement (winner → prize if
// winChance = 1, else 0):
//   - martingale: at every (streak, position) state of all 72 settings, and at
//     40+ states reached by random play, E[V after the next duel] = V (1e-12);
//   - optimal stopping: the Snell envelope over the chain equals V, so no
//     strategy beats RTP;
//   - strategies (a)–(d) exactly (value iteration on the chain) on every
//     setting, and by Monte Carlo through playDuel on every eval config.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { RTP, allSettings, cashValue, newDuel, playDuel, prizeFor, winChance, type Duel, type Settings } from './math';

/** Rounds per strategy run; the audit's heavy run sets FAIRNESS_ROUNDS (scratch fairness/run-heavy-waldegrave…sh). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

const SETTINGS = allSettings();
const EVAL = evalSpec.configs;

/** Game.tsx's value of a state: the settled payout once someone takes the pot, else the cash-out. */
function value(d: Duel, s: Settings): number {
  if (d.winner !== null) return winChance(d, s.streak, s.seat, s.side) === 1 ? prizeFor(s) : 0;
  return cashValue(d, s);
}

/** A duel state with the backed seat at `pos` and the champion on streak `streak` (other seats in any order). */
function stateAt(s: Settings, streak: number, pos: number): Duel {
  const others = Array.from({ length: s.players }, (_, i) => i).filter((i) => i !== s.seat);
  const order = [...others.slice(0, pos), s.seat, ...others.slice(pos)];
  return { order, streak, winner: null, duels: 1 };
}

/** Every live state of the chain after the opening duel: streak 1 … k−1, seat at any position. */
function liveStates(s: Settings): Duel[] {
  const out: Duel[] = [];
  for (let st = 1; st < s.streak; st++) for (let pos = 0; pos < s.players; pos++) out.push(stateAt(s, st, pos));
  return out;
}

const keyOf = (d: Duel, s: Settings) => `${d.streak}:${d.order.indexOf(s.seat)}`;

/** P(the next duel doesn't settle the bet as lost). */
function survival(d: Duel, s: Settings): number {
  let p = 0;
  for (const w of [true, false]) {
    const nx = playDuel(d, s.streak, w);
    if (!(nx.winner !== null && value(nx, s) === 0)) p += 0.5;
  }
  return p;
}

type Stop = (d: Duel, s: Settings) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) duel while survival ≥ 0.8', stop: (d, s) => survival(d, s) < 0.8 },
  { name: '(b) take any profit', stop: (d, s) => cashValue(d, s) > 1 },
  { name: '(c) play it out', stop: () => false },
  // Ride the swings: stop the moment the next duel could cost half the value,
  // or when ahead by 50%, or when the backed seat (or, laid, anyone else) holds the table.
  {
    name: '(d) stop at 1.5×, on a 50% drop risk, or holding the table',
    stop: (d, s) => {
      const v = cashValue(d, s);
      const lo = Math.min(value(playDuel(d, s.streak, true), s), value(playDuel(d, s.streak, false), s));
      const holds = s.side === 'back' ? d.order[0] === s.seat : d.order[0] !== s.seat && d.order[1] !== s.seat;
      return v >= 1.5 || lo <= 0.5 * v || holds;
    },
  },
];

/** Exact value of a stopping rule: value iteration on the finite chain, then the forced opening duel. */
function exactValue(s: Settings, stop: Stop | null): number {
  const states = liveStates(s);
  const idx = new Map(states.map((d, i) => [keyOf(d, s), i]));
  const next = states.map((d) => [true, false].map((w) => playDuel(d, s.streak, w)));
  const stops = states.map((d) => stop?.(d, s) ?? false);
  const cash = states.map((d) => cashValue(d, s));
  let v = cash.slice();
  const g = (nx: Duel, vv: number[]) => (nx.winner !== null ? value(nx, s) : vv[idx.get(keyOf(nx, s))!]);
  for (let it = 0; it < 100_000; it++) {
    let diff = 0;
    const nv = states.map((_, i) => {
      const cont = 0.5 * g(next[i][0], v) + 0.5 * g(next[i][1], v);
      // stop === null: the Snell envelope (stop whenever stopping is better).
      const x = stop === null ? Math.max(cash[i], cont) : stops[i] ? cash[i] : cont;
      diff = Math.max(diff, Math.abs(x - v[i]));
      return x;
    });
    v = nv;
    if (diff < 1e-15) break;
  }
  if (stop === null) states.forEach((_, i) => expect(Math.abs(v[i] - cash[i])).toBeLessThan(1e-11));
  const d0 = newDuel(s.players);
  return 0.5 * g(playDuel(d0, s.streak, true), v) + 0.5 * g(playDuel(d0, s.streak, false), v);
}

/** One round through playDuel, as Game.tsx plays it. */
function playRound(s: Settings, stop: Stop, rng: Rng): number {
  let d = newDuel(s.players);
  for (;;) {
    d = playDuel(d, s.streak, rng.next() < 0.5);
    if (d.winner !== null) return value(d, s);
    if (stop(d, s)) return cashValue(d, s);
  }
}

describe('Waldegrave fairness', () => {
  it('the value is a martingale at every state of every setting (exact, 1e-12)', () => {
    let n = 0;
    for (const s of SETTINGS) {
      // The opening state, every live state, and states reached by random play.
      const rng = createRng(seededSource(s.players * 100 + s.streak * 10 + s.seat + (s.side === 'lay' ? 7 : 0)));
      const seen: Duel[] = [newDuel(s.players), ...liveStates(s)];
      let d = newDuel(s.players);
      for (let k = 0; k < 12; k++) {
        d = playDuel(d, s.streak, rng.next() < 0.5);
        if (d.winner !== null) d = newDuel(s.players);
        else seen.push(d);
      }
      for (const st of seen) {
        const v = cashValue(st, s);
        const after = 0.5 * value(playDuel(st, s.streak, true), s) + 0.5 * value(playDuel(st, s.streak, false), s);
        expect(Math.abs(after - v)).toBeLessThan(1e-12);
        n++;
      }
      expect(Math.abs(cashValue(newDuel(s.players), s) - RTP)).toBeLessThan(1e-12);
    }
    expect(n).toBeGreaterThan(30);
  });

  it('optimal stopping: the Snell envelope equals the cash-out everywhere, so nothing beats RTP', () => {
    for (const s of SETTINGS) expect(Math.abs(exactValue(s, null) - RTP)).toBeLessThan(1e-11);
  });

  it('strategies (a)–(d) are worth exactly RTP on every setting', () => {
    for (const s of SETTINGS) for (const { stop } of STRATEGIES) expect(Math.abs(exactValue(s, stop) - RTP)).toBeLessThan(1e-11);
  });

  it(`strategies (a)–(d) through playDuel return RTP on every eval config (${ROUNDS} rounds, 4 SE)`, () => {
    const rows: string[] = [];
    for (const [ci, { label, params: s }] of EVAL.entries()) {
      for (const [si, { name, stop }] of STRATEGIES.entries()) {
        const rng = createRng(seededSource(9001 + ci * 31 + si));
        let sum = 0;
        let sq = 0;
        for (let i = 0; i < ROUNDS; i++) {
          const x = playRound(s, stop, rng);
          sum += x;
          sq += x * x;
        }
        const mean = sum / ROUNDS;
        const se = Math.sqrt(Math.max(0, sq / ROUNDS - mean * mean) / ROUNDS);
        rows.push(`${label} | ${name} | ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
      }
    }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
