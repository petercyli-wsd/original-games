import { describe, expect, it } from 'vitest';
import { gateReasons, lowerMedian, medianGrade, panelNeeded, readabilityCap, scoreSlot, WEIGHTS, type GateInput, type ScoreInput } from './scores';

const all = (n: number): ScoreInput => ({
  player: { theme: n, readability: n, feature_clarity: n, excitement: n, fun: n },
  designer: { creativity: n, maths_fit: n, uniqueness: n, polish: n },
  comprehension: 'correct',
  wideMisses: [],
  hasFeature: true,
});

const passing: GateInput = {
  overall: 3.8,
  scores: { readability: 4, feature_clarity: 4 },
  hasFeature: true,
  oraclePresent: true,
  rtp: 0.96,
  factFailures: [],
  reskinOf: [],
  players: 1,
};

describe('weights', () => {
  it('are the §5 weights, summing to 17', () => {
    expect(WEIGHTS).toEqual({ fun: 3, excitement: 2, theme: 2, readability: 2, creativity: 2, maths_fit: 2, feature_clarity: 1.5, uniqueness: 1.5, polish: 1 });
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(17);
  });
});

describe('scoreSlot', () => {
  it('a flat score is its own mean, uncapped at 4 and 5', () => {
    expect(scoreSlot(all(4)).overall).toBe(4);
    // 5 everywhere: the readability cap is 1.5 + 0.75 × 5 = 5.25, so it doesn't bite.
    expect(scoreSlot(all(5)).overall).toBe(5);
  });

  it('computes the weighted mean', () => {
    const s = scoreSlot({ ...all(3), player: { theme: 3, readability: 4, feature_clarity: 3, excitement: 3, fun: 5 } });
    // (3·2 + 4·2 + 3·1.5 + 3·2 + 5·3 + 3·2 + 3·2 + 3·1.5 + 3·1) / 17 = 59 / 17
    expect(s.mean).toBeCloseTo(59 / 17, 2);
    expect(s.overall).toBe(Math.round((59 / 17) * 100) / 100);
  });

  it('caps the overall at 1.5 + 0.75 × readability', () => {
    expect(readabilityCap(2)).toBe(3);
    expect(readabilityCap(3)).toBe(3.75);
    const s = scoreSlot({ ...all(5), player: { theme: 5, readability: 2, feature_clarity: 5, excitement: 5, fun: 5 } });
    expect(s.mean).toBeGreaterThan(4);
    expect(s.overall).toBe(3);
    expect(s.caps.some((c) => c.includes('readability 2 caps'))).toBe(true);
  });

  it('a misread caps readability and feature clarity at 2, and the cap then follows', () => {
    const s = scoreSlot({ ...all(4), comprehension: 'misread' });
    expect(s.scores.readability).toBe(2);
    expect(s.scores.feature_clarity).toBe(2);
    expect(s.overall).toBe(3); // 1.5 + 0.75 × 2
  });

  it('a partial grade caps nothing', () => {
    const s = scoreSlot({ ...all(4), comprehension: 'partial' });
    expect(s.scores.readability).toBe(4);
    expect(s.caps).toEqual([]);
  });

  it('a band missed by more than its width caps maths fit at 2', () => {
    const s = scoreSlot({ ...all(4), wideMisses: ['Hit rate 8% vs 20–45%'] });
    expect(s.scores.maths_fit).toBe(2);
    expect(s.overall).toBeCloseTo((4 * 15 + 2 * 2) / 17, 2);
    // A maths fit already at or below 2 isn't touched.
    expect(scoreSlot({ ...all(4), designer: { creativity: 4, maths_fit: 1, uniqueness: 4, polish: 4 }, wideMisses: ['x'] }).caps).toEqual([]);
  });

  it('a pure base game drops feature clarity from the mean', () => {
    const s = scoreSlot({ ...all(4), player: { theme: 4, readability: 4, feature_clarity: 1, excitement: 4, fun: 4 }, hasFeature: false });
    expect(s.scores.feature_clarity).toBeUndefined();
    expect(s.overall).toBe(4);
  });
});

describe('gate', () => {
  it('passes a clean review', () => {
    expect(gateReasons(passing)).toEqual([]);
  });

  it('fails each gated condition on its own', () => {
    expect(gateReasons({ ...passing, overall: 3.49 })[0]).toMatch(/overall 3.49 < 3.5/);
    expect(gateReasons({ ...passing, scores: { readability: 2, feature_clarity: 4 } })).toEqual(['readability 2 < 3']);
    expect(gateReasons({ ...passing, scores: { readability: 4, feature_clarity: 2 } })).toEqual(['feature clarity 2 < 3']);
    expect(gateReasons({ ...passing, oraclePresent: false })[0]).toMatch(/no oracle/);
    expect(gateReasons({ ...passing, rtp: null })[0]).toMatch(/RTP unknown/);
    expect(gateReasons({ ...passing, rtp: 0.9549 })[0]).toMatch(/outside 95.5–96.5/);
    expect(gateReasons({ ...passing, rtp: 0.9651 })[0]).toMatch(/outside/);
    expect(gateReasons({ ...passing, factFailures: ['Dry streak p95 18 outside ≤ 15'] })).toEqual(['Dry streak p95 18 outside ≤ 15']);
    expect(gateReasons({ ...passing, reskinOf: ['tide-spins'] })).toEqual(['reskin of tide-spins']);
    expect(gateReasons({ ...passing, trademarks: ['Megaways in Game.tsx'] })).toEqual(['trademarked mechanic name: Megaways in Game.tsx']);
  });

  it('includes the RTP band edges', () => {
    expect(gateReasons({ ...passing, rtp: 0.955 })).toEqual([]);
    expect(gateReasons({ ...passing, rtp: 0.965 })).toEqual([]);
    // slots:eval's verdict decides (an mc RTP within 3 SE of the band passes there).
    expect(gateReasons({ ...passing, rtp: 0.9534, rtpInBand: true })).toEqual([]);
    expect(gateReasons({ ...passing, rtp: 0.96, rtpInBand: false })[0]).toMatch(/outside/);
  });

  it("doesn't gate feature clarity for a pure base game", () => {
    expect(gateReasons({ ...passing, hasFeature: false, scores: { readability: 4 } })).toEqual([]);
  });

  it('asks for a panel in 3.25–3.75 (inclusive) until 3 players have played', () => {
    expect(panelNeeded(3.25, 1)).toBe(true);
    expect(panelNeeded(3.75, 1)).toBe(true);
    expect(panelNeeded(3.76, 1)).toBe(false);
    expect(panelNeeded(3.24, 1)).toBe(false);
    expect(panelNeeded(3.5, 3)).toBe(false);
    expect(gateReasons({ ...passing, overall: 3.6 })).toEqual([expect.stringMatching(/panel needed.*run 2 more/)]);
    expect(gateReasons({ ...passing, overall: 3.6, players: 3 })).toEqual([]);
  });
});

describe('medians', () => {
  it('takes the lower median for an even panel', () => {
    expect(lowerMedian([4, 2, 3])).toBe(3);
    expect(lowerMedian([2, 4])).toBe(2);
    expect(lowerMedian([5])).toBe(5);
  });

  it('grades the panel by the median grade, ties going stricter', () => {
    expect(medianGrade(['correct', 'misread', 'correct'])).toBe('correct');
    expect(medianGrade(['misread', 'misread', 'correct'])).toBe('misread');
    expect(medianGrade(['correct', 'partial'])).toBe('partial');
    expect(medianGrade(['misread'])).toBe('misread');
  });
});
