// Fairness audit: can any way of playing Bayes beat the RTP?
//
// The hidden coin is drawn at the bet; each flip lands heads with the drawn
// coin's chance. The cash-out is prize × P(backed coin | flips) and the reveal
// pays prize × 1[backed coin], whose expectation given the flips is the same
// number. P(coin | flips) is a martingale, so the cash-out is a bounded
// martingale starting at RTP and optional stopping gives RTP for every rule.
//
// Decisions mid-round: cash out, flip again, or reveal now (side, prior,
// separation and flip count are locked while live). Space = flip (or reveal
// after the last flip), C = cash out; the buttons call the same functions.
// The face and the reveal are drawn when the step starts, and every action is
// disabled until the animation ends; the ticket reads a ref that holds the
// resolved value, set right after the bet and after each draw.
//
// The future depends only on (flips seen k, evidence d = heads − tails), so
// every strategy is a rule on that Markov chain. Checks, with the game's own
// functions (likelihood, posteriorGold, cashOut, prize, winChance), drawing the
// coin and faces exactly as Game.tsx does:
//   - posteriorGold(d) equals Bayes' rule computed from raw head/tail counts;
//   - martingale at EVERY checkpoint state of all 72 settings: E[V after a
//     flip] = V and E[reveal] = V, exactly (to 1e-12), outcomes enumerated;
//   - optimal stopping: the Snell envelope over {cash, flip, reveal} = V, so no
//     strategy beats RTP;
//   - strategies (a)–(d) exactly (forward DP over (coin, d)) on all settings,
//     and by Monte Carlo through the game's draws on every eval config.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  COINS,
  FLIPS,
  HEADS_GOLD,
  PRIORS,
  RTP,
  SEPARATIONS,
  cashOut,
  likelihood,
  posteriorGold,
  prize,
  winChance,
  type Coin,
  type Face,
  type Settings,
} from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000 (scratch fairness/run-heavy-*.sh). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 10_000);

const SETTINGS: Settings[] = COINS.flatMap((side) =>
  PRIORS.flatMap((prior) => SEPARATIONS.flatMap((sep) => FLIPS.map((flips) => ({ side, prior, sep, flips })))),
);

type Action = 'cash' | 'flip' | 'reveal';
/** A rule at a checkpoint after k ≥ 1 flips with evidence d. 'flip' after the last flip means reveal (as Space does). */
type Strategy = (s: Settings, k: number, d: number) => Action;

const V = (s: Settings, d: number) => cashOut(s.side, s.prior, posteriorGold(s.prior, s.sep, d));
const chance = (s: Settings, d: number) => winChance(s.side, posteriorGold(s.prior, s.sep, d));

const STRATEGIES: { name: string; play: Strategy }[] = [
  // A flip never loses anything; the only step that can bust is the reveal,
  // whose survival chance is the win chance. So: reveal when it's ≥ 80%,
  // otherwise keep watching, and cash out if the flips run out first.
  { name: '(a) reveal only at ≥ 80% survival', play: (s, k, d) => (chance(s, d) >= 0.8 ? 'reveal' : k < s.flips ? 'flip' : 'cash') },
  { name: '(b) take any profit', play: (s, _k, d) => (V(s, d) > 1 ? 'cash' : 'flip') },
  { name: '(c) watch every flip, then reveal', play: () => 'flip' },
  // Lock in the lottery when the flips favour you (reveal above the start
  // value), cut losses when they don't (cash out below half of it).
  { name: '(d) reveal when ahead, cash when well behind', play: (s, k, d) => (V(s, d) > RTP ? 'reveal' : V(s, d) < RTP / 2 || k === s.flips ? 'cash' : 'flip') },
];

/** Exact expected payout: forward DP over the joint mass of (coin, d). */
function exactValue(s: Settings, play: Strategy): number {
  const off = s.flips;
  let mass: Record<Coin, Float64Array> = { gold: new Float64Array(2 * off + 1), silver: new Float64Array(2 * off + 1) };
  mass.gold[off] = s.prior;
  mass.silver[off] = 1 - s.prior;
  const full = prize(s.side, s.prior);
  let ev = 0;
  for (let k = 0; k <= s.flips; k++) {
    const next: Record<Coin, Float64Array> = { gold: new Float64Array(2 * off + 1), silver: new Float64Array(2 * off + 1) };
    for (let d = -k; d <= k; d += 2) {
      const mg = mass.gold[d + off];
      const ms = mass.silver[d + off];
      if (mg + ms === 0) continue;
      // The joint mass gives the posterior independently of posteriorGold().
      expect(Math.abs(mg / (mg + ms) - posteriorGold(s.prior, s.sep, d))).toBeLessThan(1e-12);
      let a: Action = k === 0 ? 'flip' : play(s, k, d); // Bet flips the first coin straight away.
      if (a === 'flip' && k === s.flips) a = 'reveal';
      if (a === 'cash') ev += (mg + ms) * V(s, d);
      else if (a === 'reveal') ev += (s.side === 'gold' ? mg : ms) * full;
      else
        for (const c of ['gold', 'silver'] as Coin[]) {
          const m = mass[c][d + off];
          const h = likelihood('H', c, s.sep);
          next[c][d + 1 + off] += m * h;
          next[c][d - 1 + off] += m * (1 - h);
        }
    }
    mass = next;
  }
  return ev;
}

/** One round drawn exactly as Game.tsx draws it (coin at the bet, then each face). */
function playRound(s: Settings, play: Strategy, rng: Rng): number {
  const coin: Coin = rng.next() < s.prior ? 'gold' : 'silver';
  const full = prize(s.side, s.prior);
  let d = 0;
  for (let k = 0; ; k++) {
    let a: Action = k === 0 ? 'flip' : play(s, k, d);
    if (a === 'flip' && k === s.flips) a = 'reveal';
    if (a === 'cash') return V(s, d);
    if (a === 'reveal') return coin === s.side ? full : 0;
    const face: Face = rng.next() < likelihood('H', coin, s.sep) ? 'H' : 'T';
    d += face === 'H' ? 1 : -1;
  }
}

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    s += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

describe('Bayes fairness', () => {
  it('posteriorGold(d) is Bayes’ rule from the raw head and tail counts', () => {
    for (const sep of SEPARATIONS) {
      const p = HEADS_GOLD[sep];
      for (const prior of PRIORS) {
        for (let h = 0; h <= 20; h++) {
          for (let t = 0; t + h <= 20; t++) {
            const g = prior * p ** h * (1 - p) ** t;
            const sv = (1 - prior) * (1 - p) ** h * p ** t;
            expect(Math.abs(posteriorGold(prior, sep, h - t) - g / (g + sv))).toBeLessThan(1e-12);
          }
        }
      }
    }
  });

  it('martingale at every checkpoint of all 72 settings: flipping and revealing are both worth V', () => {
    let states = 0;
    let worst = 0;
    for (const s of SETTINGS) {
      const full = prize(s.side, s.prior);
      expect(V(s, 0)).toBeCloseTo(RTP, 12);
      for (let k = 1; k <= s.flips; k++) {
        for (let d = -k; d <= k; d += 2) {
          const pg = posteriorGold(s.prior, s.sep, d);
          const v = V(s, d);
          // Predictive chance of heads from the posterior over the coins.
          const pH = pg * likelihood('H', 'gold', s.sep) + (1 - pg) * likelihood('H', 'silver', s.sep);
          const reveal = full * (s.side === 'gold' ? pg : 1 - pg);
          worst = Math.max(worst, Math.abs(reveal - v) / full);
          if (k < s.flips) {
            const afterFlip = pH * V(s, d + 1) + (1 - pH) * V(s, d - 1);
            worst = Math.max(worst, Math.abs(afterFlip - v) / full);
          }
          states++;
        }
      }
    }
    expect(states).toBeGreaterThan(5000);
    expect(worst).toBeLessThan(1e-12);
  });

  it('optimal stopping: the Snell envelope over {cash, flip, reveal} equals V everywhere', () => {
    for (const s of SETTINGS) {
      const full = prize(s.side, s.prior);
      // U[d] at the last checkpoint: cash or reveal, both V.
      let U = new Map<number, number>();
      for (let d = -s.flips; d <= s.flips; d += 2) U.set(d, Math.max(V(s, d), full * chance(s, d)));
      for (let k = s.flips - 1; k >= 0; k--) {
        const prev = new Map<number, number>();
        for (let d = -k; d <= k; d += 2) {
          const pg = posteriorGold(s.prior, s.sep, d);
          const pH = pg * likelihood('H', 'gold', s.sep) + (1 - pg) * likelihood('H', 'silver', s.sep);
          const cont = pH * U.get(d + 1)! + (1 - pH) * U.get(d - 1)!;
          const u = k === 0 ? cont : Math.max(V(s, d), full * chance(s, d), cont);
          expect(Math.abs(u - V(s, d))).toBeLessThan(1e-12 * full);
          prev.set(d, u);
        }
        U = prev;
      }
      expect(U.get(0)!).toBeCloseTo(RTP, 12);
    }
  });

  it('strategies (a)–(d) return exactly RTP on all 72 settings (exact DP)', () => {
    for (const s of SETTINGS) for (const { play } of STRATEGIES) expect(Math.abs(exactValue(s, play) - RTP)).toBeLessThan(1e-12);
  });

  it('strategies (a)–(d) through the game’s draws on every eval config: RTP within 4 SE, max ≤ maxMultiplier', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach((cfg, ci) => {
      const s = cfg.params;
      STRATEGIES.forEach(({ name, play }, si) => {
        const { mean, se, max } = mc((r) => playRound(s, play, r), ROUNDS, 5200 + 13 * ci + si);
        rows.push(`${cfg.label.padEnd(44)} ${name.padEnd(46)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  exact ${(exactValue(s, play) * 100).toFixed(4)}%  max ${max.toFixed(2)}×`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
