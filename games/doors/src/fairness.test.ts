// Fairness audit: can any way of playing Doors beat the RTP?
//
// The door count and plan are fixed when the bet is placed. During a round the
// player can, at every checkpoint, cash out, switch to any closed door (the
// prize relocks at V / P(door)), or advance (the host opens a door, or both
// final doors are revealed). Doors is a Monty Hall game, so switching is the
// obvious exploit candidate.
//
// The pricing is checked against an independent brute-force Bayes computation:
// the prize is uniform over the doors and, given where it is, the host opens a
// uniformly random closed door that is neither held nor the prize. So
//   P(prize = x | history) ∝ Π over openings 1[x ≠ opened] / #eligible(x),
// computed from the raw history (which door was held at each opening), never
// from math.ts's weights. With that, at 40+ reached states and for every
// action (hold or switch to each closed door, then advance), the next event is
// enumerated exactly (prize location × host's pick), including the plan's
// automatic switch at the final two, exactly as Game.tsx's step() applies it.
//
// Strategies, per eval config, on the real process (hostPick, openDoor,
// switchTo, as Game.tsx drives them):
//   (a) the tester's: advance while the next step is ≥ 80% safe (an opening
//       never busts; the reveal is safe with P(your door)), else cash out;
//   (b) take any profit: cash out the moment V > 1;
//   (c) play to the reveal with the config's plan;
//   (d1) Monty: always hold the brightest closed door, reveal at the end;
//   (d2) prize hunter: always hold the dimmest closed door (largest relocked
//        prize), reveal at the end;
//   (d3) Monty with the tester's stop at the final two.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  DOOR_COUNTS,
  PLANS,
  RTP,
  bestOther,
  canOpen,
  cashValue,
  chanceOf,
  closedDoors,
  hostPick,
  lockedPrize,
  newState,
  openDoor,
  otherDoor,
  posterior,
  prizeOf,
  switchTo,
  winChance,
  type DoorCount,
  type DoorsState,
  type Plan,
} from './math';

/** Rounds per Monte Carlo run. The audit's heavy run sets FAIRNESS_ROUNDS (≥ 200000). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 6_000);

/** One opening in the raw history: who was held, which closed doors there were, which one opened. */
interface Opening {
  held: number;
  closed: number[];
  opened: number;
}

/** Brute-force posterior over prize locations from the raw history. */
function brutePosterior(doors: number, history: readonly Opening[]): number[] {
  const like = Array.from({ length: doors }, (_, x) => {
    let l = 1 / doors;
    for (const h of history) {
      if (x === h.opened) return 0;
      const eligible = h.closed.filter((d) => d !== h.held && d !== x).length;
      l /= eligible;
    }
    return l;
  });
  const t = like.reduce((a, b) => a + b, 0);
  return like.map((l) => l / t);
}

/** The game's step(): the host opens z; at the final two the "switch" plan flips the hold. */
function applyOpening(s: DoorsState, z: number, plan: Plan): DoorsState {
  let next = openDoor(s, z);
  if (!canOpen(next) && plan === 'switch') next = switchTo(next, otherDoor(next));
  return next;
}

/** E[V after advancing from s (already holding the chosen door)], by exact enumeration. */
function expectedAfter(s: DoorsState, history: readonly Opening[], plan: Plan): number {
  const post = brutePosterior(s.weight.length, history);
  if (!canOpen(s)) return post[s.held] * lockedPrize(s); // the reveal
  const closed = closedDoors(s);
  let ev = 0;
  for (const x of closed) {
    if (post[x] === 0) continue;
    const eligible = closed.filter((d) => d !== s.held && d !== x);
    for (const z of eligible) ev += (post[x] / eligible.length) * cashValue(applyOpening(s, z, plan));
  }
  return ev;
}

type Choose = (s: DoorsState) => number;
type Stop = (s: DoorsState) => boolean;

/** One round as Game.tsx plays it: the first opening goes with the bet. Returns the payout. */
function playRound(doors: DoorCount, plan: Plan, choose: Choose, stop: Stop, rng: Rng): number {
  let s = newState(doors, rng.int(doors));
  const prizeDoor = rng.int(doors);
  s = applyOpening(s, hostPick(s, prizeDoor, rng), plan);
  for (;;) {
    // A checkpoint: switch (value-preserving), then cash out or advance.
    const d = choose(s);
    if (d !== s.held) s = switchTo(s, d);
    if (stop(s)) return cashValue(s);
    if (!canOpen(s)) return s.held === prizeDoor ? lockedPrize(s) : 0;
    s = applyOpening(s, hostPick(s, prizeDoor, rng), plan);
  }
}

const hold: Choose = (s) => s.held;
const brightest: Choose = (s) => {
  const b = bestOther(s);
  return b !== null && chanceOf(s, b) > chanceOf(s, s.held) * (1 + 1e-12) ? b : s.held;
};
const dimmest: Choose = (s) => closedDoors(s).reduce((best, d) => (chanceOf(s, d) < chanceOf(s, best) * (1 - 1e-12) ? d : best), s.held);
/** The tester's rule: an opening is always safe; the reveal is safe with P(your door). */
const tester: Stop = (s) => (canOpen(s) ? 1 : winChance(s)) < 0.8;

const STRATEGIES: { name: string; choose: Choose; stop: Stop }[] = [
  { name: '(a) tester: advance while ≥ 80% safe', choose: hold, stop: tester },
  { name: '(b) take any profit', choose: hold, stop: (s) => cashValue(s) > 1 },
  { name: '(c) play to the reveal (plan)', choose: hold, stop: () => false },
  { name: '(d1) always hold the brightest door', choose: brightest, stop: () => false },
  { name: '(d2) always hold the dimmest door', choose: dimmest, stop: () => false },
  { name: '(d3) brightest door + tester stop', choose: brightest, stop: tester },
];

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    s += x;
    s2 += x * x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds) };
}

describe('Doors fairness', () => {
  it('the bet is fair: V = RTP before the first opening, for every door count and pick', () => {
    for (const n of DOOR_COUNTS)
      for (const plan of PLANS)
        for (let held = 0; held < n; held++) {
          const s = newState(n, held);
          expect(cashValue(s)).toBeCloseTo(RTP, 14);
          expect(Math.abs(expectedAfter(s, [], plan) - RTP)).toBeLessThan(1e-12);
        }
  });

  it('martingale: at 40+ reached states, every action (hold or switch, then advance) keeps V exactly', () => {
    const rng = createRng(seededSource(6101));
    let checked = 0;
    let finals = 0;
    for (let round = 0; round < 400 && (checked < 60 || finals < 10); round++) {
      const doors = DOOR_COUNTS[rng.int(DOOR_COUNTS.length)];
      const plan = PLANS[rng.int(PLANS.length)];
      const prizeDoor = rng.int(doors);
      let s = newState(doors, rng.int(doors));
      const history: Opening[] = [];
      const open = () => {
        const z = hostPick(s, prizeDoor, rng);
        history.push({ held: s.held, closed: closedDoors(s), opened: z });
        s = applyOpening(s, z, plan);
      };
      open();
      for (;;) {
        // The weights' posterior is the true Bayes posterior.
        const brute = brutePosterior(doors, history);
        posterior(s).forEach((p, x) => expect(p).toBeCloseTo(brute[x], 12));
        const v = cashValue(s);
        for (const d of closedDoors(s)) {
          const t = switchTo(s, d);
          // Switching keeps the value and relocks the prize at V / P(door).
          expect(Math.abs(cashValue(t) - v)).toBeLessThan(1e-12);
          expect(Math.abs(prizeOf(s, d) * brute[d] - v)).toBeLessThan(1e-12);
          expect(Math.abs(expectedAfter(t, history, plan) - v)).toBeLessThan(1e-12);
        }
        checked++;
        if (!canOpen(s)) {
          finals++;
          break;
        }
        // Random play: switch now and then, as a player might.
        if (rng.next() < 0.4) {
          const c = closedDoors(s);
          s = switchTo(s, c[rng.int(c.length)]);
        }
        open();
      }
    }
    expect(checked).toBeGreaterThanOrEqual(40);
    expect(finals).toBeGreaterThanOrEqual(10);
  });

  it('the prize cap RTP·N never binds (it would only round in the house’s favour)', () => {
    const rng = createRng(seededSource(6102));
    for (let round = 0; round < 500; round++) {
      const doors = DOOR_COUNTS[rng.int(DOOR_COUNTS.length)];
      const prizeDoor = rng.int(doors);
      let s = newState(doors, rng.int(doors));
      while (canOpen(s)) {
        s = openDoor(s, hostPick(s, prizeDoor, rng));
        const c = closedDoors(s);
        s = switchTo(s, c[rng.int(c.length)]);
        for (const d of c) {
          const raw = (RTP * doors * s.shrink) / s.weight[d];
          expect(raw).toBeLessThanOrEqual(RTP * doors * (1 + 1e-12));
          expect(prizeOf(s, d) * chanceOf(s, d)).toBeCloseTo(cashValue(s), 12);
        }
      }
    }
  });

  it(`strategies on the real process, every eval config (${ROUNDS} rounds each, within 4 SE)`, () => {
    const rows: string[] = [];
    let seed = 6200;
    for (const cfg of evalSpec.configs) {
      const { doors, plan } = cfg.params as { doors: DoorCount; plan: Plan };
      for (const { name, choose, stop } of STRATEGIES) {
        const r = mc((rng) => playRound(doors, plan, choose, stop, rng), ROUNDS, seed++);
        rows.push(`${cfg.label} | ${name} | ${(100 * r.mean).toFixed(3)}% ± ${(100 * r.se).toFixed(3)}%`);
        expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-9);
      }
    }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
