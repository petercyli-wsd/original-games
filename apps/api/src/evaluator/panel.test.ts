import { describe, expect, it } from 'vitest';
import { mergePlayers } from './panel.js';
import type { PlayerOutput } from './service.js';

const player = (scores: [number, number, number, number], checks: Partial<NonNullable<PlayerOutput['checks']>> = {}, note = ''): PlayerOutput => ({
  first_impression: note,
  understanding: { win_condition: note, how_it_works: '', odds: '', settings: '', confidence: '' },
  checks: { outcome: 'direct', known_casino_game: false, odds_source: 'see_why', reasoning: note, ...checks },
  criteria: (['win_clarity', 'simplicity', 'odds_legibility', 'fun'] as const).map((key, i) => ({ key, score: scores[i], reasoning: `${note} ${key}` })),
  confusions: [`${note} confused`],
});

describe('blind player panel', () => {
  it('takes each score from the median run, not the average', () => {
    const merged = mergePlayers([player([5, 4, 4, 5], {}, 'a'), player([2, 3, 2, 2], {}, 'b'), player([4, 3, 4, 4], {}, 'c')]);
    expect(merged.criteria.map((c) => c.score)).toEqual([4, 3, 4, 4]);
    // The prose comes from the run that sits on the medians.
    expect(merged.understanding.win_condition).toBe('c');
    expect(merged.criteria[0].reasoning).toContain('Panel of 3: 5, 2, 4');
  });

  it('takes the lower median for an even panel', () => {
    expect(mergePlayers([player([5, 5, 5, 5]), player([3, 3, 3, 3])]).criteria[0].score).toBe(3);
  });

  it('votes on the checks, ties going to the stricter answer', () => {
    const merged = mergePlayers([
      player([4, 4, 4, 4], { outcome: 'pattern', odds_source: 'trust', known_casino_game: true }),
      player([4, 4, 4, 4], { outcome: 'direct', odds_source: 'see_why', known_casino_game: true }),
      player([4, 4, 4, 4], { outcome: 'hidden', odds_source: 'trust', known_casino_game: false }),
    ]);
    expect(merged.checks).toMatchObject({ outcome: 'hidden', odds_source: 'trust', known_casino_game: true });
  });

  it('passes a single run through unchanged', () => {
    const one = player([3, 3, 3, 3]);
    expect(mergePlayers([one])).toBe(one);
  });
});
