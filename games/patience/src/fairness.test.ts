// Fairness audit: no strategy can beat the RTP.
//
// The cash-out is V = cashValue(k, deal) = prize × P(win | deal), prize =
// RTP / P(win at the start). Bet deals the first card at once. At a
// checkpoint the player can cash out, deal one card, or "Deal all"; k is
// locked while live. The next card is uniform over the cards left (Game.tsx:
// remaining[rng.int(remaining.length)]), so every next event has at most 10
// outcomes and everything is EXACT. Once the result is certain the round
// settles at 0 or the prize and the rest is dealt for show, with every action
// disabled.
//
// The future of a deal depends only on how many piles are open and on the
// word of tops and deck cards (wordOf), so states are memoised by that key; the
// transitions themselves always go through the game's own place(). We check
//   * the one-step martingale at every reachable checkpoint of every k;
//   * the value of each adversarial stopping rule (backward induction) = RTP;
//   * a Monte Carlo of the same rules with the real RNG and real deals agrees
//     within 4 SE, including "Deal all" (the Auto path).
// FAIRNESS_ROUNDS=200000 raises the Monte Carlo to the full audit size.

import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { K_OPTIONS, MAX_MULTIPLIER, RTP, VOLATILITY, cashValue, decided, ended, newDeal, newPileCards, place, prizeFor, winChance, wordOf, type Deal } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 5_000);
const HEAVY = !!import.meta.env.FAIRNESS_ROUNDS || !!import.meta.env.FAIRNESS_SE;

/** FAIRNESS_SE=0.003 keeps each Monte Carlo cell going (in 50k batches, up to 100M rounds) until its standard error is at most that. */
const SE_TARGET = Number(import.meta.env.FAIRNESS_SE ?? 0);
function monteCarlo(play: () => number): { n: number; mean: number; se: number; max: number } {
  let n = 0;
  let sum = 0;
  let sq = 0;
  let max = 0;
  const se = () => Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2) / n);
  for (;;) {
    const m = play();
    n++;
    sum += m;
    sq += m * m;
    if (m > max) max = m;
    if (n >= ROUNDS && (!SE_TARGET || (n % 50_000 === 0 && (se() <= SE_TARGET || n >= 100_000_000)))) break;
  }
  return { n, mean: sum / n, se: se(), max };
}

const keyOf = (k: number, d: Deal) => `${k}|${d.piles.length}|${wordOf(d)}`;

/** The value right after a card, as Game.tsx settles it: prize / 0 once decided, else the cash-out. */
function valueAfter(k: number, d: Deal): number {
  const s = decided(k, d);
  return s === 'won' ? prizeFor(k) : s === 'lost' ? 0 : cashValue(k, d);
}

/** Every next card (each with chance 1/m) and the deal it leads to. */
const kidsCache = new Map<string, Deal[]>();
function children(k: number, d: Deal): Deal[] {
  const key = keyOf(k, d);
  let c = kidsCache.get(key);
  if (!c) kidsCache.set(key, (c = d.remaining.map((card) => place(d, card))));
  return c;
}

interface View {
  k: number;
  d: Deal;
  v: number;
  /** Chance the next card doesn't settle the round lost. */
  safe: number;
}
type Rule = (x: View) => boolean; // true = cash out now

const viewCache = new Map<string, View>();
function view(k: number, d: Deal): View {
  const key = keyOf(k, d);
  let x = viewCache.get(key);
  if (!x) {
    const kids = children(k, d);
    viewCache.set(key, (x = { k, d, v: cashValue(k, d), safe: kids.filter((c) => decided(k, c) !== 'lost').length / kids.length }));
  }
  return x;
}

const RULES: Record<string, Rule> = {
  // (a) the tester's: deal only while the next card is ≥ 80% safe.
  'a ≥80% safe': (x) => x.safe < 0.8,
  // (b) take any profit.
  'b any profit': (x) => x.v > 1,
  // (c) deal every card.
  'c to the end': () => false,
  // (d) bank whenever the next card can bust you and you are not behind;
  // otherwise deal (chase from behind, ride the free cards).
  'd bank before risk': (x) => x.safe < 1 && x.v >= RTP,
};

function exactValue(k: number, rule: Rule): number {
  const memo = new Map<string, number>();
  const go = (d: Deal, first: boolean): number => {
    if (decided(k, d)) return valueAfter(k, d);
    const key = keyOf(k, d) + (first ? '!' : '');
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const kids = children(k, d);
    const out = !first && rule(view(k, d)) ? cashValue(k, d) : kids.reduce((a, c) => a + go(c, false), 0) / kids.length;
    memo.set(key, out);
    return out;
  };
  return go(newDeal(), true);
}

describe('Patience fairness', () => {
  it('martingale at every reachable checkpoint of every k (exact over the next card)', () => {
    let n = 0;
    let worst = 0;
    for (const k of K_OPTIONS) {
      expect(cashValue(k, newDeal())).toBeCloseTo(RTP, 12);
      expect(prizeFor(k)).toBeLessThanOrEqual(MAX_MULTIPLIER);
      const seen = new Set<string>();
      const todo: Deal[] = [newDeal()];
      while (todo.length) {
        const d = todo.pop()!;
        const key = keyOf(k, d);
        if (seen.has(key)) continue;
        seen.add(key);
        if (decided(k, d)) {
          // A natural end is always decided, and a decided round pays exactly its certain value.
          continue;
        }
        expect(ended(k, d)).toBe(false);
        const v = cashValue(k, d);
        const kids = children(k, d);
        const ev = kids.reduce((a, c) => a + valueAfter(k, c), 0) / kids.length;
        worst = Math.max(worst, Math.abs(ev - v) / Math.max(1, v));
        // The red deck cards are exactly the cards that open a new pile.
        const red = new Set(newPileCards(d));
        kids.forEach((c, i) => expect(c.piles.length > d.piles.length).toBe(red.has(d.remaining[i])));
        n++;
        todo.push(...kids);
      }
    }
    expect(n).toBeGreaterThan(1000);
    expect(worst).toBeLessThan(1e-12);
  });

  it('every adversarial stopping rule returns exactly RTP on every k (backward induction)', () => {
    for (const k of K_OPTIONS) {
      for (const [name, rule] of Object.entries(RULES)) {
        const r = exactValue(k, rule);
        expect(Math.abs(r - RTP), `k=${k} ${name}: ${r}`).toBeLessThan(1e-12);
      }
    }
  });

  it('Monte Carlo with the real RNG and real deals agrees (4 SE), including "Deal all"', () => {
    const rows: string[] = [];
    const rules: Record<string, Rule | 'all'> = { ...RULES, 'c′ Deal all': 'all' };
    for (const [level, k] of Object.entries(VOLATILITY)) {
      for (const [name, rule] of Object.entries(rules)) {
        const rng = createRng(seededSource(31));
        const { n, mean, se, max } = monteCarlo(() => {
          let d = newDeal();
          let m: number;
          for (let first = true; ; first = false) {
            if (!first && rule !== 'all' && rule(view(k, d))) {
              m = cashValue(k, d);
              break;
            }
            // Game.tsx deal(): the card is drawn when the deal starts.
            d = place(d, d.remaining[rng.int(d.remaining.length)]);
            if (decided(k, d)) {
              m = valueAfter(k, d);
              break;
            }
          }
          return m;
        });
        rows.push(`${`${level} k=${k}`.padEnd(14)} ${name.padEnd(20)} ${(mean * 100).toFixed(3)}% ± ${(se * 100).toFixed(3)}%  n=${n}  (win ${(winChance(k, newDeal()) * 100).toFixed(2)}%)`);
        expect(Math.abs(mean - RTP), `k=${k} ${name}: ${mean} ± ${se}`).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(MAX_MULTIPLIER);
      }
    }
    if (HEAVY) console.log(rows.join('\n'));
  });

  it('the eval configs are the same k values this file audits', () => {
    expect(evalSpec.configs.map((c) => c.params)).toEqual(Object.values(VOLATILITY));
  });
});
