import { runEval } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { MODES, MODE_NAMES, RTP, multiplierAt } from './math';

describe('Arc Climb maths', () => {
  it('cashing out at any step is worth exactly the RTP', () => {
    for (const mode of MODE_NAMES) {
      for (let s = 1; s <= MODES[mode].maxSteps; s++) {
        expect(MODES[mode].p ** s * multiplierAt(mode, s)).toBeCloseTo(RTP, 12);
      }
    }
  });

  it('simulated RTP matches the manifest', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
