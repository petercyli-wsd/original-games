import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { MAX_WIN, OUT, RTP, SETTINGS, WHEELS, after, bestWheel, cashOut, outOfReach, prize, relock, sectorTint, startState, wheelChance, winChance, type State } from './math';

const rng = createRng(seededSource(5));
const states = (): State[] => {
  const out: State[] = [];
  for (let balls = 1; balls <= 12; balls++) for (let need = 1; need <= 40; need++) out.push({ need, balls });
  return out;
};

describe('Last Wicket maths', () => {
  it('win chances match the card', () => {
    const want = [0.49, 0.29, 0.087, 0.0182];
    SETTINGS.forEach((st, i) => expect(winChance(startState(st))).toBeCloseTo(want[i], 2));
  });

  it('wheels have 12 sectors with the stated outs', () => {
    expect(WHEELS.block.length).toBe(12);
    expect(WHEELS.swing.length).toBe(12);
    expect(WHEELS.block.filter((x) => x === OUT).length).toBe(1);
    expect(WHEELS.swing.filter((x) => x === OUT).length).toBe(4);
  });

  it('a state is unwinnable exactly when it is out of reach', () => {
    for (const s of states()) expect(winChance(s) === 0).toBe(outOfReach(s) || wheelChance('block', s) === 0 && wheelChance('swing', s) === 0);
    for (const s of states()) if (outOfReach(s)) expect(winChance(s)).toBe(0);
  });

  it('martingale: the best wheel keeps the cash-out; the other wheel relocks to the same value', () => {
    for (const s of states()) {
      if (winChance(s) === 0) continue;
      const p = 7;
      for (const w of ['block', 'swing'] as const) {
        const np = relock(p, s, w);
        if (np === null) continue;
        let avg = 0;
        for (const x of WHEELS[w]) avg += (x === OUT ? 0 : after(s, x).need === 0 ? np : cashOut(np, after(s, x))) / 12;
        expect(avg).toBeCloseTo(cashOut(p, s), 9);
      }
      expect(relock(p, s, bestWheel(s))).toBe(p);
    }
  });

  it('relock never exceeds the max win', () => {
    for (const s of states()) for (const w of ['block', 'swing'] as const) {
      const np = relock(1000, s, w);
      if (np !== null) expect(np).toBeLessThanOrEqual(MAX_WIN);
    }
  });

  it('tints are true: a green sector never lowers the chance', () => {
    for (const s of states()) for (const x of WHEELS.swing) {
      if (x === OUT) continue;
      const t = sectorTint(s, x);
      const now = winChance(s);
      const next = winChance(after(s, x));
      expect(t === 'up' ? next > now : t === 'down' ? next < now : Math.abs(next - now) < 1e-9).toBe(true);
    }
  });

  it('winning chance matches a direct simulation of the raw chase', () => {
    for (const st of SETTINGS.slice(0, 3)) {
      const n = 100_000;
      let wins = 0;
      for (let i = 0; i < n; i++) {
        let s = startState(st);
        while (s.balls > 0 && s.need > 0) {
          const x = WHEELS[bestWheel(s)][rng.int(12)];
          if (x === OUT) break;
          s = after(s, x);
        }
        if (s.need === 0) wins++;
      }
      const p = winChance(startState(st));
      expect(Math.abs(wins / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    }
  });

  it('eval RTP is within 4 SE and the max is under the cap', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - RTP)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    expect(prize(SETTINGS[0])).toBeCloseTo(RTP / winChance(startState(SETTINGS[0])), 12);
  });
});
