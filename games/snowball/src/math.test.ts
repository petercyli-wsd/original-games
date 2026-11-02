import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { initialState, reducer, settledValue, startingBalls, type GameState } from './game';
import manifest from './manifest';
import {
  DRAWS,
  MAJORITY,
  PRESETS,
  PRESET_IDS,
  RTP,
  betaBinomialPmf,
  cashMultiplier,
  drawColour,
  maxMultiplier,
  prize,
  tally,
  urnAfter,
  winChance,
} from './math';

/** Every (blue drawn, red drawn) a round can be at, decided or not. */
function reachable() {
  const out: [number, number][] = [];
  for (let b = 0; b <= MAJORITY; b++)
    for (let r = 0; r <= MAJORITY; r++) if (b + r <= DRAWS && !(b === MAJORITY && r === MAJORITY)) out.push([b, r]);
  return out;
}

describe('Snowball maths', () => {
  it('beta-binomial pmf sums to 1', () => {
    for (const [n, a, b] of [[11, 1, 1], [21, 10, 10], [11, 1, 7], [5, 3, 1]]) {
      expect(betaBinomialPmf(n, a, b).reduce((s, p) => s + p, 0)).toBeCloseTo(1, 12);
    }
  });

  it('a 1:1 urn makes every blue count equally likely (uniform)', () => {
    for (const p of betaBinomialPmf(10, 1, 1)) expect(p).toBeCloseTo(1 / 11, 12);
  });

  it('P(win) matches a simulation of the raw urn (11 draws, majority of draws)', () => {
    const rng = createRng(seededSource(42));
    const trials = 40_000;
    for (const id of PRESET_IDS) {
      let wins = 0;
      for (let t = 0; t < trials; t++) {
        let { blue, red } = PRESETS[id];
        let blueDraws = 0;
        for (let d = 0; d < DRAWS; d++) {
          if (drawColour(blue, red, rng.next()) === 'blue') blue++, blueDraws++;
          else red++;
        }
        if (blueDraws > DRAWS - blueDraws) wins++;
      }
      const p = winChance(id, 0, 0);
      expect(Math.abs(wins / trials - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / trials) + 1e-9);
    }
  });

  it('a decided race reports exactly 0 or 1, and only then', () => {
    for (const id of PRESET_IDS) {
      for (const [b, r] of reachable()) {
        const p = winChance(id, b, r);
        if (b >= MAJORITY) expect(p).toBe(1);
        else if (r >= MAJORITY) expect(p).toBe(0);
        else expect(p > 0 && p < 1).toBe(true);
      }
    }
  });

  it('martingale step: E[cash-out after the next draw] equals the cash-out now', () => {
    for (const id of PRESET_IDS) {
      for (const [b, r] of reachable()) {
        if (b >= MAJORITY || r >= MAJORITY) continue;
        const { blue, red } = urnAfter(id, b, r);
        const q = blue / (blue + red);
        const next = q * cashMultiplier(id, b + 1, r) + (1 - q) * cashMultiplier(id, b, r + 1);
        expect(next).toBeCloseTo(cashMultiplier(id, b, r), 12);
      }
    }
  });

  it('the expected cash-out after any number of draws is exactly the RTP', () => {
    // After k draws the blue count is BetaBinomial(k, blue, red). Decided
    // states keep their value, so this sums the stopped martingale exactly.
    for (const id of PRESET_IDS) {
      const { blue, red } = PRESETS[id];
      for (let k = 0; k <= DRAWS; k++) {
        let ev = 0;
        betaBinomialPmf(k, blue, red).forEach((p, j) => (ev += p * cashMultiplier(id, Math.min(j, MAJORITY), Math.min(k - j, MAJORITY))));
        expect(ev).toBeCloseTo(RTP, 10);
      }
    }
  });

  it('what the board shows is the true risk', () => {
    for (const id of PRESET_IDS) {
      for (const [b, r] of reachable()) {
        const t = tally(b, r);
        // Tally: blue's gap to the centre slot, red's gap, and the empty slots.
        expect(b + t.blueNeeds).toBe(Math.max(b, MAJORITY));
        expect(t.left).toBe(DRAWS - b - r);
        // Blue wins exactly when it gets its gap filled before red's: needs ≤ left.
        if (b < MAJORITY && r < MAJORITY) expect(t.blueNeeds + t.redNeeds).toBe(t.left + 1);
        // Next-ball bar: blue share of the urn = chance the next draw is blue.
        const { blue, red } = urnAfter(id, b, r);
        const balls = [...startingBalls(id), ...Array<string>(b).fill('blue'), ...Array<string>(r).fill('red')];
        expect(balls.filter((c) => c === 'blue').length).toBe(blue);
        expect(balls.length).toBe(blue + red);
      }
    }
  });

  it('cash-out never exceeds the prize and the prize matches the start chance', () => {
    for (const id of PRESET_IDS) {
      expect(prize(id) * winChance(id, 0, 0)).toBeCloseTo(RTP, 12);
      for (const [b, r] of reachable()) expect(cashMultiplier(id, b, r)).toBeLessThanOrEqual(prize(id) + 1e-12);
    }
  });

  it('the urn preset alone moves the win chance at least 25:1', () => {
    const ps = PRESET_IDS.map((id) => winChance(id, 0, 0));
    expect(Math.max(...ps) / Math.min(...ps)).toBeGreaterThanOrEqual(25);
  });

  it('Bet does not draw; leaving mid-draw settles at the drawn result', () => {
    let s: GameState = reducer(initialState(), { type: 'start', bet: 1, preset: 'wild' });
    expect(s.phase).toBe('live');
    expect(s.round!.history).toHaveLength(0);
    expect(reducer(s, { type: 'cashOut' })).toBe(s);
    s = reducer(s, { type: 'draw', index: 0 }); // ball 0 of a 1:1 urn is red
    const colour = s.round!.balls[0];
    expect(settledValue(s)).toBeCloseTo(cashMultiplier('wild', colour === 'blue' ? 1 : 0, colour === 'red' ? 1 : 0), 12);
    s = reducer(reducer(s, { type: 'twin' }), { type: 'apply' });
    expect(s.round!.balls).toHaveLength(3);
    expect(s.round!.balls[2]).toBe(colour);
  });

  it('manifest covers every reachable payout', () => {
    for (const id of PRESET_IDS) expect(prize(id)).toBeLessThanOrEqual(manifest.maxMultiplier);
    expect(manifest.maxMultiplier).toBe(maxMultiplier());
    expect(manifest.rtp).toBe(RTP);
    expect(new Set(PRESET_IDS.map((id) => PRESETS[id].volatility))).toEqual(new Set(manifest.volatility));
  });

  it('simulated RTP matches the manifest', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
