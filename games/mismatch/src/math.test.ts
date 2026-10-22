import { createRng, runEval, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BETS,
  MAX_MULTIPLIER,
  RTP,
  SIZES,
  bag,
  completions,
  decided,
  derangements,
  drawInto,
  emptyBoard,
  exactlyChance,
  factorial,
  finishGroups,
  headline,
  isOpen,
  matchChance,
  place,
  prizeFor,
  steps,
  tally,
  winChance,
  type Placed,
} from './math';

const rng = createRng(seededSource(11));

/** A reachable mid-round board: `k` draws into random empty slots. */
function randomBoard(n: number, k: number, r: Rng = rng): Placed {
  let p = emptyBoard(n);
  for (let i = 0; i < k; i++) {
    const empty = p.map((t, s) => (t === null ? s : -1)).filter((s) => s >= 0);
    const d = drawInto(p, empty[r.int(empty.length)], r);
    p = place(p, d.slot, d.token);
  }
  return p;
}

/** Every way to deal the bag into the empty slots (r ≤ 7 keeps this small). */
function* completionsOf(p: Placed): Generator<Placed> {
  const empty = p.map((t, s) => (t === null ? s : -1)).filter((s) => s >= 0);
  const tokens = bag(p);
  const perm = (arr: number[], k: number): number[][] => {
    if (k === arr.length) return [arr.slice()];
    const out: number[][] = [];
    for (let i = k; i < arr.length; i++) {
      [arr[k], arr[i]] = [arr[i], arr[k]];
      out.push(...perm(arr, k + 1));
      [arr[k], arr[i]] = [arr[i], arr[k]];
    }
    return out;
  };
  for (const order of perm(tokens, 0)) {
    const q = p.slice();
    empty.forEach((s, i) => (q[s] = order[i]));
    yield q;
  }
}

const matches = (p: Placed) => p.reduce<number>((c, t, i) => c + (t === i ? 1 : 0), 0);

describe('Mismatch maths', () => {
  it('counts derangements exactly: D(n) = n!·Σ(−1)^i/i!, and the chance tends to 1/e', () => {
    const D = [1, 0, 1, 2, 9, 44, 265, 1854, 14833, 133496, 1334961, 14684570, 176214841];
    D.forEach((d, n) => expect(derangements(n)).toBe(d));
    expect(Math.abs(derangements(12) / factorial(12) - Math.exp(-1))).toBeLessThan(1e-9);
    for (let r = 0; r <= 12; r++)
      for (let a = 0; a <= r; a++) {
        const c = completions(r, a);
        expect(c.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
        expect(c.reduce((s, x) => s + x, 0)).toBe(factorial(r));
      }
    for (const n of SIZES) {
      let total = 0;
      let mean = 0;
      for (let k = 0; k <= n; k++) {
        total += exactlyChance(n, k);
        mean += k * exactlyChance(n, k);
      }
      expect(total).toBeCloseTo(1, 12);
      expect(mean).toBeCloseTo(1, 12); // a random permutation has exactly one fixed point on average
    }
  });

  it('every bet wins as often as the formula says in a direct simulation of shuffles', () => {
    const rounds = 20_000;
    for (const n of SIZES) {
      const counts = new Array(n + 1).fill(0);
      for (let i = 0; i < rounds; i++) counts[matches(rng.shuffle(emptyBoard(n).map((_, s) => s)))]++;
      for (const bet of BETS) {
        const p = headline(n, bet);
        const hits = counts.reduce((s, c, k) => s + (bet.wins(k) ? c : 0), 0);
        expect(Math.abs(hits / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
      }
    }
  });

  it('drawing into slots in any order deals a uniform permutation (the game process matches the formula)', () => {
    const rounds = 30_000;
    const n = 5;
    const seen = new Map<string, number>();
    for (let i = 0; i < rounds; i++) {
      const p = randomBoard(n, n);
      seen.set(p.join(), (seen.get(p.join()) ?? 0) + 1);
    }
    expect(seen.size).toBe(120);
    const e = rounds / 120;
    let chi2 = 0;
    for (const c of seen.values()) chi2 += (c - e) ** 2 / e;
    // 119 degrees of freedom: mean 119, sd ≈ 15.4. Fail only beyond ~5 sd.
    expect(chi2).toBeLessThan(119 + 5 * Math.sqrt(2 * 119));
  });

  it('each draw is a fair bet whichever slot you fill: E[cash-out after] = cash-out now', () => {
    for (const n of SIZES) {
      for (const bet of BETS) {
        const prize = prizeFor(n, bet);
        for (let trial = 0; trial < 12; trial++) {
          const p = randomBoard(n, rng.int(n - 1));
          const t = tally(p);
          if (decided(bet, t)) continue;
          const now = prize * winChance(bet, t);
          p.forEach((tok, slot) => {
            if (tok !== null) return;
            // Enumerate the bag: each token is equally likely.
            let sum = 0;
            for (const token of bag(p)) sum += prize * winChance(bet, tally(place(p, slot, token)));
            expect(sum / t.r).toBeCloseTo(now, 9);
            // The one-step recursion behind it, by token counts.
            const st = steps(t, isOpen(p, slot));
            expect(st.reduce((s, x) => s + x.tokens, 0)).toBe(t.r);
            const viaSteps = st.reduce((s, x) => s + x.tokens * winChance(bet, x.after), 0) / t.r;
            expect(viaSteps).toBeCloseTo(winChance(bet, t), 12);
          });
        }
      }
    }
  });

  it('the drawn odds are the true odds: slot match chances, bright bag sectors and the finish strip', () => {
    for (let trial = 0; trial < 120; trial++) {
      const n = SIZES[rng.int(SIZES.length)];
      const p = randomBoard(n, Math.max(n - 7, 0) + rng.int(Math.min(n, 7)));
      const t = tally(p);
      const tokens = bag(p);
      expect(tokens.length).toBe(t.r);
      // Bright sectors in the bag: tokens whose own slot is still empty. There are a of them.
      expect(tokens.filter((tok) => p[tok] === null).length).toBe(t.a);
      // Each empty slot's drawn match chance (1 in r, or 0) = the share of bag tokens that would match it.
      p.forEach((tok, slot) => {
        if (tok !== null) return;
        const hits = tokens.filter((x) => x === slot).length;
        expect(matchChance(p, slot)).toBeCloseTo(hits / t.r, 14);
      });
      // The finish strip: brute force every remaining deal.
      if (t.r > 7) continue;
      const finals = new Map<number, number>();
      let deals = 0;
      for (const q of completionsOf(p)) {
        const k = matches(q);
        finals.set(k, (finals.get(k) ?? 0) + 1);
        deals++;
      }
      expect(deals).toBe(factorial(t.r));
      for (const bet of BETS) {
        const groups = finishGroups(bet, t);
        expect(groups.reduce((s, g) => s + g.p, 0)).toBeCloseTo(1, 12);
        groups.forEach((g, i) => {
          const to = groups[i + 1]?.from ?? Infinity;
          let c = 0;
          for (const [k, v] of finals) if (k >= g.from && (g.tail || k < to)) c += v;
          expect(g.p).toBeCloseTo(c / deals, 12);
          for (const [k] of finals) if (k >= g.from && (g.tail || k < to)) expect(bet.wins(k)).toBe(g.win);
        });
        const green = groups.filter((g) => g.win).reduce((s, g) => s + g.p, 0);
        let wins = 0;
        for (const [k, v] of finals) if (bet.wins(k)) wins += v;
        expect(green).toBeCloseTo(wins / deals, 12);
        expect(winChance(bet, t)).toBeCloseTo(wins / deals, 12);
        // The round ends exactly when the outcome is certain.
        const d = decided(bet, t);
        expect(d === 'won').toBe(wins === deals);
        expect(d === 'lost').toBe(wins === 0);
      }
    }
  });

  it('the maximum multiplier bounds every prize on offer', () => {
    for (const n of SIZES) for (const bet of BETS) expect(prizeFor(n, bet)).toBeLessThanOrEqual(MAX_MULTIPLIER);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    expect(manifest.rtp).toBe(RTP);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
