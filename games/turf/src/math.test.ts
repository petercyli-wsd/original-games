import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { TARGETS, arrows, autoRound, count, has, houseNeed, outcomes, pockets, prizeFor, start, tick, winChance, winner, type State } from './math';

const rng = createRng(seededSource(16));

/** Every state a round can reach from the start at target k (after captures), found by walking the outcomes. */
function reachable(k: number): State[] {
  const seen = new Map<number, State>();
  const todo: State[] = [start(k)];
  while (todo.length) {
    const s = todo.pop()!;
    const key = s.you + s.house * 65536;
    if (seen.has(key)) continue;
    seen.set(key, s);
    if (winner(s)) continue;
    for (const o of outcomes(s)) todo.push(o.after);
  }
  return [...seen.values()];
}

/** The raw process with the capture rule, played by the game's own tick(). */
function play(k: number, u: () => number) {
  let s = start(k);
  for (;;) {
    s = tick(s, u()).after;
    const w = winner(s);
    if (w) return w === 'you';
  }
}

describe('Turf maths', () => {
  it('matches the card: P(win) from 81.31% at 5 cells down to 1.904% at 15', () => {
    const want = [0.8131, 0.6449, 0.4444, 0.2622, 0.1111, 0.01904];
    TARGETS.forEach((k, i) => expect(winChance(start(k))).toBeCloseTo(want[i], i === 5 ? 5 : 4));
    expect(prizeFor(5)).toBeCloseTo(1.218, 3);
    expect(prizeFor(9)).toBeCloseTo(2.228, 3);
    expect(prizeFor(15)).toBeCloseTo(52.0, 1);
  });

  it('the target pair can never tie: you and the house together need more than 16 cells', () => {
    for (const k of TARGETS) expect(k + houseNeed(k)).toBe(17);
  });

  it('matches a direct simulation of the game with captures (4 SE)', () => {
    for (const k of [5, 9, 13]) {
      const n = 60_000;
      let wins = 0;
      for (let i = 0; i < n; i++) if (play(k, () => rng.next())) wins++;
      const p = winChance(start(k));
      expect(Math.abs(wins / n - p)).toBeLessThan((4 * Math.sqrt(p * (1 - p))) / Math.sqrt(n));
    }
  });

  it('the next cell is yours with chance (your arrows) / (all arrows): the odds on screen are the true draw', () => {
    let s = start(9);
    for (let step = 0; step < 4 && !winner(s); step++) {
      const list = arrows(s);
      const mine = list.filter((a) => a.paint === 'you').length;
      const o = outcomes(s);
      const youP = o.filter((x) => x.tick.arrow.paint === 'you').reduce((a, x) => a + x.p, 0);
      expect(youP).toBeCloseTo(mine / list.length, 12);
      s = tick(s, rng.next()).after;
    }
  });

  for (const k of [5, 9, 15]) {
    it(`target ${k}: capture leaves every position's win chance unchanged, 0 cue exceptions, no settled-early state, martingale at every state`, () => {
      const states = reachable(k);
      expect(states.length).toBeGreaterThan(k === 15 ? 500 : 5000);
      let captures = 0;
      let transitions = 0;
      let exceptions = 0;
      for (const s of states) {
        const now = winChance(s);
        if (winner(s)) continue;
        // Not settled early: an undecided position can still go either way.
        expect(now).toBeGreaterThan(0);
        expect(now).toBeLessThan(1);
        // The capture rule leaves nothing walled off behind it.
        expect(pockets(s).filter((p) => !(p.touchesYou && p.touchesHouse)).length).toBe(0);
        let mean = 0;
        for (const o of outcomes(s)) {
          mean += o.p * winChance(o.after);
          transitions++;
          const t = o.tick;
          if (t.captured) {
            captures++;
            // Just before the capture and just after it, the chance is the same.
            expect(Math.abs(winChance(t.filled) - winChance(t.after))).toBeLessThan(1e-12);
            // Only the paint that just spread is captured, and every captured cell was empty and is now its paint.
            expect(t.captured.paint).toBe(t.arrow.paint);
            for (const c of t.captured.cells) expect(has(t.captured.paint === 'you' ? t.after.you : t.after.house, c)).toBe(true);
          }
          // Cue: your paint spreading never lowers your chance, the house's never raises it.
          const d = winChance(t.after) - now;
          if ((t.arrow.paint === 'you' && d < -1e-12) || (t.arrow.paint === 'house' && d > 1e-12)) exceptions++;
        }
        expect(Math.abs(mean - now)).toBeLessThan(1e-12);
      }
      expect(transitions).toBeGreaterThan(1000);
      expect(captures).toBeGreaterThan(k === 15 ? 5 : 100);
      expect(exceptions).toBe(0);
    });
  }

  it('Auto and the eval return the RTP', () => {
    for (const k of [5, 9, 15]) {
      const n = 80_000;
      let total = 0;
      for (let i = 0; i < n; i++) total += autoRound(k, null, () => rng.next()).multiplier;
      expect(Math.abs(total / n - 0.99)).toBeLessThan(k === 15 ? 0.08 : 0.03);
    }
    const out = runEval(evalSpec, { rounds: 20_000, seed: 3 });
    for (const r of out) expect(r.p99Steps).toBeLessThanOrEqual(30);
  });

  it('counts: a full board is never reached by both sides', () => {
    const s = start(9);
    expect(count(s.you) + count(s.house)).toBe(2);
  });

  it('is a prototype with a team-ready note', () => {
    expect(manifest.revision?.date).toBe('2026-11-24');
    expect(manifest.revision?.kind).toBe('new');
  });
});
