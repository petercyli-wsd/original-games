import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  DICE,
  GATE_COUNTS,
  LAST_SQUARE,
  MAX_MULTIPLIER,
  PRESETS,
  RTP,
  SQUARES,
  applyRoll,
  cashValue,
  faceKinds,
  hitChance,
  landingProfile,
  moveGate,
  overshootChance,
  prizeFor,
  randomGates,
  renewalLimit,
  winChance,
  type Die,
} from './math';

const rng = createRng(seededSource(11));

/** Plays the raw process: roll until the token reaches or passes the last gate. */
function simulateWin(gates: readonly number[], d: Die, pos = 0, next = 0): boolean {
  let x = pos;
  for (let i = next; i < gates.length; i++) {
    while (x < gates[i]) x += 1 + rng.int(d);
    if (x !== gates[i]) return false;
  }
  return true;
}

/** A reachable live state: play a few safe rolls from square 0. */
function randomState(gates: readonly number[], d: Die) {
  let pos = 0;
  let next = 0;
  const rolls = rng.int(8);
  for (let r = 0; r < rolls; r++) {
    const kinds = faceKinds(gates, d, pos, next);
    const safe = kinds.flatMap((k, i) => (k === 'over' ? [] : [i + 1]));
    const roll = applyRoll(gates, pos, next, safe[rng.int(safe.length)]);
    if (roll.outcome === 'win') break;
    pos = roll.to;
    next = roll.next;
  }
  return { pos, next };
}

/** Independent check of the drawn bars: push probability mass forward square by square. */
function forwardLanding(gates: readonly number[], d: Die, pos: number, next: number): Float64Array {
  const mass = new Float64Array(SQUARES + d + 1);
  mass[pos] = 1;
  const last = gates[gates.length - 1];
  for (let p = pos; p < last; p++) {
    if (!mass[p]) continue;
    const gate = gates.find((g, i) => i >= next && g > p)!;
    for (let j = 1; j <= d; j++) if (p + j <= gate) mass[p + j] += mass[p] / d;
  }
  const out = new Float64Array(SQUARES);
  for (let n = pos + 1; n <= last; n++) out[n] = mass[n];
  return out;
}

const layouts = (): { d: Die; gates: readonly number[] }[] =>
  DICE.flatMap((d) => [
    ...GATE_COUNTS.map((k) => ({ d, gates: PRESETS[k] })),
    ...[1, 2, 3, 4].map((k) => ({ d, gates: randomGates(k, rng) })),
  ]);

describe('Landing maths', () => {
  it('renewal recursion: u(n) = (1 + 1/d)^(n-1) / d up to d, then settles on 2/(d+1)', () => {
    for (const d of DICE) {
      expect(hitChance(0, d)).toBe(1);
      expect(hitChance(-3, d)).toBe(0);
      for (let n = 1; n <= d; n++) expect(hitChance(n, d)).toBeCloseTo((1 + 1 / d) ** (n - 1) / d, 14);
      // The renewal theorem: the limit is 1 / mean step.
      expect(Math.abs(hitChance(SQUARES + d - 1, d) - renewalLimit(d))).toBeLessThan(d === 10 ? 2e-3 : 1e-6);
      // Every u(n) is at least 1/d: the bound behind maxMultiplier.
      for (let n = 1; n < SQUARES + d; n++) expect(hitChance(n, d)).toBeGreaterThanOrEqual(1 / d - 1e-15);
    }
  });

  it('the exact win chance matches a simulation of the raw die rolls (4 SE)', () => {
    for (const { d, gates } of layouts()) {
      const rounds = 12_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) if (simulateWin(gates, d)) wins++;
      const p = winChance(gates, d);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
    }
    // And from mid-round states.
    for (let t = 0; t < 12; t++) {
      const d = DICE[t % 3];
      const gates = PRESETS[GATE_COUNTS[t % 4]];
      const { pos, next } = randomState(gates, d);
      const rounds = 8_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) if (simulateWin(gates, d, pos, next)) wins++;
      const p = winChance(gates, d, pos, next);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
    }
  });

  it('each roll is a fair bet: the average cash-out over the d faces equals the cash-out now', () => {
    for (let t = 0; t < 400; t++) {
      const d = DICE[rng.int(3)];
      const gates = rng.next() < 0.5 ? PRESETS[GATE_COUNTS[rng.int(4)]] : randomGates(1 + rng.int(4), rng);
      const { pos, next } = randomState(gates, d);
      const prize = prizeFor(gates, d);
      const now = cashValue(gates, d, pos, next);
      let after = 0;
      for (let face = 1; face <= d; face++) {
        const r = applyRoll(gates, pos, next, face);
        after += (r.outcome === 'bust' ? 0 : r.outcome === 'win' ? prize : cashValue(gates, d, r.to, r.next)) / d;
      }
      expect(Math.abs(after - now)).toBeLessThan(1e-12 * Math.max(1, now));
    }
    // The round starts at RTP.
    for (const { d, gates } of layouts()) expect(cashValue(gates, d, 0, 0)).toBeCloseTo(RTP, 12);
  });

  it('the drawn odds are the true odds: square bars, gate values and the red faces', () => {
    for (let t = 0; t < 300; t++) {
      const d = DICE[rng.int(3)];
      const gates = rng.next() < 0.5 ? PRESETS[GATE_COUNTS[rng.int(4)]] : randomGates(1 + rng.int(4), rng);
      const { pos, next } = randomState(gates, d);
      const drawn = landingProfile(gates, d, pos, next);
      const truth = forwardLanding(gates, d, pos, next);
      for (let n = 0; n < SQUARES; n++) expect(Math.abs(drawn[n] - truth[n])).toBeLessThan(1e-12);
      // The last gate's bar is the win chance shown in the readout and the chance bar.
      expect(Math.abs(drawn[gates[gates.length - 1]] - winChance(gates, d, pos, next))).toBeLessThan(1e-12);
      // Each face is 1/d; the red ones are exactly the rolls that bust.
      let bust = 0;
      for (let face = 1; face <= d; face++) if (applyRoll(gates, pos, next, face).outcome === 'bust') bust++;
      expect(overshootChance(gates, d, pos, next)).toBe(bust / d);
      // The reachable squares carry the next roll's chances: the gate face is green iff the gate is in reach.
      const g = gates[next];
      expect(faceKinds(gates, d, pos, next).includes('gate')).toBe(g - pos <= d);
    }
  });

  it('moving a gate keeps the count, the order and distinct squares', () => {
    for (let t = 0; t < 200; t++) {
      const gates = randomGates(1 + rng.int(4), rng);
      const square = rng.int(SQUARES + 2);
      const moved = moveGate(gates, square);
      expect(moved.length).toBe(gates.length);
      expect(new Set(moved).size).toBe(moved.length);
      expect([...moved].sort((a, b) => a - b)).toEqual(moved);
      for (const g of moved) expect(g >= 1 && g <= LAST_SQUARE).toBe(true);
    }
  });

  it('the max win is honest: adjacent gates with a d10 reach it exactly', () => {
    expect(prizeFor([1, 2, 3, 4], 10)).toBeCloseTo(MAX_MULTIPLIER, 6);
    for (const { d, gates } of layouts()) expect(prizeFor(gates, d)).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
