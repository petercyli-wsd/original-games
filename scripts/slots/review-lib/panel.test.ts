import { describe, expect, it } from 'vitest';
import { mergePanel, playerProblems } from './panel';
import type { PlayerReview } from './prompts/player';

const player = (scores: [number, number, number, number, number], confusions: string[] = []): PlayerReview => ({
  first_impression: 'a slot',
  session: { spins: 60, turbo: true, autoplay: true, feature_seen: true, paytable_opened: true, balance: '100 → 90' },
  checks: { top_pay: 'crown', feature_trigger: '3 scatters', wild: 'substitutes', biggest_win: '12×', feature_story: '10 spins' },
  moments: { best: 'none', dullest: 'none' },
  keep_spinning: { answer: 'maybe', why: '' },
  criteria: (['theme', 'readability', 'feature_clarity', 'excitement', 'fun'] as const).map((key, i) => ({ key, reasoning: `${key} ${scores[i]}`, score: scores[i] })),
  confusions,
});

describe('mergePanel', () => {
  it('takes the median per score and pools confusions', () => {
    const m = mergePanel([player([3, 4, 2, 3, 3], ['a']), player([4, 2, 3, 3, 4], ['a', 'b']), player([2, 3, 4, 3, 5])]);
    expect(m.scores).toEqual({ theme: 3, readability: 3, feature_clarity: 3, excitement: 3, fun: 4 });
    expect(m.spread.fun).toEqual([3, 4, 5]);
    expect(m.confusions).toEqual(['a', 'b']);
    expect(m.labels).toEqual(['A', 'B', 'C']);
    expect(m.reasoning.fun).toMatch(/Player B; panel: 3, 4, 5/);
  });

  it('a single player is its own panel', () => {
    expect(mergePanel([player([5, 4, 3, 2, 1])]).scores.fun).toBe(1);
  });
});

describe('playerProblems', () => {
  it('accepts a valid review and names what is wrong otherwise', () => {
    expect(playerProblems(player([3, 3, 3, 3, 3]))).toEqual([]);
    const bad = { ...player([3, 3, 3, 3, 3]), criteria: [{ key: 'fun', reasoning: '', score: 7 }] };
    expect(playerProblems(bad)).toEqual(expect.arrayContaining(['criteria lacks theme', 'fun score 7 is not 1–5']));
  });
});
