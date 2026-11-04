// Fairness audit: no strategy can beat the RTP.
//
// The cash-out is V = prize × lit/total for the current node, prize = RTP /
// P(win at the start). Bet plays the first flip at once; after that the only
// decision is "flip" or "cash out" (window and depth are locked while live).
// Every flip has exactly two outcomes, each with chance ½, so everything here
// is EXACT: we tabulate countLit (the game's own function) at every node of
// the tree for a setting and check
//   * the one-step martingale at every node: lit(node) = lit(L) + lit(R) as
//     integers, so V = ½ V(L) + ½ V(R);
//   * the value of each adversarial stopping rule, computed by backward
//     induction on the whole tree, equals RTP;
//   * a Monte Carlo of the same rules, flipping with the real RNG exactly as
//     Game.tsx does (rng.next() < 0.5 ? 'L' : 'R'), agrees within 4 SE.
// FAIRNESS_ROUNDS=200000 raises the Monte Carlo to the full audit size.

import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { DEPTHS, MAX_MULTIPLIER, PRESETS, RTP, VOLATILITY, clampWin, countLit, presetById, prizeFor, type Dir, type Win } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 10_000);
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

/** lit[len][idx] for every node of the tree (idx = path bits, L = 0, first step most significant). */
interface Tree {
  depth: number;
  win: Win;
  prize: number;
  lit: number[][];
}

const pathOf = (len: number, idx: number): Dir[] => Array.from({ length: len }, (_, b) => ((idx >> (len - 1 - b)) & 1 ? 'R' : 'L'));

function buildTree(depth: number, win: Win): Tree {
  const lit: number[][] = [];
  for (let len = 0; len <= depth; len++) {
    const row: number[] = [];
    for (let i = 0; i < 2 ** len; i++) {
      const c = countLit(pathOf(len, i), depth, win);
      expect(c.total).toBe(2 ** (depth - len));
      row.push(c.lit);
    }
    lit.push(row);
  }
  return { depth, win, prize: prizeFor(depth, win), lit };
}

const pOf = (t: Tree, len: number, idx: number) => t.lit[len][idx] / 2 ** (t.depth - len);

interface View {
  len: number;
  /** Win chance now, and after a flip to the left / right. */
  p: number;
  pL: number;
  pR: number;
  /** Cash-out now (multiplier of the stake). */
  v: number;
  prize: number;
}

type Rule = (s: View) => boolean; // true = cash out now

const RULES: Record<string, Rule> = {
  // (a) the tester's: flip only while the next flip survives with chance ≥ 0.8
  // (both children still have a lit ending), else cash out.
  'a ≥80% safe': (s) => (Number(s.pL > 0) + Number(s.pR > 0)) / 2 < 0.8,
  // (b) take any profit.
  'b any profit': (s) => s.v > 1,
  // (c) play to the end.
  'c to the end': () => false,
  // (d) lock-in hunter: keep flipping while a flip can lock the prize in (a
  // child at p = 1) or can't lose outright; otherwise bank whenever the
  // cash-out is at least the start value, and gamble only when behind.
  'd lock-in hunter': (s) => {
    if (s.pL === 1 || s.pR === 1) return false;
    if (s.pL > 0 && s.pR > 0) return false;
    return s.v >= RTP;
  },
};

function view(t: Tree, len: number, idx: number): View {
  const p = pOf(t, len, idx);
  return { len, p, pL: pOf(t, len + 1, 2 * idx), pR: pOf(t, len + 1, 2 * idx + 1), v: t.prize * p, prize: t.prize };
}

/** Exact value of a stopping rule by backward induction. Bet plays the first flip, so no stop at len 0. */
function exactValue(t: Tree, rule: Rule): number {
  const go = (len: number, idx: number): number => {
    const p = pOf(t, len, idx);
    if (p === 0) return 0;
    if (p === 1) return t.prize;
    if (len > 0 && rule(view(t, len, idx))) return t.prize * p;
    return 0.5 * go(len + 1, 2 * idx) + 0.5 * go(len + 1, 2 * idx + 1);
  };
  return go(0, 0);
}

/** One round played with the real RNG, as Game.tsx steps it. */
function playMC(t: Tree, rule: Rule, rng: ReturnType<typeof createRng>): number {
  let len = 0;
  let idx = 0;
  for (;;) {
    const d: Dir = rng.next() < 0.5 ? 'L' : 'R';
    len++;
    idx = idx * 2 + (d === 'R' ? 1 : 0);
    const p = pOf(t, len, idx);
    if (p === 0) return 0;
    if (p === 1) return t.prize;
    if (rule(view(t, len, idx))) return t.prize * p;
  }
}

const CONFIGS = Object.entries(VOLATILITY).map(([level, c]) => ({ label: `${level} ${c.preset}/${c.depth}`, depth: c.depth as number, win: presetById(c.preset)! as Win }));

describe('Mediant fairness', () => {
  // Every preset at every depth, the eval configs, and random custom windows (including 4-wide slivers).
  const rng0 = createRng(seededSource(2024));
  const settings: { depth: number; win: Win }[] = [];
  for (const w of PRESETS) for (const n of DEPTHS) settings.push({ depth: n, win: w });
  while (settings.length < PRESETS.length * DEPTHS.length + 40) {
    const n = DEPTHS[rng0.int(DEPTHS.length)];
    const lo = rng0.int(841);
    const w = settings.length % 3 ? clampWin(lo, lo + rng0.int(300)) : clampWin(lo, lo + 4);
    if (countLit([], n, w).lit > 0) settings.push({ depth: n, win: w });
  }
  const trees = settings.filter((s) => countLit([], s.depth, s.win).lit > 0).map((s) => buildTree(s.depth, s.win));

  it('martingale at every node of every setting: lit(node) = lit(L) + lit(R), so V = ½ V(L) + ½ V(R)', () => {
    let states = 0;
    let worst = 0;
    for (const t of trees) {
      expect(t.prize * pOf(t, 0, 0)).toBeCloseTo(RTP, 12);
      expect(t.prize).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
      for (let len = 0; len < t.depth; len++) {
        for (let i = 0; i < 2 ** len; i++) {
          expect(t.lit[len][i]).toBe(t.lit[len + 1][2 * i] + t.lit[len + 1][2 * i + 1]);
          const v = t.prize * pOf(t, len, i);
          const ev = 0.5 * t.prize * pOf(t, len + 1, 2 * i) + 0.5 * t.prize * pOf(t, len + 1, 2 * i + 1);
          worst = Math.max(worst, Math.abs(ev - v) / Math.max(1, v));
          if (pOf(t, len, i) > 0 && pOf(t, len, i) < 1) states++;
        }
      }
      // Leaves are decided: the round always ends by the last flip.
      for (let i = 0; i < 2 ** t.depth; i++) expect([0, 1]).toContain(pOf(t, t.depth, i));
    }
    expect(states).toBeGreaterThan(300);
    expect(worst).toBeLessThan(1e-12);
  });

  it('every adversarial stopping rule returns exactly RTP on every setting (backward induction)', () => {
    for (const t of trees) {
      for (const [name, rule] of Object.entries(RULES)) {
        const r = exactValue(t, rule);
        expect(Math.abs(r - RTP), `${t.win.lo}-${t.win.hi}/${t.depth} ${name}: ${r}`).toBeLessThan(1e-12);
      }
    }
  });

  it('Monte Carlo of the same rules with the real flip agrees (4 SE), and nothing pays above maxMultiplier', () => {
    const rows: string[] = [];
    for (const c of CONFIGS) {
      const t = buildTree(c.depth, c.win);
      for (const [name, rule] of Object.entries(RULES)) {
        const rng = createRng(seededSource(77));
        const { n, mean, se, max } = monteCarlo(() => playMC(t, rule, rng));
        rows.push(`${c.label.padEnd(22)} ${name.padEnd(18)} ${(mean * 100).toFixed(3)}% ± ${(se * 100).toFixed(3)}%  n=${n}  (exact ${(exactValue(t, rule) * 100).toFixed(6)}%)`);
        expect(Math.abs(mean - RTP), `${c.label} ${name}: ${mean} ± ${se}`).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(MAX_MULTIPLIER);
      }
    }
    if (HEAVY) console.log(rows.join('\n'));
  });

  it('the eval configs are the same settings this file audits', () => {
    expect(evalSpec.configs.map((c) => c.params)).toEqual(Object.values(VOLATILITY));
  });
});
