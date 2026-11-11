// Fairness audit: no strategy beats the RTP.
//
// Decisions in a Back to Back round: the colour (before the bet, fixed after)
// and, after every card without a snap, cash out or turn the next card. The
// cards come from the real `turn` on the host rng; chances from the exact DP.
//
// 1. Martingale: at >= 30 reachable states, for every colour you could have
//    backed, the real `turn` is driven through every possible next card (the
//    uniform in the middle of each colour's cell) and E[value after] equals the
//    cash-out now, so "turn" is value-neutral and "cash out" keeps the value.
// 2. Strategies, each within 4 SE of RTP on every eval config:
//    (a) the tester's: turn on only while the next card cannot end you
//        (no other colour's snap chance above 20%), else cash out;
//    (b) cash out the moment the value exceeds the stake;
//    (c) play to the snap;
//    (d1) cash out after the first card; (d2) cash out when the chance has
//        halved or doubled;
//    (d3) game-specific: stay in only while your colour is on top (a live shot),
//        and cash out the moment another colour is on top.
import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { DECK, NO_TOP, RTP, startChances, startPrize, total, turn, valueAfter, winChances } from './math';

function reachable(want: number, seed: number) {
  const rng = createRng(seededSource(seed));
  const out: { counts: number[]; top: number }[] = [];
  while (out.length < want) {
    let counts = [...DECK];
    let top = NO_TOP;
    const keep = rng.int(12);
    for (let k = 0; ; k++) {
      const t = turn(counts, top, rng.next());
      if (t.snap) break;
      counts = t.counts;
      top = t.top;
      if (k === keep) {
        out.push({ counts, top });
        break;
      }
    }
  }
  return out;
}

type Ctx = { counts: number[]; top: number; me: number; prize: number; cards: number };
type Decide = (c: Ctx) => 'cash' | 'turn';

/** Chance that the next card snaps for a colour other than mine. */
function otherSnap(counts: number[], top: number, me: number) {
  return top >= 0 && top !== me ? counts[top] / total(counts) : 0;
}

const STRATEGIES: Record<string, Decide> = {
  tester: ({ counts, top, me }) => (otherSnap(counts, top, me) <= 0.2 ? 'turn' : 'cash'),
  profit: ({ counts, top, me, prize }) => (prize * winChances(counts, top)[me] > 1 ? 'cash' : 'turn'),
  ride: () => 'turn',
  firstcard: ({ cards }) => (cards >= 1 ? 'cash' : 'turn'),
  halfdouble: ({ counts, top, me, prize }) => {
    const p = winChances(counts, top)[me];
    const p0 = RTP / prize;
    return p <= p0 / 2 || p >= Math.min(1, p0 * 2) ? 'cash' : 'turn';
  },
  liveshot: ({ top, me }) => (top === me ? 'turn' : 'cash'),
};

/** One round, mirroring Game.tsx (turn, then cash out or turn on). */
function play(me: number, decide: Decide, rng: { next(): number }): number {
  const prize = startPrize(me);
  let counts = [...DECK];
  let top = NO_TOP;
  let cards = 0;
  for (;;) {
    const t = turn(counts, top, rng.next());
    cards++;
    const value = valueAfter(t, me, prize);
    if (t.snap || value === 0) return value;
    counts = t.counts;
    top = t.top;
    if (decide({ counts, top, me, prize, cards }) === 'cash') return value;
  }
}

describe('Back to Back fairness', () => {
  it('martingale over the real turn, for every colour, at >= 30 states', () => {
    const states = reachable(36, 21);
    for (const { counts, top } of states) {
      const now = winChances(counts, top);
      const n = total(counts);
      for (let me = 0; me < DECK.length; me++) {
        let avg = 0;
        let before = 0;
        counts.forEach((c, j) => {
          if (c === 0) return;
          const u = (before + c / 2) / n;
          before += c;
          const t = turn(counts, top, u);
          expect(t.colour).toBe(j);
          avg += (c / n) * valueAfter(t, me, 1);
        });
        expect(Math.abs(avg - now[me]), `counts=${counts} top=${top} me=${me}`).toBeLessThan(1e-12);
      }
    }
    expect(states.length).toBeGreaterThanOrEqual(30);
  });

  it('every strategy is within 4 SE of RTP on every eval config', () => {
    evalSpec.configs.forEach(({ params }) => {
      for (const [name, decide] of Object.entries(STRATEGIES)) {
        const rng = createRng(seededSource(params.me * 101 + name.length));
        const rounds = 12_000;
        let sum = 0;
        let sq = 0;
        for (let i = 0; i < rounds; i++) {
          const m = play(params.me, decide, rng);
          expect(m).toBeLessThanOrEqual(manifest.maxMultiplier);
          sum += m;
          sq += m * m;
        }
        const mean = sum / rounds;
        const se = Math.sqrt((sq / rounds - mean * mean) / rounds);
        expect(Math.abs(mean - RTP), `${name} me=${params.me}: ${mean.toFixed(4)} ± ${se.toFixed(4)}`).toBeLessThan(4 * se + 1e-9);
      }
    });
    expect(startChances().length).toBe(DECK.length);
  });
});
