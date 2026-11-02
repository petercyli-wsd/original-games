import { createRng, runEval, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BETS,
  MAX_MULTIPLIER,
  N,
  RTP,
  bag,
  completions,
  decided,
  derangements,
  drawNext,
  emptyBoard,
  exactlyChance,
  factorial,
  headline,
  isOpen,
  matchChance,
  matchEffect,
  nextSlot,
  place,
  prizeFor,
  steps,
  tally,
  winChance,
  type Placed,
} from './math';

const rng = createRng(seededSource(11));

/** A reachable mid-round board: `k` draws into slots 1, 2, … in order, as the game plays. */
function randomBoard(n: number, k: number, r: Rng = rng): Placed {
  let p = emptyBoard(n);
  for (let i = 0; i < k; i++) {
    const d = drawNext(p, r);
    p = place(p, d.slot, d.token);
  }
  return p;
}

/** Every way to deal the bag into the empty slots. */
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
    let total = 0;
    let mean = 0;
    for (let k = 0; k <= N; k++) {
      total += exactlyChance(N, k);
      mean += k * exactlyChance(N, k);
    }
    expect(total).toBeCloseTo(1, 12);
    expect(mean).toBeCloseTo(1, 12); // a random permutation has exactly one fixed point on average
    // The headline chances, as exact fractions of 8! = 40320.
    expect(headline(BETS[0]) * 40320).toBeCloseTo(14833, 6);
    expect(headline(BETS[4]) * 40320).toBeCloseTo(630 + 112 + 28 + 1, 6);
  });

  it('every bet wins as often as the formula says in a direct simulation of shuffles', () => {
    const rounds = 40_000;
    const counts = new Array(N + 1).fill(0);
    for (let i = 0; i < rounds; i++) counts[matches(rng.shuffle(emptyBoard().map((_, s) => s)))]++;
    for (const bet of BETS) {
      const p = headline(bet);
      const hits = counts.reduce((s, c, k) => s + (bet.wins(k) ? c : 0), 0);
      expect(Math.abs(hits / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
    }
  });

  it('drawing into the slots in order deals a uniform permutation (the game process matches the formula)', () => {
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

  it('each draw is a fair bet: E[cash-out after] = cash-out now', () => {
    for (const bet of BETS) {
      const prize = prizeFor(bet);
      for (let k = 0; k < N; k++) {
        for (let trial = 0; trial < 6; trial++) {
          const p = randomBoard(N, k);
          const t = tally(p);
          if (decided(bet, t)) continue;
          const now = prize * winChance(bet, t);
          const slot = nextSlot(p);
          // Enumerate the bag: each token is equally likely.
          let sum = 0;
          for (const token of bag(p)) sum += prize * winChance(bet, tally(place(p, slot, token)));
          expect(sum / t.r).toBeCloseTo(now, 9);
          // The one-step recursion behind it, by token counts.
          const st = steps(t, isOpen(p, slot));
          expect(st.reduce((s, x) => s + x.tokens, 0)).toBe(t.r);
          const viaSteps = st.reduce((s, x) => s + x.tokens * winChance(bet, x.after), 0) / t.r;
          expect(viaSteps).toBeCloseTo(winChance(bet, t), 12);
        }
      }
    }
  });

  it('the drawn odds are the true odds: match slice, "can\'t match" slots, slice colour and the win chance', () => {
    for (let trial = 0; trial < 160; trial++) {
      const p = randomBoard(N, rng.int(N));
      const t = tally(p);
      const tokens = bag(p);
      // One equal slice per bag token.
      expect(tokens.length).toBe(t.r);
      // Slots marked "can't match" are the empty slots whose token is gone: r − a of them.
      const cant = p.filter((tok, s) => tok === null && !isOpen(p, s)).length;
      expect(cant).toBe(t.r - t.a);
      // The highlighted slice is the next slot's own token, present iff that slot is open: 1 in r.
      const slot = nextSlot(p);
      const hits = tokens.filter((x) => x === slot).length;
      expect(hits).toBe(isOpen(p, slot) ? 1 : 0);
      expect(matchChance(p, slot)).toBeCloseTo(hits / t.r, 14);
      // Brute force every remaining deal (the full board is covered by the headline test).
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
        let wins = 0;
        for (const [k, v] of finals) if (bet.wins(k)) wins += v;
        // The win chance (readout and the green share of the bar).
        expect(winChance(bet, t)).toBeCloseTo(wins / deals, 12);
        // The round ends exactly when the outcome is certain.
        const d = decided(bet, t);
        expect(d === 'won').toBe(wins === deals);
        expect(d === 'lost').toBe(wins === 0);
        // The match slice is green when a match raises the chance and red when it lowers it.
        if (isOpen(p, slot) && !d) {
          const after = winChance(bet, tally(place(p, slot, slot)));
          const now = winChance(bet, t);
          const eff = matchEffect(bet, t);
          if (Math.abs(after - now) > 1e-12) expect(eff).toBe(after > now ? 'up' : 'down');
          else expect(eff).toBe('same');
        }
      }
    }
  });

  it('the one knob spans at least 25:1 in win chance, and the maximum multiplier bounds every prize', () => {
    const ps = BETS.map((b) => headline(b));
    expect(Math.max(...ps) / Math.min(...ps)).toBeGreaterThan(25);
    for (const bet of BETS) expect(prizeFor(bet)).toBeLessThanOrEqual(MAX_MULTIPLIER);
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
