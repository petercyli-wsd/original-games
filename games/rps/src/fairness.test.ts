// Fairness audit: can any way of playing Rock Paper Scissors beat the RTP?
//
// A round is a streak of throws. Before each throw the player may cash out
// (from the first streak step on) or throw, and chooses which hand to throw.
// The draw rule (risk) is fixed for the round: its chips are disabled while a
// round is live and the round carries its own `risk`.
//
// Checks, all on the game's real functions (outcomeOf / effectOf via
// playThrow, cashAfter, RISKS, the eval's playRound):
//   1. playThrow draws the house hand uniformly: three equal slices of u.
//   2. Martingale, exact: at every reachable state (risk, streak k) and for
//      every hand the player can throw, E[cash-out after the throw] over the
//      three house hands equals the cash-out now (a Classic draw keeps k, and
//      reaching maxSteps cashes out at cashAfter(maxSteps)).
//   3. Strategies, exact: every strategy here is a stopping rule on the streak
//      k (the hand choice cannot matter, check 2 holds for every hand), so its
//      return solves a finite linear recursion, computed exactly:
//        (a) tester: throw only when the next throw's survival chance >= 0.8,
//            else cash out (no throw survives with 0.8: 2/3, 2/3, 1/3, so this
//            is "cash out at the first step"; at k = 0 cash-out is not offered);
//        (b) take any profit: cash out as soon as the cash-out exceeds the bet;
//        (c) play to the end (the max-streak auto cash-out), and to each eval
//            config's deepest target;
//        (d) the optimal stopping value (Snell envelope over k): the best any
//            strategy can do. It must equal RTP.
//      Monte Carlo then replays (a)-(d) with real throws and adversarial hand
//      rules (counter the last house hand, copy it, random), and the eval's
//      own playRound, as a plumbing check (4 SE). Deep streaks have a huge
//      variance (Hard to 12 is a 1-in-531441 shot at 526,000x), so the binding
//      checks are the exact ones; heavy MC lives in the scratch fairness run.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { RISKS, RISK_ORDER, RTP, cashAfter, effectOf, outcomeOf, playThrow, type Effect, type Hand, type Risk } from './math';

const HANDS: Hand[] = [0, 1, 2];

/** An rng whose next draw is fixed: u lands in the house hand's third. */
const fixedRng = (u: number): Rng => createRng(() => u);

/** The effect of throwing `h` against each house hand, via the real playThrow. */
function effects(risk: Risk, h: Hand): Effect[] {
  return HANDS.map((house) => {
    const th = playThrow(risk, h, fixedRng((house + 0.5) / 3));
    expect(th.house).toBe(house);
    expect(th.outcome).toBe(outcomeOf(h, house));
    return th.effect;
  });
}

/** Cash-out value of a state after a throw: 0 on a bust, else cashAfter(k). */
const valueAt = (risk: Risk, k: number) => cashAfter(risk, Math.min(k, RISKS[risk].maxSteps));

/**
 * Exact expected return of a stopping rule `stop(k)` (k >= 1; k = 0 must throw),
 * throwing hand `h`. Solves E(k) = a E(k+1) + r E(k) for advance / replay counts a, r of 3.
 */
function exactReturn(risk: Risk, stop: (k: number) => boolean, h: Hand = 0): number {
  const eff = effects(risk, h);
  const a = eff.filter((e) => e === 'advance').length / 3;
  const r = eff.filter((e) => e === 'replay').length / 3;
  const max = RISKS[risk].maxSteps;
  let E = cashAfter(risk, max); // reaching the top cashes out
  for (let k = max - 1; k >= 0; k--) {
    const cont = (a * E) / (1 - r);
    E = k >= 1 && stop(k) ? cashAfter(risk, k) : cont;
  }
  return E;
}

/** Snell envelope: the best return of any stopping rule (k >= 1 may stop). */
function optimalReturn(risk: Risk): number {
  const max = RISKS[risk].maxSteps;
  let E = cashAfter(risk, max);
  for (let k = max - 1; k >= 0; k--) {
    let best = 0;
    for (const h of HANDS) {
      const eff = effects(risk, h);
      const a = eff.filter((e) => e === 'advance').length / 3;
      const r = eff.filter((e) => e === 'replay').length / 3;
      best = Math.max(best, (a * E) / (1 - r));
    }
    E = k >= 1 ? Math.max(cashAfter(risk, k), best) : best;
  }
  return E;
}

describe('rps fairness', () => {
  it('draws the house hand uniformly from the host rng', () => {
    for (const h of HANDS) {
      // u in [h/3, (h+1)/3) gives house hand h, at both ends of the slice.
      expect(playThrow('classic', 0, fixedRng(h / 3)).house).toBe(h);
      expect(playThrow('classic', 0, fixedRng((h + 1) / 3 - 1e-12)).house).toBe(h);
    }
  });

  it('every throw is a fair bet at every state, for every hand (exact)', () => {
    let states = 0;
    for (const risk of RISK_ORDER) {
      const spec = RISKS[risk];
      expect(spec.factor).toBeCloseTo(1 / spec.p, 12);
      for (let k = 0; k < spec.maxSteps; k++) {
        const now = cashAfter(risk, k);
        for (const h of HANDS) {
          const after = effects(risk, h).map((e) => (e === 'bust' ? 0 : valueAt(risk, k + (e === 'advance' ? 1 : 0))));
          const mean = after.reduce((x, y) => x + y, 0) / 3;
          // Classic: a draw replays at the same value, so the fair condition is
          // E[after | decided] = now, i.e. mean over 3 equals now.
          expect(Math.abs(mean - now) / now).toBeLessThan(1e-12);
          states++;
        }
        // The effect counts (what the odds strip shows) are the same for every hand.
        const counts = HANDS.map((h) => effects(risk, h).sort().join());
        expect(new Set(counts).size).toBe(1);
      }
    }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  it('effectOf: a win always advances and a loss always busts', () => {
    for (const r of RISK_ORDER) {
      expect(effectOf(r, 'win')).toBe('advance');
      expect(effectOf(r, 'lose')).toBe('bust');
    }
  });

  describe('strategies, exact', () => {
    for (const risk of RISK_ORDER) {
      it(`${risk}: (a) (b) (c) and the optimal stopping rule all return RTP`, () => {
        const survive = 1 - effects(risk, 0).filter((e) => e === 'bust').length / 3;
        const tester = (_k: number) => survive < 0.8; // cash out unless survival >= 0.8
        const profit = (k: number) => cashAfter(risk, k) > 1;
        const toEnd = () => false;
        for (const [name, stop] of [
          ['tester', tester],
          ['profit', profit],
          ['to end', toEnd],
        ] as const) {
          for (const h of HANDS) expect(Math.abs(exactReturn(risk, stop, h) - RTP), `${name} hand ${h}`).toBeLessThan(1e-12);
        }
        for (let t = 1; t <= RISKS[risk].maxSteps; t++) expect(Math.abs(exactReturn(risk, (k) => k >= t) - RTP)).toBeLessThan(1e-12);
        expect(Math.abs(optimalReturn(risk) - RTP)).toBeLessThan(1e-12);
      });
    }
  });

  describe('strategies, Monte Carlo on real throws (plumbing check)', () => {
    type HandRule = 'fixed' | 'counter' | 'copy' | 'random';
    /** One round with stopping rule `stop(k)` and an adaptive hand rule. */
    function round(risk: Risk, stop: (k: number) => boolean, rule: HandRule, rng: Rng): number {
      let k = 0;
      let lastHouse: Hand = 0;
      for (;;) {
        if (k >= RISKS[risk].maxSteps) return cashAfter(risk, k);
        if (k >= 1 && stop(k)) return cashAfter(risk, k);
        const h: Hand = rule === 'fixed' ? 1 : rule === 'counter' ? (((lastHouse + 1) % 3) as Hand) : rule === 'copy' ? lastHouse : (rng.int(3) as Hand);
        const th = playThrow(risk, h, rng);
        lastHouse = th.house;
        if (th.effect === 'bust') return 0;
        if (th.effect === 'advance') k++;
      }
    }
    const ROUNDS = 100_000;
    const mc = (play: (rng: Rng) => number, seed: number) => {
      const rng = createRng(seededSource(seed));
      let s = 0;
      let s2 = 0;
      for (let i = 0; i < ROUNDS; i++) {
        const m = play(rng);
        s += m;
        s2 += m * m;
      }
      const mean = s / ROUNDS;
      return { mean, se: Math.sqrt(Math.max(0, s2 / ROUNDS - mean * mean) / ROUNDS) };
    };

    let seed = 100;
    for (const risk of RISK_ORDER) {
      const rules: [string, (k: number) => boolean, HandRule][] = [
        ['(a) tester', () => true, 'fixed'],
        ['(b) profit', (k) => cashAfter(risk, k) > 1, 'counter'],
        ['(c) to 4', (k) => k >= 4, 'copy'],
        ['(d) hand-chasing, to 3', (k) => k >= 3, 'random'],
      ];
      for (const [name, stop, rule] of rules) {
        const s = seed++;
        it(`${risk} ${name}`, () => {
          const r = mc((rng) => round(risk, stop, rule, rng), s);
          expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-12);
        });
      }
    }

    it('every eval config (the sampled mix) is within 4 SE of RTP', () => {
      evalSpec.configs.forEach((c, i) => {
        const r = mc((rng) => evalSpec.playRound(c.params, rng).multiplier, 900 + i);
        expect(Math.abs(r.mean - RTP), c.label).toBeLessThan(4 * r.se);
      });
    });
  });
});
