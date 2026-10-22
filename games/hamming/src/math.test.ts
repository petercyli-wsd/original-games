import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  ALL_SETTINGS,
  BITS,
  BLOCKS,
  NOISES,
  START,
  blockBars,
  blockChance,
  cashAt,
  recovers,
  decodeChance,
  decided,
  encode,
  flipSyndrome,
  prizeFor,
  sendBit,
  winChance,
  type Settings,
  type State,
} from './math';

const rng = createRng(seededSource(11));

/** Every reachable live state for the settings. */
function liveStates(s: Settings): State[] {
  const out: State[] = [];
  for (let block = 0; block < s.blocks; block++)
    for (let sent = 0; sent <= BITS; sent++)
      for (let flips = 0; flips <= Math.min(1, sent); flips++) {
        const st = { block, sent, flips };
        if (!decided(s, st)) out.push(st);
      }
  return out;
}

describe('Hamming maths', () => {
  it('Hamming(7,4) recovers the message exactly when at most one of the 7 bits flips (all 16 × 128 cases)', () => {
    for (let m = 0; m < 16; m++) {
      const data = [m & 1, (m >> 1) & 1, (m >> 2) & 1, (m >> 3) & 1];
      const code = encode(data);
      for (let e = 0; e < 128; e++) {
        const received = code.map((b, i) => b ^ ((e >> i) & 1));
        const weight = received.reduce((w, b, i) => w + (b ^ code[i]), 0);
        expect(recovers(received, data)).toBe(weight <= 1);
      }
    }
  });

  it('the syndrome lit by the circles names the single flipped position', () => {
    for (let i = 0; i < BITS; i++) {
      const flipped = Array.from({ length: BITS }, (_, j) => j === i);
      expect(flipSyndrome(flipped)).toBe(i + 1);
    }
  });

  it('simulated channel: k blocks all decode with probability D^k', () => {
    for (const noise of NOISES) {
      for (const blocks of BLOCKS) {
        const rounds = 6000;
        let ok = 0;
        for (let r = 0; r < rounds; r++) {
          let all = true;
          for (let b = 0; b < blocks && all; b++) {
            const data = [0, 0, 0, 0].map(() => rng.int(2));
            const received = encode(data).map((bit) => bit ^ (rng.next() < noise / 100 ? 1 : 0));
            all = recovers(received, data);
          }
          if (all) ok++;
        }
        const p = blockChance(noise) ** blocks;
        expect(Math.abs(ok / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
      }
    }
  });

  it('D(p) matches the catalogue values', () => {
    expect(blockChance(10)).toBeCloseTo(0.9 ** 7 + 0.7 * 0.9 ** 6, 14);
    expect(blockChance(30)).toBeCloseTo(0.3294172, 6);
  });

  it('each bit is a fair bet: E[cash-out after one bit] = cash-out now, at every live state', () => {
    for (const s of ALL_SETTINGS) {
      const p = s.noise / 100;
      expect(cashAt(s, START)).toBeCloseTo(0.99, 12);
      for (const st of liveStates(s)) {
        const settle = (x: State) => (decided(s, x) ? prizeFor(s) * winChance(s, x) : cashAt(s, x));
        const next = (1 - p) * settle(sendBit(st, false)) + p * settle(sendBit(st, true));
        expect(Math.abs(next - cashAt(s, st))).toBeLessThan(1e-9 * Math.max(1, cashAt(s, st)));
      }
    }
  });

  it('the block bars on the board multiply to the live decode chance, and the side bars match the true risk', () => {
    for (const s of ALL_SETTINGS) {
      for (const st of liveStates(s)) {
        const product = blockBars(s, st).reduce((a, b) => a * b, 1);
        expect(product).toBeCloseTo(decodeChance(s, st), 12);
      }
    }
    // Simulate from random mid-round states: the shown win chance is the real one.
    for (const s of [ALL_SETTINGS[7], ALL_SETTINGS[13], ALL_SETTINGS[30], ALL_SETTINGS[38]]) {
      const states = liveStates(s);
      for (let t = 0; t < 4; t++) {
        const st0 = states[rng.int(states.length)];
        const rounds = 6000;
        let wins = 0;
        for (let r = 0; r < rounds; r++) {
          let st = st0;
          while (!decided(s, st)) st = sendBit(st, rng.next() < s.noise / 100);
          if (winChance(s, st) > 0.5) wins++;
        }
        const p = winChance(s, st0);
        expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
      }
    }
  });

  it('every settled state is a certain win or a certain loss, and no cash-out exceeds the max multiplier', () => {
    for (const s of ALL_SETTINGS) {
      for (const st of liveStates(s)) {
        for (const f of [false, true]) {
          const x = sendBit(st, f);
          if (decided(s, x)) expect([0, 1]).toContain(Math.round(winChance(s, x) * 1e12) / 1e12);
          expect(cashAt(s, x)).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
        }
      }
    }
  });

  it('the controls move the win chance over at least 25:1', () => {
    const ps = ALL_SETTINGS.map((s) => winChance(s));
    expect(Math.max(...ps) / Math.min(...ps)).toBeGreaterThan(25);
  });

  it('simulated RTP matches the manifest under random stopping', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
