import type { GameManifest } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { readSlotFacts, readSlotReview, rtpWithTier, slotFactsLine } from './slotInfo';

const m = { rtp: 0.96, volatility: ['medium', 'high'], maxMultiplier: 5000 } as GameManifest;

describe('slot facts', () => {
  it('falls back to the manifest', () => {
    const f = readSlotFacts(m);
    expect(slotFactsLine(f)).toBe('96.0% · High · 5,000×');
    expect(rtpWithTier(f)).toBe('96.00% exact');
  });
  it('reads slot-facts.json tolerantly', () => {
    const f = readSlotFacts(m, { rtp: 96.02, rtpTier: 'mc', rtpSe: 0.0003, hitRate: 0.31, volatility: 'extreme', featureFreq: 0.004, featureShare: 0.4, junk: 1 });
    expect(rtpWithTier(f)).toBe('96.02% ± 0.03% mc');
    expect(f.featureFreq).toBeCloseTo(250);
    expect(f.volatility).toBe('extreme');
  });
});

describe('slot review', () => {
  it('shows what is present, ignores the rest', () => {
    expect(readSlotReview(null)).toBeNull();
    expect(readSlotReview({})).toBeNull();
    expect(readSlotReview({ overall: 82, scores: { maths: 90, theme: 'x' }, gate: false })).toEqual({ overall: 82, scores: [['maths', 90]], verdict: undefined, gate: false });
  });
});
