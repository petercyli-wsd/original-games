import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { IDLE, chargesOf, resolveRoll, simulateAutoRound, ticketValue, withOdds, type AutoOdds } from './engine';
import { POINTS, playStrategy, strategyOf, totalOf, type FieldPays, type Layout, type OddsLimit } from './math';

// The table engine Game.tsx plays must pay exactly what the maths model says.
describe('Craps table engine', () => {
  const rng = createRng(seededSource(21));
  const layouts: Layout[] = [
    { pass: 2 },
    { dontPass: 1 },
    { pass: 2, dontPass: 1, field: 1 },
    { pass: 1, any7: 1, anyCraps: 1 },
    { field: 2, yo: 1 },
    { aces: 1, twelve: 1 },
    { dontPass: 3, aceDeuce: 1, field: 1 },
  ];
  const limits: OddsLimit[] = ['1x', '2x', '345x', '5x', '10x'];
  const fields: FieldPays[] = ['double', 'triple'];

  it('an auto round resolves once: every ticket placed is settled once, and it pays the maths', () => {
    for (let i = 0; i < 4000; i++) {
      const layout = layouts[i % layouts.length];
      const limit = limits[rng.int(limits.length)];
      const autoOdds: AutoOdds = (['none', '1x', 'max'] as const)[rng.int(3)];
      const field = fields[rng.int(2)];
      const propsStay = rng.next() < 0.5;
      const dice: [number, number][] = [];
      for (let k = 0; k < 400; k++) dice.push([1 + rng.int(6), 1 + rng.int(6)]);
      let a = 0;
      const ui = simulateAutoRound(layout, { limit, autoOdds, field, propsStay }, () => dice[a++]);
      expect(ui.placed).toBe(ui.settled);
      expect(ui.open).toBe(0);
      expect(ui.state.phase).toBe('over');
      expect(ui.paid).toBeCloseTo(ui.state.returned, 9);
      // The same dice through the exact model: 1x never exceeds a table limit, max is the limit.
      const odds = autoOdds === 'none' ? null : autoOdds === 'max' ? limit : '1x';
      let b = 0;
      const model = playStrategy(strategyOf(layout, odds, propsStay, field), () => {
        const d = dice[b++];
        return d[0] + d[1];
      });
      expect(ui.state.rolls).toBe(model.rolls);
      expect(ui.state.wagered).toBeCloseTo(model.wagered, 9);
      expect(ui.state.returned).toBeCloseTo(model.returned, 9);
      expect(ui.state.returned / ui.state.wagered).toBeLessThanOrEqual(31 + 1e-12);
    }
  });

  it('a roll charges the line on the come-out, then only new odds and one-roll bets', () => {
    const s0 = { ...IDLE, table: { pass: 5, field: 1 } as Layout };
    expect(chargesOf(s0).total).toBe(6);
    const r = resolveRoll(s0, [3, 3], 'double', true); // point 6
    expect(r.next.phase).toBe('point');
    expect(r.next.point).toBe(6);
    const withMax = withOdds(r.next, '345x');
    expect(withMax.table.passOdds).toBe(25);
    const c = chargesOf(withMax);
    expect(c.contract).toEqual({ passOdds: 25 });
    expect(c.props).toEqual({ field: 1 });
    // Point made: pass 1:1, odds 6:5, field loses on 6.
    const end = resolveRoll(withMax, [4, 2], 'double', true);
    expect(end.decided).toBe(true);
    expect(ticketValue({ pass: 5 }, end.returnOf)).toBe(2);
    expect(ticketValue({ passOdds: 25 }, end.returnOf)).toBeCloseTo(2.2, 12);
    expect(end.next.returned).toBeCloseTo(10 + 55, 9);
    expect(end.next.wagered).toBe(6 + 26);
  });

  it('every point gets the right odds cap', () => {
    for (const p of POINTS) {
      const s = { ...IDLE, phase: 'point' as const, point: p, table: { pass: 1, dontPass: 1 }, working: { pass: 1, dontPass: 1 } };
      const t = withOdds(s, '345x').table;
      expect(t.passOdds).toBe(p === 4 || p === 10 ? 3 : p === 5 || p === 9 ? 4 : 5);
      // Lay odds win the same multiple.
      expect(t.layOdds! * (({ 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3 } as Record<number, number>)[p] / 6)).toBeCloseTo(t.passOdds!, 9);
      expect(totalOf(t)).toBeGreaterThan(2);
    }
  });
});
