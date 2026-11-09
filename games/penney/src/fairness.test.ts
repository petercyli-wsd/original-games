// Fairness audit: can any way of playing Penney beat the RTP?
//
// The patterns are chosen before the bet (pickers, presets and swap are all
// disabled while live) and lock the prize at RTP / P(yours first). The bet
// flips the first coin; after every coin that leaves the race open the player
// may cash out (prize × P(yours first | node)) or flip again (by hand or by the
// auto-flip timer, which only ever calls the same flip()). So the only
// decision is when to stop. The automaton node is a sufficient statistic: the
// coins ahead are fresh fair flips, and the node keeps the longest tail that is
// still a prefix of either pattern.
//
// Checks:
//  - Odds, independently: for every one of the 2,900 pairs, P(yours first) is
//    re-derived from the raw flips (the state is the last 4 coins, no
//    automaton, no linear solve: plain value iteration to 1e-15) at every
//    history of up to 4 open flips, and compared with chance(walk(flips)).
//  - Martingale, exact: every live node of every pair, ½·V(H) + ½·V(T) = V.
//  - Optimal stopping: value iteration of max(stop, flip) from the prize
//    (an upper bound) down to its fixed point gives RTP from the bet for the
//    presets and every eval family pair, so no strategy beats RTP.
//  - Strategies (a)–(d) on every eval config (sampling pairs as the eval does),
//    simulated with the game's own automaton and a fair rng coin, and valued
//    exactly by policy evaluation for every pair in the config.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { HOUSE, MAX_LEN, MAX_MULTIPLIER, PRESETS, RTP, YOURS, allPairs, cashAt, onePointAway, race, walk, type Coin, type Race } from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 6_000);

const COINS: Coin[] = ['H', 'T'];

/** Raw-flip value: P(you first | the flips so far end in s), s = up to the last MAX_LEN − 1 coins. */
function rawChances(you: string, house: string): Map<string, number> {
  const states: string[] = [''];
  for (let len = 1; len < MAX_LEN; len++) for (let m = 0; m < 1 << len; m++) states.push([...Array(len)].map((_, i) => ((m >> i) & 1 ? 'T' : 'H')).join(''));
  const index = new Map(states.map((s, i) => [s, i]));
  const trunc = (s: string) => (s.length > MAX_LEN - 1 ? s.slice(s.length - (MAX_LEN - 1)) : s);
  // Each coin from each state: -1 = yours landed, -2 = house landed, else the next state's index.
  const to = states.map((s) => COINS.map((c) => (s + c).endsWith(you) ? -1 : (s + c).endsWith(house) ? -2 : index.get(trunc(s + c))!));
  const v = new Float64Array(states.length).fill(0.5);
  const val = (j: number) => (j === -1 ? 1 : j === -2 ? 0 : v[j]);
  for (let it = 0; it < 1_000_000; it++) {
    let delta = 0;
    for (let i = 0; i < states.length; i++) {
      const x = 0.5 * val(to[i][0]) + 0.5 * val(to[i][1]);
      delta = Math.max(delta, Math.abs(x - v[i]));
      v[i] = x;
    }
    if (delta < 1e-16) break;
  }
  return new Map(states.map((s, i) => [s, v[i]]));
}

/** Every flip history of 1..MAX_LEN−1 coins that hasn't landed either pattern. */
function openHistories(you: string, house: string): string[] {
  const out: string[] = [];
  const grow = (s: string) => {
    if (s.length >= MAX_LEN) return;
    for (const c of COINS) {
      const t = s + c;
      if (t.endsWith(you) || t.endsWith(house)) continue;
      out.push(t);
      grow(t);
    }
  };
  grow('');
  return out;
}

type Rule = (r: Race, node: string) => boolean; // true = cash out now

const after = (r: Race, node: string, c: Coin) => r.next(node, c);
const lossNext = (r: Race, node: string) => COINS.reduce((s, c) => s + (r.chance(after(r, node, c)) === 0 ? 0.5 : 0), 0);

const STRATEGIES: { name: string; stop: Rule }[] = [
  { name: '(a) flip while next coin ≥ 80% safe', stop: (r, s) => 1 - lossNext(r, s) < 0.8 },
  { name: '(b) take any profit', stop: (r, s) => cashAt(r, s) > 1 },
  { name: '(c) flip to the end', stop: () => false },
  {
    // Bail the moment the house is one coin away and you aren't; bank any 2× lead.
    name: '(d) bail when house is 1 away, bank ≥ 2×',
    stop: (r, s) => (onePointAway(r, s) && r.chance(s) < r.p0) || cashAt(r, s) >= 2,
  },
];

const terminal = (r: Race, s: string) => s === YOURS || s === HOUSE || r.decided(s);

/** Exact value of a node-based rule from the bet (first flip forced): policy evaluation to a fixed point. */
function ruleValue(r: Race, stop: Rule): number {
  const v = new Map(r.nodes.map((s) => [s, 0]));
  const val = (s: string) => (terminal(r, s) ? cashAt(r, s) : v.get(s)!);
  for (let it = 0; it < 200_000; it++) {
    let delta = 0;
    for (const s of r.nodes) {
      if (terminal(r, s)) continue;
      const x = stop(r, s) ? cashAt(r, s) : 0.5 * val(after(r, s, 'H')) + 0.5 * val(after(r, s, 'T'));
      delta = Math.max(delta, Math.abs(x - v.get(s)!));
      v.set(s, x);
    }
    if (delta < 1e-15) break;
  }
  return 0.5 * val(after(r, '', 'H')) + 0.5 * val(after(r, '', 'T'));
}

/** The best any stopping strategy can do, from the bet: value iteration of max(stop, flip) down from the prize. */
function optimalValue(r: Race): number {
  const v = new Map(r.nodes.map((s) => [s, r.prize]));
  const val = (s: string) => (terminal(r, s) ? cashAt(r, s) : v.get(s)!);
  for (let it = 0; it < 500_000; it++) {
    let delta = 0;
    for (const s of r.nodes) {
      if (terminal(r, s)) continue;
      const x = Math.max(cashAt(r, s), 0.5 * val(after(r, s, 'H')) + 0.5 * val(after(r, s, 'T')));
      delta = Math.max(delta, Math.abs(x - v.get(s)!));
      v.set(s, x);
    }
    if (delta < 1e-15) break;
  }
  return 0.5 * val(after(r, '', 'H')) + 0.5 * val(after(r, '', 'T'));
}

/** One round as Game.tsx plays it: the bet flips a coin; the race ends once a pattern lands or it is decided. */
function playRound(r: Race, stop: Rule, rng: Rng): number {
  let node = '';
  for (;;) {
    node = r.next(node, rng.next() < 0.5 ? 'H' : 'T');
    if (terminal(r, node)) return cashAt(r, node);
    if (stop(r, node)) return cashAt(r, node);
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

const configPairs = () => {
  const seen = new Map<string, { you: string; house: string }>();
  for (const c of evalSpec.configs) for (const p of [c.params.preset, ...c.params.family]) seen.set(`${p.you}|${p.house}`, p);
  for (const p of PRESETS) seen.set(`${p.you}|${p.house}`, p);
  return [...seen.values()];
};

describe('Penney fairness', () => {
  it('odds re-derived from raw flips (no automaton) at every open history of ≤ 4 coins, all 2,900 pairs', () => {
    // Worst errors are collected and asserted once (tens of thousands of expect() calls are slow).
    let states = 0;
    let worst = 0;
    for (const { you, house } of allPairs()) {
      const r = race(you, house);
      const raw = rawChances(you, house);
      worst = Math.max(worst, Math.abs(raw.get('')! - r.p0));
      for (const h of openHistories(you, house)) {
        const node = walk(r, h);
        const key = h.length > MAX_LEN - 1 ? h.slice(h.length - (MAX_LEN - 1)) : h;
        worst = Math.max(worst, Math.abs(raw.get(key)! - r.chance(node)));
        states++;
      }
    }
    expect(states).toBeGreaterThan(30);
    expect(worst).toBeLessThan(1e-12);
  });

  it('martingale (exact): at every live node of every pair, ½·V(after H) + ½·V(after T) = V now', () => {
    let states = 0;
    let worst = 0;
    for (const { you, house } of allPairs()) {
      const r = race(you, house);
      for (const s of r.nodes) {
        if (r.decided(s)) continue;
        const now = cashAt(r, s);
        const next = 0.5 * cashAt(r, r.next(s, 'H')) + 0.5 * cashAt(r, r.next(s, 'T'));
        worst = Math.max(worst, Math.abs(next - now) / r.prize);
        states++;
      }
    }
    expect(states).toBeGreaterThan(30);
    expect(worst).toBeLessThan(1e-12);
  });

  it('optimal stopping: the best possible strategy is worth RTP for every preset and eval-family pair', () => {
    const worst = Math.max(...configPairs().map(({ you, house }) => Math.abs(optimalValue(race(you, house)) - RTP)));
    expect(worst).toBeLessThan(1e-9);
  });

  it('every strategy (a)–(d) is worth exactly RTP (policy evaluation) for every pair in every eval config', () => {
    let worst = 0;
    for (const { you, house } of configPairs()) {
      const r = race(you, house);
      for (const { stop } of STRATEGIES) worst = Math.max(worst, Math.abs(ruleValue(r, stop) - RTP));
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('strategies (a)–(d) on every eval config return RTP within 4 SE in simulation, never above the max', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params: { preset, family } }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const res = mc(
          (rng) => {
            const pair = rng.next() < 0.5 ? preset : family[rng.int(family.length)];
            return playRound(race(pair.you, pair.house), stop, rng);
          },
          ROUNDS,
          9300 + 17 * ci + si,
        );
        rows.push(`${label.padEnd(44)} ${name.padEnd(44)} ${(res.mean * 100).toFixed(2)}% ± ${(res.se * 100).toFixed(2)}%  max ${res.max.toFixed(2)}×`);
        expect(Math.abs(res.mean - RTP)).toBeLessThan(4 * res.se + 1e-12);
        expect(res.max).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
