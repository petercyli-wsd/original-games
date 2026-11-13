// Fairness audit: the only mid-round decision is "cash out or turn the next card".
// Every strategy is evaluated exactly (recursion over reachable states) and by
// simulation with the game's own draw.
import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { RTP, TARGETS, apply, cashOutFor, deckOf, drawCard, glowOf, prizeFor, startState, verdict, winChance, type State, type Target } from './math';

type Decide = (k: Target, s: State) => 'cash' | 'draw';

const value = (k: Target, s: State) => {
  const v = verdict(k, s);
  return v === 'won' ? prizeFor(k) : v === 'lost' ? 0 : cashOutFor(k, s);
};

const STRATEGIES: Record<string, Decide> = {
  tester: (_k, s) => (glowOf(s).lay.length / glowOf(s).left >= 0.8 ? 'draw' : 'cash'),
  profit: (k, s) => (cashOutFor(k, s) > 1 ? 'cash' : 'draw'),
  end: () => 'draw',
  // Turn only while the chance is not falling below its start: bank after any burn.
  noBurn: (k, s) => (winChance(k, s) >= 0.9 * winChance(k, startState()) ? 'draw' : 'cash'),
};

function exactRtp(k: Target, decide: Decide): number {
  const memo = new Map<string, number>();
  const turn = (s: State): number => {
    const key = `${s.laid}/${s.burned}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const left = deckOf(s);
    let sum = 0;
    for (const c of left) {
      const next = apply(s, c).state;
      if (verdict(k, next)) sum += value(k, next);
      else sum += decide(k, next) === 'cash' ? value(k, next) : turn(next);
    }
    const v = sum / left.length;
    memo.set(key, v);
    return v;
  };
  return turn(startState());
}

function playRound(k: Target, decide: Decide, rng: { next(): number }): number {
  let s = startState();
  for (;;) {
    s = apply(s, drawCard(rng.next(), s)).state;
    if (verdict(k, s)) return value(k, s);
    if (decide(k, s) === 'cash') return value(k, s);
  }
}

describe('Fan Out fairness', () => {
  it('every strategy returns exactly RTP (exact recursion, k up to 3; larger k by simulation below)', () => {
    for (const k of TARGETS.filter((t) => t <= 3)) {
      for (const [name, decide] of Object.entries(STRATEGIES)) {
        const rtp = exactRtp(k, decide);
        expect(Math.abs(rtp - RTP), `${name} k=${k}: ${rtp}`).toBeLessThan(1e-12);
      }
    }
  });

  it('every strategy is within 4 SE of RTP in simulation, for every eval config', () => {
    for (const { params } of evalSpec.configs) {
      for (const [name, decide] of Object.entries(STRATEGIES)) {
        const rounds = 20_000;
        const rng = createRng(seededSource(params.k * 1000 + name.length));
        let sum = 0;
        let sq = 0;
        for (let i = 0; i < rounds; i++) {
          const m = playRound(params.k, decide, rng);
          sum += m;
          sq += m * m;
        }
        const mean = sum / rounds;
        const se = Math.sqrt((sq / rounds - mean * mean) / rounds);
        expect(Math.abs(mean - RTP), `${name} k=${params.k}: ${mean.toFixed(4)} ± ${se.toFixed(4)}`).toBeLessThan(4 * se + 1e-9);
      }
    }
  });
});
