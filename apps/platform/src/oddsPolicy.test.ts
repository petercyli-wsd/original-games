import { describe, expect, it } from 'vitest';
import { ODDS_GROUPS, operatorOddsReadout, resolveOddsReadout } from './oddsPolicy';

describe('odds policy', () => {
  it('defaults to on', () => {
    expect(operatorOddsReadout(undefined)).toBe('on');
    expect(operatorOddsReadout('nonsense')).toBe('on');
    expect(operatorOddsReadout(' OFF ')).toBe('off');
    expect(resolveOddsReadout('mines', 'on')).toBe('on');
  });
  it('only ladder and paytable games may go off', () => {
    for (const id of ['mines', 'tower', 'plinko', 'keno', 'booster']) expect(resolveOddsReadout(id, 'off')).toBe('off');
    for (const id of ['dice', 'limbo', 'range-dice', 'hilo', 'crash', 'roulette', 'blackjack', 'video-poker', 'not-a-game']) {
      expect(resolveOddsReadout(id, 'off')).toBe('on');
    }
  });
  it('classifies each game once', () => {
    expect(ODDS_GROUPS.dice).toBe('input');
  });
});
