// Fairness audit: can any way of playing Tumble beat the RTP?
//
// A round calls where every red face ends (top, side or bottom) after n rolls
// with k cubes; the call, n and k are locked while live and the prize is fixed
// at the bet (RTP / P₀). The first roll happens at once; after each roll the
// player may cash out (prize · P(win | faces, rolls left)) or roll on. Each
// roll draws every cube's direction from rng.int(4) the moment it starts;
// Cash out exists only at a checkpoint (the panel shows a disabled button and
// the C hotkey checks the phase while a roll animates), so a roll cannot be
// dodged. The round ends by itself when the chance hits 0 or 1. The only
// decision is when to stop.
//
// The claim "cash out whenever the next roll is under 80% safe" fails exactly
// when E[V after the next roll | faces] = V now. The next roll has 4^k equally
// likely outcomes, so the check enumerates all of them through the real roll()
// and verdict(), at ≥ 30 states from real rounds on every setting, including
// the last roll and the states one roll from an early end.
//
// Strategies on every eval config (the call as the config states it, and its
// mirror "bottom" for "top"):
//   (a) the tester's: roll on only when the next roll is ≥ 80% safe (it keeps
//       the round alive with chance ≥ 0.8), else cash out;
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) roll to the end;
//   (d) skew rules: cash out when the next roll is more likely to lower the
//       cash-out than raise it, and its mirror (cash out when it is more likely
//       to rise), the two ways to try to time the chain's (−½)^m swing.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  CUBES,
  DIRS,
  MAX_MULTIPLIER,
  PLACES,
  ROLLS,
  RTP,
  prizeFor,
  roll,
  startFaces,
  verdict,
  winChance,
  type Config,
  type Dir,
  type Face,
  type Place,
} from './math';

/** Rounds per strategy run; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 10_000);

const dirsCache = new Map<number, Dir[][]>();
/** Every joint direction for k cubes (4^k, equally likely). */
function allDirs(k: number): Dir[][] {
  const hit = dirsCache.get(k);
  if (hit) return hit;
  let out: Dir[][] = [[]];
  for (let i = 0; i < k; i++) out = out.flatMap((ds) => DIRS.map((d) => [...ds, d]));
  dirsCache.set(k, out);
  return out;
}

/** The cash-out after a roll lands, as Game.tsx's rollNext computes it. */
function valueAfter(prize: number, faces: readonly Face[], left: number, target: Place): number {
  const v = verdict(faces, left, target);
  return v === 'won' ? prize : v === 'lost' ? 0 : prize * winChance(faces, left, target);
}

interface NextRoll {
  /** E[V after the next roll]. */
  mean: number;
  /** Chance the round survives the roll (not ended at 0). */
  survive: number;
  /** Chance the cash-out goes down / up. */
  down: number;
  up: number;
}

const nextCache = new Map<string, NextRoll>();
/** The exact law of the next roll (memoised by state; the enumeration itself is below). */
function nextRoll(prize: number, faces: readonly Face[], left: number, target: Place): NextRoll {
  const key = `${prize}|${faces.join(',')}|${left}|${target}`;
  let hit = nextCache.get(key);
  if (!hit) nextCache.set(key, (hit = enumerateNextRoll(prize, faces, left, target)));
  return hit;
}

function enumerateNextRoll(prize: number, faces: readonly Face[], left: number, target: Place): NextRoll {
  const now = prize * winChance(faces, left, target);
  const outs = allDirs(faces.length).map((ds) =>
    valueAfter(
      prize,
      faces.map((f, i) => roll(f, ds[i])),
      left - 1,
      target,
    ),
  );
  const n = outs.length;
  return {
    mean: outs.reduce((a, v) => a + v, 0) / n,
    survive: outs.filter((v) => v > 0).length / n,
    down: outs.filter((v) => v < now - 1e-12).length / n,
    up: outs.filter((v) => v > now + 1e-12).length / n,
  };
}

/** Stop rule at a checkpoint: cash out now? */
type Stop = (prize: number, faces: readonly Face[], left: number, target: Place) => boolean;

/** One round as Game.tsx plays it: the first roll at once, then a checkpoint after each roll until a verdict. */
function playRound(c: Config, target: Place, rng: Rng, stop: Stop): number {
  const prize = prizeFor(c.rolls, c.cubes, target);
  let faces = startFaces(c.cubes);
  for (let done = 1; ; done++) {
    faces = faces.map((f) => roll(f, DIRS[rng.int(4)]));
    const left = c.rolls - done;
    const v = verdict(faces, left, target);
    if (v === 'won') return prize;
    if (v === 'lost') return 0;
    if (stop(prize, faces, left, target)) return prize * winChance(faces, left, target);
  }
}

describe('Tumble fairness', () => {
  it('martingale (exact): at states from real rounds, E[V after the next roll] = V over all 4^k rolls', () => {
    const rng = createRng(seededSource(21));
    let states = 0;
    for (const rolls of ROLLS)
      for (const cubes of CUBES)
        for (const target of PLACES) {
          const prize = prizeFor(rolls, cubes, target);
          let faces = startFaces(cubes);
          // The bet: V = RTP, and the first roll is a fair step too.
          expect(nextRoll(prize, faces, rolls, target).mean).toBeCloseTo(RTP, 12);
          for (let done = 1; done < rolls; done++) {
            faces = faces.map((f) => roll(f, DIRS[rng.int(4)]));
            const left = rolls - done;
            if (verdict(faces, left, target)) break;
            const v = prize * winChance(faces, left, target);
            const e = nextRoll(prize, faces, left, target).mean;
            expect(Math.abs(e - v)).toBeLessThan(1e-12 * Math.max(1, prize));
            expect(v).toBeLessThanOrEqual(prize);
            states++;
          }
        }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  it('martingale (exact) at every place combination for every rolls-left, including the last roll', () => {
    const faceSet: Face[] = ['top', 'N', 'bottom'];
    for (const cubes of CUBES) {
      const combos = allDirs(cubes).map((ds) => ds.map((d) => faceSet[DIRS.indexOf(d) % 3]));
      for (const target of PLACES)
        for (const rolls of ROLLS) {
          const prize = prizeFor(rolls, cubes, target);
          for (let left = 1; left <= rolls; left++)
            for (const faces of combos) {
              const v = prize * winChance(faces, left, target);
              expect(Math.abs(nextRoll(prize, faces, left, target).mean - v)).toBeLessThan(1e-12 * Math.max(1, prize));
            }
        }
    }
  });

  it('the rng picks each direction with chance ¼ (rng.int(4) maps [0, 1) onto four equal quarters)', () => {
    const rng = createRng(() => 0);
    expect(rng.int(4)).toBe(0);
    for (let q = 0; q < 4; q++) {
      expect(createRng(() => q / 4).int(4)).toBe(q);
      expect(createRng(() => (q + 1) / 4 - 2 ** -53).int(4)).toBe(q);
    }
  });

  it('strategies (a)–(d) on every eval config return RTP within 4 SE', () => {
    const rules: [string, Stop][] = [
      ['(a) roll on only if ≥ 80% safe', (p, f, l, t) => nextRoll(p, f, l, t).survive < 0.8],
      ['(b) any profit', (p, f, l, t) => p * winChance(f, l, t) > 1],
      ['(c) to the end', () => false],
      ['(d) cash if a drop is likelier than a rise', (p, f, l, t) => {
        const n = nextRoll(p, f, l, t);
        return n.down > n.up;
      }],
      ['(d) cash if a rise is likelier than a drop', (p, f, l, t) => {
        const n = nextRoll(p, f, l, t);
        return n.up > n.down;
      }],
    ];
    const rows: string[] = [];
    evalSpec.configs.forEach((cfg, i) => {
      const calls: Place[] = cfg.params.target === 'top' ? ['top', 'bottom'] : [cfg.params.target];
      for (const target of calls)
        rules.forEach(([name, stop], j) => {
          const rng = createRng(seededSource(500 + 20 * i + 5 * calls.indexOf(target) + j));
          let s1 = 0;
          let s2 = 0;
          let max = 0;
          for (let n = 0; n < ROUNDS; n++) {
            const m = playRound(cfg.params, target, rng, stop);
            s1 += m;
            s2 += m * m;
            max = Math.max(max, m);
          }
          const mean = s1 / ROUNDS;
          const se = Math.sqrt(Math.max(0, s2 / ROUNDS - mean * mean) / ROUNDS);
          rows.push(`${name.padEnd(44)} ${`${cfg.label} → ${target}`.padEnd(40)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  z=${((mean - RTP) / se).toFixed(2)}`);
          // + 1e-9: a rule that always stops at a sure 0.99 has se = 0, and summing 200k of them drifts by ~1e-12.
          expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
          expect(max).toBeLessThanOrEqual(MAX_MULTIPLIER);
        });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
