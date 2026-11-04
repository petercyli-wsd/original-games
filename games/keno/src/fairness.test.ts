// Fairness audit: can any way of playing Keno beat the RTP?
//
// Keno has no mid-round decision. The player picks 1–10 numbers and a risk,
// presses Bet, and playKeno() draws 10 of 40 at once; the animation only
// reveals a result that is already fixed (and the ticket's fair value is that
// result from the moment the bet is placed). So the tester's rule (a), "take
// any profit" (b) and "play to the end" (c) are all the same strategy: bet
// and wait. The only choices are made before the draw: risk, how many numbers,
// and which numbers. The questions are therefore:
//   - does each (risk, picks) table return exactly 99%?
//   - does the draw code make every 10-subset equally likely, so that the
//     hypergeometric chances on screen are the chances the code draws?
//   - can any way of choosing the numbers (a fixed block, last round's draw,
//     the numbers drawn least or most so far, Auto's re-pick) do better?
// The cash-out "martingale" collapses to one step: V before the draw is RTP,
// and E[payout] over the draw is Σ_k P(k)·pay(k), checked exactly in integers.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { BOARD, DRAWS, MAX_PICKS, PAYTABLE, RISKS, RTP, choose, drawNumbers, hitChance, playKeno, randomPicks, tableRtpFraction, type Risk } from './math';

/** Rounds per Monte Carlo run; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

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

/** An rng that answers int(n) from a list (as fractions of n) and fails on anything else. */
function scripted(pick: (n: number, i: number) => number): Rng {
  let i = 0;
  return {
    next: () => {
      throw new Error('drawNumbers should only use int()');
    },
    int: (n: number) => {
      const v = pick(n, i++);
      if (!(Number.isInteger(v) && v >= 0 && v < n)) throw new Error('bad scripted value');
      return v;
    },
    shuffle: () => {
      throw new Error('no shuffles');
    },
  };
}

describe('Keno fairness', () => {
  it('one-step martingale: every one of the 40 tables pays exactly RTP over the C(40,10) draws', () => {
    for (const risk of RISKS)
      for (let n = 1; n <= MAX_PICKS; n++) {
        const { num, den } = tableRtpFraction(risk, n);
        expect(100n * num).toBe(99n * den);
        // Also through the displayed chances (what the paytable shows).
        let ev = 0;
        for (let k = 0; k <= n; k++) ev += hitChance(n, k) * (PAYTABLE[risk][n - 1][k] / 100);
        expect(ev).toBeCloseTo(RTP, 12);
      }
  });

  it('the draw is a partial Fisher–Yates: int(40 − i) at step i, every ordered 10-tuple reachable exactly once', () => {
    // drawNumbers asks for exactly int(40), int(39), …, int(31): 40·39·…·31 equally likely scripts,
    // the number of ordered 10-tuples of distinct numbers. Check the sizes and that the map is a bijection
    // on a large sample of scripts (decode the tuple back to its script).
    const sizes: number[] = [];
    drawNumbers(scripted((n) => (sizes.push(n), 0)));
    expect(sizes).toEqual(Array.from({ length: DRAWS }, (_, i) => BOARD - i));
    const rng = createRng(seededSource(11));
    for (let t = 0; t < 1000; t++) {
      const script = sizes.map((n) => rng.int(n));
      const out = drawNumbers(scripted((_, i) => script[i]));
      expect(new Set(out).size).toBe(DRAWS);
      for (const x of out) expect(x >= 1 && x <= BOARD).toBe(true);
      // Invert: replay the pool and recover each j from where the drawn number sits.
      const pool = Array.from({ length: BOARD }, (_, i) => i + 1);
      const back: number[] = [];
      for (let i = 0; i < DRAWS; i++) {
        const j = pool.indexOf(out[i]);
        back.push(j - i);
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      expect(back).toEqual(script);
    }
    // The edges: all-zero and all-max scripts give valid, different draws.
    const lo = drawNumbers(scripted(() => 0));
    const hi = drawNumbers(scripted((n) => n - 1));
    expect(lo).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(hi).size).toBe(DRAWS);
  });

  it('with the real rng: hit counts match the hypergeometric chances on screen, every number equally likely', () => {
    const rng = createRng(seededSource(2024));
    const rounds = 100_000;
    const perNumber = new Array<number>(BOARD + 1).fill(0);
    const n = 5;
    const picks = [3, 14, 22, 31, 40];
    const hits = new Array<number>(n + 1).fill(0);
    for (let r = 0; r < rounds; r++) {
      const round = playKeno(rng, 'classic', picks);
      for (const d of round.drawn) perNumber[d]++;
      hits[round.hits]++;
    }
    for (let x = 1; x <= BOARD; x++) {
      const p = DRAWS / BOARD;
      expect(Math.abs(perNumber[x] / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
    }
    for (let k = 0; k <= n; k++) {
      const p = hitChance(n, k);
      expect(Math.abs(hits[k] / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-12);
    }
    expect(choose(BOARD, DRAWS)).toBe(847_660_528);
  });

  it('Auto pick (randomPicks) returns distinct numbers in range, the requested count', () => {
    const rng = createRng(seededSource(3));
    for (let t = 0; t < 2000; t++) {
      const c = 1 + rng.int(MAX_PICKS);
      const p = randomPicks(rng, c);
      expect(p).toHaveLength(c);
      expect(new Set(p).size).toBe(c);
      for (const x of p) expect(x >= 1 && x <= BOARD).toBe(true);
    }
  });

  it('Monte Carlo: every eval config under every way of choosing numbers is within 4 SE of RTP', () => {
    // (a), (b), (c) collapse to "bet and wait" (no decision after the bet).
    // (d) number-choosing systems: the block 1…n, last round's drawn numbers ("hot"),
    // the n numbers drawn least so far ("due"), and Auto's fresh numbers every bet.
    type Chooser = { name: string; make: () => (rng: Rng, n: number, risk: Risk) => number };
    const choosers: Chooser[] = [
      { name: '(a/b/c) block 1…n', make: () => (rng, n, risk) => playKeno(rng, risk, Array.from({ length: n }, (_, i) => i + 1)).multiplier },
      {
        name: '(d) last draw (hot)',
        make: () => {
          let last: number[] = Array.from({ length: DRAWS }, (_, i) => i + 1);
          return (rng, n, risk) => {
            const r = playKeno(rng, risk, last.slice(0, n));
            last = r.drawn;
            return r.multiplier;
          };
        },
      },
      {
        name: '(d) least drawn (due)',
        make: () => {
          const count = new Array<number>(BOARD + 1).fill(0);
          return (rng, n, risk) => {
            const due = Array.from({ length: BOARD }, (_, i) => i + 1)
              .sort((a, b) => count[a] - count[b] || a - b)
              .slice(0, n);
            const r = playKeno(rng, risk, due);
            for (const d of r.drawn) count[d]++;
            return r.multiplier;
          };
        },
      },
      { name: '(d) Auto re-pick', make: () => (rng, n, risk) => playKeno(rng, risk, [], n).multiplier },
    ];
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      choosers.forEach(({ name, make }, si) => {
        const play = make();
        let k = 0;
        // Cycle through the config's picks counts so each gets the same share.
        const { mean, se } = mc((rng) => play(rng, params.picks[k++ % params.picks.length], params.risk), ROUNDS, 900 + 31 * ci + si);
        rows.push(`${label.padEnd(36)} ${name.padEnd(24)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
