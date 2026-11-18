// Fairness audit: can any way of playing Grab beat the RTP?
//
// The only decision is when to stop: r is locked while live, each spin is offered only at a
// checkpoint (Spin and Cash out exist only there; Space and C call the same functions), and the
// first spin comes with the bet. A spin from state S has exactly 16 equally likely outcomes, so the
// martingale step is checked by exact enumeration with the game's own spin() and cashOf():
//   E[cash after the spin] = (1/16) * sum over wedges of cash(next state), red = 0,  equals cash(S).
// Strategies (per eval config) use the same functions in the game's order:
//   (a) spin while the next spin is >= 80% safe (not red), else cash out;
//   (b) cash out the moment the value exceeds the stake;
//   (c) play to the end;
//   (d) the grey chaser: cash out as soon as a hit lands, otherwise keep spinning to turn greys.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { REDS, RTP, cashOf, layout, redsOf, spin, type State } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 40_000);

type Stop = (s: State) => boolean;
const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) spin while >= 80% safe', stop: (s) => 1 - redsOf(s) / 16 < 0.8 },
  { name: '(b) take any profit', stop: (s) => cashOf(s) > 1 },
  { name: '(c) play to the end', stop: () => false },
  { name: '(d) cash out after the first hit', stop: (s) => s.hits >= 1 },
];

function play(r: number, stop: Stop, rng: Rng): number {
  let s: State = { wedges: layout(r), hits: 0 };
  for (;;) {
    const o = spin(s, rng.int(16));
    if (o.kind === 'red') return 0;
    s = o.state;
    if (s.hits >= 2) return cashOf(s);
    if (stop(s)) return cashOf(s);
  }
}

/** Reachable states: random plays, recording each checkpoint. */
function reached(count: number, rng: Rng): State[] {
  const out: State[] = [];
  while (out.length < count) {
    const r = REDS[out.length % REDS.length];
    let s: State = { wedges: layout(r), hits: 0 };
    for (;;) {
      const o = spin(s, rng.int(16));
      if (o.kind === 'red') break;
      s = o.state;
      if (s.hits >= 2) break;
      out.push(s);
    }
  }
  return out.slice(0, count);
}

describe('Grab fairness', () => {
  it('martingale (exact enumeration): E[cash after one spin] = cash now at 60+ reached states, incl. the start', () => {
    const rng = createRng(seededSource(4242));
    const states = [...REDS.map((r) => ({ wedges: layout(r), hits: 0 })), ...reached(60, rng)];
    expect(new Set(states.map((s) => s.hits)).size).toBe(2);
    for (const s of states) {
      let e = 0;
      for (let i = 0; i < 16; i++) {
        const o = spin(s, i);
        e += o.kind === 'red' ? 0 : cashOf(o.state);
      }
      expect(e / 16).toBeCloseTo(cashOf(s), 10);
    }
  });

  it('strategies (a)-(d) on every eval config return RTP within 4 SE, never above the manifest max', () => {
    evalSpec.configs.forEach(({ params: { r } }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const g = createRng(seededSource(900 + 10 * ci + si));
        let sum = 0;
        let sum2 = 0;
        let max = 0;
        for (let i = 0; i < ROUNDS; i++) {
          const x = play(r, stop, g);
          sum += x;
          sum2 += x * x;
          max = Math.max(max, x);
        }
        const mean = sum / ROUNDS;
        const se = Math.sqrt(Math.max(0, sum2 / ROUNDS - mean * mean) / ROUNDS);
        expect(Math.abs(mean - RTP), `${name} r=${r}`).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier);
      });
    });
  });
});
