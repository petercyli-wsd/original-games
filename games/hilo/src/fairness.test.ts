// Fairness audit: can any way of playing HiLo beat the RTP?
//
// The deck is infinite: every card is drawCard(rng), rank uniform on 1…13 and
// suit on 0…3. At each card the player may call any offered side (Higher /
// Lower / Same / Red / Black), skip for free, or cash out after a right call.
// So the questions are: does every offered call, at every reachable cash-out
// (including next to the 100,000× cap), keep the cash-out a martingale; is the
// chance shown the chance the code draws; is a skip worth exactly nothing; and
// do the stopping and cap rules of manual play and Auto pay the same?
//
// Every next card is enumerated exactly through the game's own drawCard() (a
// scripted rng feeds it all 13 × 4 int() results), and wins() / afterWin()
// decide each one. Strategy values are computed exactly by recursion over
// (rank, cash, wins so far), memoised on the cash value: from any (rank, cash)
// the future depends on nothing else.
//
// Strategies, per eval config (each config is a band of cash-out targets; its
// top target is that config's "end"):
//   (a) the tester's: call the likelier side when it wins ≥ 80%, otherwise
//       cash out (or skip before the first right call, as cash-out is not
//       offered then);
//   (b) take any profit: cash out at the first right call (every right call
//       from 0.99 pays at least 0.99 · 13/12 > 1);
//   (c) play to the end: the likelier side until the config's top target
//       (and, in the exact test, all the way to the max-win auto cash-out
//       with the ≥ 80% calls only);
//   (d) the strongest we could think of: skip every card until an A, 2, Q or
//       K shows, then take its 12/13 call (exploiting the free skips); the
//       long shot (always the less likely side); Same every time; and every
//       Auto rule (call × skip set) at each target.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  AUTO_PICKS,
  MAX_WIN,
  RANKS,
  RTP,
  SKIP_RULES,
  afterWin,
  autoChoice,
  autoRound,
  available,
  chance,
  drawCard,
  likelier,
  mainPair,
  maxWinReached,
  wins,
  withinCap,
  type AutoPick,
  type Card,
  type Guess,
  type SkipRule,
} from './math';

/** Rounds per Monte Carlo run; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 4_000);

const GUESSES: Guess[] = ['higher', 'lower', 'same', 'red', 'black'];
const RANK_LIST = Array.from({ length: RANKS }, (_, i) => i + 1);

/** Every next card, through the real drawCard() fed every combination of its int(13), int(4) draws. */
const CARDS: Card[] = (() => {
  const out: Card[] = [];
  for (let a = 0; a < RANKS; a++)
    for (let b = 0; b < 4; b++) {
      const seq = [a, b];
      let i = 0;
      const rng = {
        int: (n: number) => {
          if (n !== (i === 0 ? RANKS : 4)) throw new Error(`unexpected int(${n})`);
          return seq[i++];
        },
      };
      out.push(drawCard(rng));
      if (i !== 2) throw new Error('drawCard drew an unexpected number of values');
    }
  return out;
})();

/** The cards a call wins on from a rank (suit of the current card is irrelevant: checked below). */
const winCache = new Map<string, Card[]>();
function winningCards(g: Guess, rank: number): Card[] {
  const k = `${g}${rank}`;
  let w = winCache.get(k);
  if (!w) winCache.set(k, (w = CARDS.filter((c) => wins(g, { rank, suit: 0 }, c))));
  return w;
}

/** A decision at a card: cash out, skip, or a mix of calls (Auto's Random is 50/50). */
type Act = 'cash' | 'skip' | { guess: Guess; w: number }[];
type Policy = (rank: number, cash: number, won: number) => Act;
const one = (guess: Guess): Act => [{ guess, w: 1 }];

/**
 * Exact value of a policy from a random (or fixed) first card, following the
 * game's round: a call over the cap is not offered (an Auto rule cashes out
 * there: outcome "max"); after a right call the round cashes out by itself
 * once maxWinReached. `keyWon` adds the win count to the memo key (for
 * policies that look at it beyond won > 0).
 */
function exactValue(policy: Policy, keyWon = false, start: number | null = null): number {
  const memo = new Map<string, number>();
  const value = (rank: number, cash: number, won: number): number => {
    const key = `${rank}|${cash.toPrecision(13)}|${keyWon ? won : won > 0 ? 1 : 0}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const act = policy(rank, cash, won);
    let v: number;
    if (act === 'cash') {
      if (won === 0) throw new Error('cash-out is only offered after a right call');
      v = cash;
    } else if (act === 'skip') {
      // A skip redraws until a card the policy acts on: the average over those ranks.
      const acting = RANK_LIST.filter((r) => policy(r, cash, won) !== 'skip');
      if (acting.length === 0) throw new Error('policy skips every rank');
      v = acting.reduce((s, r) => s + value(r, cash, won), 0) / acting.length;
    } else {
      v = 0;
      for (const { guess, w } of act) {
        if (!available(guess, rank, 'extended')) throw new Error(`${guess} is not offered on ${rank}`);
        if (!withinCap(cash, guess, rank)) {
          v += w * cash; // Auto: "max" cash-out
          continue;
        }
        const nc = afterWin(cash, guess, rank);
        let e = 0;
        for (const c of winningCards(guess, rank)) e += maxWinReached(nc) ? nc : value(c.rank, nc, won + 1);
        v += (w * e) / CARDS.length;
      }
    }
    memo.set(key, v);
    return v;
  };
  if (start !== null) return value(start, RTP, 0);
  return RANK_LIST.reduce((s, r) => s + value(r, RTP, 0), 0) / RANKS;
}

/** An Auto rule as a policy (mirrors autoRound's done() check, autoChoice and the Random 50/50). */
function autoPolicy(pick: AutoPick, skip: SkipRule, stop: { kind: 'target' | 'streak'; value: number }): Policy {
  return (rank, cash, won) => {
    if (won > 0 && (stop.kind === 'target' ? cash >= stop.value * (1 - 1e-12) : won >= stop.value)) return 'cash';
    if (pick === 'random') {
      if (autoChoice(pick, rank, skip, 0) === 'skip') return 'skip';
      const [up, down] = mainPair(rank);
      expect(autoChoice(pick, rank, skip, 0.25)).toBe(up);
      expect(autoChoice(pick, rank, skip, 0.75)).toBe(down);
      return [
        { guess: up, w: 0.5 },
        { guess: down, w: 0.5 },
      ];
    }
    const a = autoChoice(pick, rank, skip, 0);
    return a === 'skip' ? 'skip' : one(a);
  };
}

/** Manual policies (for exact values and the Monte Carlo through the game's flow). */
const best = (rank: number) => likelier(rank);
const longShot = (rank: number): Guess => {
  const [up, down] = mainPair(rank);
  return chance(up, rank) < chance(down, rank) ? up : down;
};
/** A manual call that is over the cap isn't offered: the player cashes out instead (cash > RTP there). */
const capped = (g: Guess, rank: number, cash: number): Act => (withinCap(cash, g, rank) ? one(g) : 'cash');

const tester: Policy = (rank, cash, won) => (chance(best(rank), rank) >= 0.8 ? capped(best(rank), rank, cash) : won > 0 ? 'cash' : 'skip');
const anyProfit: Policy = (rank, cash) => (cash > 1 ? 'cash' : capped(best(rank), rank, cash));
const toTarget =
  (target: number, g: (rank: number) => Guess): Policy =>
  (rank, cash, won) =>
    won > 0 && cash >= target ? 'cash' : capped(g(rank), rank, cash);
const skipToEdges =
  (target: number): Policy =>
  (rank, cash, won) =>
    won > 0 && cash >= target ? 'cash' : [1, 2, 12, 13].includes(rank) ? capped(best(rank), rank, cash) : 'skip';

/** One manual round as Game.tsx plays it: call / skip / cash out (after a right call), max-win auto cash-out. */
function playManual(policy: Policy, rng: Rng): number {
  let card = drawCard(rng);
  let cash = RTP;
  let won = 0;
  for (;;) {
    const act = policy(card.rank, cash, won);
    if (act === 'cash') return cash;
    if (act === 'skip') {
      card = drawCard(rng);
      continue;
    }
    let g = act[0].guess;
    if (act.length > 1) g = rng.next() < 0.5 ? act[0].guess : act[1].guess;
    if (!available(g, card.rank, 'extended') || !withinCap(cash, g, card.rank)) throw new Error('call not offered');
    const next = drawCard(rng);
    if (!wins(g, card, next)) return 0;
    cash = afterWin(cash, g, card.rank);
    won++;
    card = next;
    if (maxWinReached(cash)) return cash;
  }
}

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

describe('HiLo fairness', () => {
  it('drawCard covers the 52 cards once each, and every call’s chance on screen is its share of them', () => {
    expect(new Set(CARDS.map((c) => `${c.rank}/${c.suit}`)).size).toBe(52);
    for (const rank of RANK_LIST)
      for (const g of GUESSES) {
        if (!available(g, rank, 'extended')) continue;
        for (let suit = 0; suit < 4; suit++) {
          const n = CARDS.filter((c) => wins(g, { rank, suit }, c)).length;
          expect(n / 52).toBeCloseTo(chance(g, rank), 15);
        }
      }
    // Each rank always offers its main pair, and the main pair covers every rank between them.
    for (const rank of RANK_LIST) for (const g of mainPair(rank)) expect(chance(g, rank)).toBeGreaterThan(0);
  });

  it('martingale: at 30+ reached states (and states at the cap), every offered call and a skip keep the cash-out value', () => {
    const rng = createRng(seededSource(909));
    const states: { rank: number; cash: number }[] = [];
    for (let r = 0; r < 200 && states.length < 300; r++) {
      let card = drawCard(rng);
      let cash = RTP;
      for (let s = 0; s < 40; s++) {
        states.push({ rank: card.rank, cash });
        const offered = GUESSES.filter((g) => available(g, card.rank, 'extended') && withinCap(cash, g, card.rank));
        if (!offered.length) break;
        const g = offered[rng.int(offered.length)];
        const next = drawCard(rng);
        if (!wins(g, card, next)) break;
        cash = afterWin(cash, g, card.rank);
        card = next;
        if (maxWinReached(cash)) break;
      }
    }
    // Next to the cap: cash-outs where some calls are refused, and the last one before the auto cash-out.
    for (const cash of [MAX_WIN / 13, MAX_WIN / 12.5, MAX_WIN / 2, MAX_WIN * (7 / 13), (MAX_WIN * 12) / 13]) for (const rank of RANK_LIST) states.push({ rank, cash });
    expect(states.length).toBeGreaterThanOrEqual(30);
    let checked = 0;
    for (const { rank, cash } of states) {
      for (const g of GUESSES) {
        if (!available(g, rank, 'extended') || !withinCap(cash, g, rank)) continue;
        let ev = 0;
        for (const c of CARDS) if (wins(g, { rank, suit: 0 }, c)) ev += afterWin(cash, g, rank) / CARDS.length;
        expect(Math.abs(ev - cash) / cash).toBeLessThan(1e-12);
        // A call that is offered never pays above the max win.
        expect(afterWin(cash, g, rank)).toBeLessThanOrEqual(MAX_WIN * (1 + 1e-12));
        checked++;
      }
      // While the round goes on, some call is offered on some card (so a skip leads somewhere).
      if (!maxWinReached(cash)) expect(RANK_LIST.some((r) => GUESSES.some((g) => available(g, r, 'classic') && withinCap(cash, g, r)))).toBe(true);
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('exact: (a)–(d) and every Auto rule are worth exactly RTP', () => {
    // (a) the tester's rule, played all the way to the max-win auto cash-out.
    expect(exactValue(tester)).toBeCloseTo(RTP, 10);
    // (b) take any profit.
    expect(exactValue(anyProfit)).toBeCloseTo(RTP, 12);
    // (c) the likelier side to a target. The likelier factors run from 13/12 to
    // 13/7, so the reachable cash values blow up with the target: 4× here, the
    // larger targets in the Monte Carlo below (and the audit's heavy run).
    for (const target of [2, 4]) expect(exactValue(toTarget(target, best))).toBeCloseTo(RTP, 10);
    for (const target of [2, 10, 30]) {
      expect(exactValue(skipToEdges(target))).toBeCloseTo(RTP, 10); // (d) free skips to the 12/13 cards
      expect(exactValue(toTarget(target, longShot))).toBeCloseTo(RTP, 10); // (d) long shot
      expect(exactValue(toTarget(target, () => 'same'))).toBeCloseTo(RTP, 10); // (d) Same every time
      expect(exactValue(toTarget(target, () => 'red'))).toBeCloseTo(RTP, 10);
    }
    // Every Auto rule, at a target and a streak, from a random card and from each fixed start card.
    for (const pick of AUTO_PICKS)
      for (const skip of SKIP_RULES) {
        expect(exactValue(autoPolicy(pick, skip, { kind: 'target', value: 2 }))).toBeCloseTo(RTP, 10);
        expect(exactValue(autoPolicy(pick, skip, { kind: 'streak', value: 3 }), true)).toBeCloseTo(RTP, 10);
      }
    for (const start of RANK_LIST) expect(exactValue(autoPolicy('likelier', 'off', { kind: 'target', value: 2 }), false, start)).toBeCloseTo(RTP, 10);
  });

  it('Auto (autoRound) pays exactly what the manual flow pays for the same draws', () => {
    // Replay autoRound's draws through the manual flow with the same policy and rng stream.
    for (const pick of AUTO_PICKS)
      for (const skip of SKIP_RULES) {
        const stop = { kind: 'target' as const, value: 4 };
        const policy = autoPolicy(pick, skip, stop);
        for (let seed = 0; seed < 50; seed++) {
          const a = autoRound({ pick, skip, stop, start: null }, createRng(seededSource(seed)));
          // Manual replay: same draw order as autoRound (start card, then u per decision, then the next card).
          const rng = createRng(seededSource(seed));
          let card = drawCard(rng);
          let cash = RTP;
          let won = 0;
          let paid = -1;
          for (let guard = 0; guard < 10_000 && paid < 0; guard++) {
            const act = policy(card.rank, cash, won);
            if (act === 'cash') {
              paid = cash;
              break;
            }
            const u = rng.next();
            if (act === 'skip') {
              card = drawCard(rng);
              continue;
            }
            const g = act.length > 1 ? (u < 0.5 ? act[0].guess : act[1].guess) : act[0].guess;
            const next = drawCard(rng);
            if (!wins(g, card, next)) paid = 0;
            else {
              cash = afterWin(cash, g, card.rank);
              won++;
              card = next;
              if (maxWinReached(cash)) paid = cash;
            }
          }
          expect(a.multiplier).toBe(paid);
        }
      }
  });

  it('Monte Carlo through the game flow and autoRound: (a)–(d) on every eval config are within 4 SE of RTP', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      const top = params.target[1];
      // The high / extreme configs need the heavy run: at a few thousand rounds
      // a ×100–×2,000 strategy can see no win at all (their exact values are
      // covered above for the same rules at smaller targets).
      if (!import.meta.env.FAIRNESS_ROUNDS && top > 10) return;
      const plays: { name: string; play: (rng: Rng) => number; exact: () => number }[] = [
        { name: '(a) likelier while ≥ 80%', play: (r) => playManual(tester, r), exact: () => exactValue(tester) },
        { name: '(b) any profit', play: (r) => playManual(anyProfit, r), exact: () => exactValue(anyProfit) },
        { name: `(c) likelier to ${top}×`, play: (r) => playManual(toTarget(top, best), r), exact: () => exactValue(toTarget(top, best)) },
        { name: `(d) skip to A/2/Q/K, to ${top}×`, play: (r) => playManual(skipToEdges(top), r), exact: () => exactValue(skipToEdges(top)) },
        { name: `(d) long shot to ${top}×`, play: (r) => playManual(toTarget(top, longShot), r), exact: () => exactValue(toTarget(top, longShot)) },
        {
          name: `(d) Auto random, skip 5–9, ${top}×`,
          play: (r) => autoRound({ pick: 'random', skip: '5-9', stop: { kind: 'target', value: top }, start: null }, r).multiplier,
          exact: () => exactValue(autoPolicy('random', '5-9', { kind: 'target', value: top })),
        },
      ];
      plays.forEach(({ name, play }, si) => {
        const { mean, se } = mc(play, ROUNDS, 3300 + 17 * ci + si);
        rows.push(`${label.padEnd(24)} ${name.padEnd(34)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9); // (+1e-9: float summation error when a rule always pays RTP, se = 0)
      });
      // The exact values for the same strategies (heavy: only with the audit's big run).
      // (The likelier side to a big target has too many reachable cash values to enumerate.)
      if (import.meta.env.FAIRNESS_ROUNDS && top <= 10) for (const { name, exact } of plays) rows.push(`${label.padEnd(24)} ${name.padEnd(34)} exact ${(exact() * 100).toFixed(9)}%`);
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
