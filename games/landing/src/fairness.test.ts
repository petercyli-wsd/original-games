// Fairness audit: can any way of playing Landing beat the RTP?
//
// The die and the gates are fixed at the bet (the chips and the board are
// disabled while live), so the only decision in a round is when to stop. If the
// cash-out is a martingale, no stopping rule can beat RTP (optional stopping). Every roll is
// `applyRoll(gates, pos, next, 1 + rng.int(die))`, with the cash-out after it
// computed as Game.tsx's doRoll() does (bust → 0, last gate → prize, else
// prize · winChance).
//
// Martingale check, exact: for every die, the eval presets, random layouts
// (as the eval samples them) and adversarial layouts (adjacent gates, a gate on
// square 1, gates d apart where u peaks, a gate on the last square), at EVERY
// live state (token on any square before the next gate), the d faces are
// enumerated through applyRoll and E[cash-out after] must equal the cash-out
// now to 1e-12. Every layout's start value must be RTP.
//
// Strategies, per eval config: (a) the tester's: roll while the overshoot
// chance is ≤ 20%, else cash out; (b) cash out the moment the cash-out exceeds
// the bet; (c) play to the last gate; (d) lock in at gates: cash out on a gate
// when in profit, otherwise roll while the overshoot chance is ≤ 50%;
// (e) "free rolls only": after the first roll, roll only while no face can
// overshoot (the steps the tester calls free), else cash out. Each is valued
// exactly by backward induction over the squares (the binding check: the
// extreme config pays ~1000× and can't reach a 0.3% SE by sampling), then
// played on the real functions with the seeded RNG.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { DICE, LAST_SQUARE, MAX_MULTIPLIER, PRESETS, RTP, applyRoll, overshootChance, prizeFor, randomGates, winChance, type Die } from './math';

/** Rounds per strategy run; the heavy audit run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

type Gates = readonly number[];

/** The cash-out after a roll, as Game.tsx's doRoll() computes it. */
function rollValue(gates: Gates, die: Die, prize: number, pos: number, next: number, face: number) {
  const res = applyRoll(gates, pos, next, face);
  const cash = res.outcome === 'bust' ? 0 : res.outcome === 'win' ? prize : prize * winChance(gates, die, res.to, res.next);
  return { res, cash };
}

/** Every live state: the token on any square from the last gate landed (or 0) up to the next gate. */
function liveStates(gates: Gates): { pos: number; next: number }[] {
  const out: { pos: number; next: number }[] = [];
  for (let next = 0; next < gates.length; next++) for (let pos = next ? gates[next - 1] : 0; pos < gates[next]; pos++) out.push({ pos, next });
  return out;
}

const rng0 = createRng(seededSource(77));
const LAYOUTS: Gates[] = [
  ...Object.values(PRESETS),
  [1],
  [1, 2, 3, 4],
  [LAST_SQUARE],
  [56, 57, 58, LAST_SQUARE],
  [4, 8, 12, 16],
  [6, 12, 18, 24],
  [10, 20, 30, 40],
  [2, 13, 37, LAST_SQUARE],
  ...[1, 2, 3, 4, 1, 2, 3, 4].map((k) => randomGates(k, rng0)),
];

interface Ctx {
  gates: Gates;
  die: Die;
  prize: number;
  pos: number;
  next: number;
  cash: number;
}
/** A strategy: at a checkpoint, cash out now? */
type Stop = (c: Ctx) => boolean;

const onGate = (c: Ctx) => c.next > 0 && c.pos === c.gates[c.next - 1];
const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) roll while ≤ 20% overshoot', stop: (c) => overshootChance(c.gates, c.die, c.pos, c.next) > 0.2 },
  { name: '(b) take any profit', stop: (c) => c.cash > 1 },
  { name: '(c) play to the last gate', stop: () => false },
  { name: '(d) lock in on a gate in profit, else roll while ≤ 50% overshoot', stop: (c) => (onGate(c) && c.cash > 1) || overshootChance(c.gates, c.die, c.pos, c.next) > 0.5 },
  { name: '(e) free rolls only', stop: (c) => overshootChance(c.gates, c.die, c.pos, c.next) > 0 },
];

/** Exact value of a stopping rule by backward induction (the first roll is made at the bet). */
function exactRtp(gates: Gates, die: Die, stop: Stop): number {
  const prize = prizeFor(gates, die);
  const memo = new Map<number, number>();
  const roll = (pos: number, next: number): number => {
    let ev = 0;
    for (let face = 1; face <= die; face++) {
      const { res, cash } = rollValue(gates, die, prize, pos, next, face);
      ev += (res.outcome === 'bust' || res.outcome === 'win' ? cash : value(res.to, res.next, cash)) / die;
    }
    return ev;
  };
  const value = (pos: number, next: number, cash: number): number => {
    const key = pos * 8 + next;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const v = stop({ gates, die, prize, pos, next, cash }) ? cash : roll(pos, next);
    memo.set(key, v);
    return v;
  };
  return roll(0, 0);
}

function playRound(gates: Gates, die: Die, stop: Stop, rng: Rng): number {
  const prize = prizeFor(gates, die);
  let pos = 0;
  let next = 0;
  for (;;) {
    const { res, cash } = rollValue(gates, die, prize, pos, next, 1 + rng.int(die));
    if (res.outcome === 'bust' || res.outcome === 'win') return cash;
    pos = res.to;
    next = res.next;
    if (stop({ gates, die, prize, pos, next, cash })) return cash;
  }
}

function mc(gates: Gates, die: Die, stop: Stop, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s1 = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = playRound(gates, die, stop, rng);
    s1 += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s1 / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

describe('Landing fairness', () => {
  it('martingale: at every live state of every die × layout, E[cash-out after the roll] = cash-out now (d faces enumerated)', () => {
    let checked = 0;
    for (const die of DICE)
      for (const gates of LAYOUTS) {
        const prize = prizeFor(gates, die);
        expect(Math.abs(prize * winChance(gates, die) - RTP)).toBeLessThan(1e-12);
        expect(prize).toBeLessThanOrEqual(MAX_MULTIPLIER);
        for (const { pos, next } of [{ pos: 0, next: 0 }, ...liveStates(gates)]) {
          const now = prize * winChance(gates, die, pos, next);
          let after = 0;
          for (let face = 1; face <= die; face++) after += rollValue(gates, die, prize, pos, next, face).cash / die;
          expect(Math.abs(after - now)).toBeLessThan(1e-12 * Math.max(1, prize));
          // The faces the strip paints red are exactly the rolls that bust.
          let busts = 0;
          for (let face = 1; face <= die; face++) if (applyRoll(gates, pos, next, face).outcome === 'bust') busts++;
          expect(busts / die).toBe(overshootChance(gates, die, pos, next));
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(1000);
  });

  it('exact strategy values: every strategy returns RTP to 1e-12 on every die × layout', () => {
    for (const die of DICE)
      for (const gates of LAYOUTS)
        for (const st of STRATEGIES) expect(Math.abs(exactRtp(gates, die, st.stop) - RTP), `d${die} ${gates.join('·')} ${st.name}`).toBeLessThan(1e-12);
  });

  it(`Monte Carlo (${ROUNDS} rounds per strategy and eval config, real applyRoll + seeded RNG): within 4 SE of RTP`, () => {
    const rows: string[] = [];
    evalSpec.configs.forEach((cfg, ci) =>
      STRATEGIES.forEach((st, si) => {
        const { die, gates } = cfg.params;
        const r = mc(gates, die, st.stop, ROUNDS, 500 + 10 * ci + si);
        rows.push(`${cfg.label} | ${st.name} | ${(100 * r.mean).toFixed(2)}% ± ${(100 * r.se).toFixed(2)}% | max ${r.max.toFixed(1)}`);
        expect(Math.abs(r.mean - RTP), `${cfg.label} ${st.name}`).toBeLessThan(4 * r.se + 1e-9);
        expect(r.max).toBeLessThanOrEqual(MAX_MULTIPLIER);
      }),
    );
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
