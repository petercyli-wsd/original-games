// Reels: a 5×3 video slot with 20 fixed paylines, the format of the slots on
// Stake Originals and BC.Game, rebuilt with geometric symbols.
//
// Rules
//   - Each reel is a fixed circular strip; a spin stops every reel at a
//     uniform position and shows three consecutive symbols.
//   - A line pays its leftmost run of one symbol (3, 4 or 5 long) from reel 1.
//     Wild (reels 2–4 only) substitutes for every paying symbol, never for
//     the scatter. Line pays are multiples of the line bet = stake ÷ lines.
//   - 3 / 4 / 5 scatters anywhere award 10 / 15 / 20 free spins on the same
//     reels and lines with every win ×2. Free spins retrigger (adding 10 / 15
//     / 20), up to FS_CAP spins per feature.
//   - Optional feature buy: pay `buyPrice × stake` for 10 free spins.
//
// Exact RTP (no simulation anywhere in the pricing)
//   1. Line EV. Every stop is uniform and the reels are independent, so the
//      symbol in any row of reel i has the strip's frequency p_i(s) = c_i(s)/len_i,
//      and every line has the same distribution. With X the symbol on reel 1
//      and a_j(X) = p_j(X) + p_j(wild), the run length k has
//        P(run ≥ k | X) = a_2(X) ··· a_k(X),
//      so L = Σ_X p_1(X) Σ_{k=3..5} pay(X, k) · P(run = k)   [line-bet units].
//      A spin on n lines pays (1/n) Σ line pays in stake units, so its EV is L
//      for every n: the lines knob changes the spread, never the RTP.
//   2. Scatters. Scatters sit at least 3 apart on each strip, so a window holds
//      at most one and reel i shows one with q_i = 3·c_i(scatter)/len_i exactly.
//      The count K on 5 independent reels is the convolution of Bernoulli(q_i).
//   3. Free spins. Each free spin is worth 2L and awards F(K) more spins, with
//      μ = E[F(K)]. Uncapped, an award of m spins plays m/(1−μ) spins on
//      average (a geometric series), so the feature is worth 2L·m/(1−μ). The
//      cap at FS_CAP spins is a tiny exact correction: E[spins] is computed by
//      DP over (spins awarded, spins left) and the tests check it against the
//      series. RTP = L + Σ_k P(K=k) · 2L · E[spins | start F(k)].
//   4. Feature buy: RTP_buy = 2L · E[spins | start 10] / buyPrice.
//
// Max win. One spin pays at most maxLine (every line paying the top 5-of-a-kind)
// in stake units, so a round pays at most maxLine · (1 + 2·FS_CAP): an honest,
// if loose, bound.

export const REELS = 5;
export const ROWS = 3;
export const LINES = 20;

export const SYMBOLS = ['diamond', 'ruby', 'emerald', 'sapphire', 'triangle', 'square', 'circle', 'wild', 'scatter'] as const;
export type SymbolName = (typeof SYMBOLS)[number];
export const SYMBOL_LABEL = ['Diamond', 'Ruby', 'Emerald', 'Sapphire', 'Triangle', 'Square', 'Circle', 'Wild', 'Scatter'];
/** Paying symbols are 0..PAYING-1, best first. */
export const PAYING = 7;
export const WILD = 7;
export const SCATTER = 8;
export const NSYM = 9;

/** Free spins awarded for 3, 4 and 5 scatters. */
export const FREE_SPINS: Record<number, number> = { 3: 10, 4: 15, 5: 20 };
export const awardFor = (k: number) => (k >= 3 ? FREE_SPINS[Math.min(5, k)] : 0);
export const FS_MULT = 2;
/** At most this many free spins per feature (retriggers stop adding beyond it). */
export const FS_CAP = 50;
/** Spins granted by the feature buy. */
export const BUY_SPINS = 10;

/** The 20 fixed paylines: the row (0 top, 2 bottom) on each reel. */
export const PAYLINES: number[][] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 1, 2, 1],
  [1, 2, 1, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1],
  [1, 1, 2, 1, 1],
  [0, 0, 2, 0, 0],
  [2, 2, 0, 2, 2],
  [0, 2, 0, 2, 0],
];

export type Vol = 'low' | 'medium' | 'high';
export const VOLS: Vol[] = ['low', 'medium', 'high'];
export const VOL_LABEL: Record<Vol, string> = { low: 'Low', medium: 'Medium', high: 'High' };

interface SetSpec {
  /** pays[s] = [3-kind, 4-kind, 5-kind] in line bets, for the paying symbols. */
  pays: number[][];
  /** counts[reel][symbol]: how often each symbol sits on each strip. */
  counts: number[][];
  /** Symbols laid out in stacks of this height (default 1). */
  stacks: Partial<Record<number, number>>;
}

// Symbol order:       D  R  E  Sa T  Sq C  W  Sc
export const SPECS: Record<Vol, SetSpec> = {
  // Low: single symbols and five wilds per middle reel. Frequent small wins.
  low: {
    pays: [
      [25, 75, 250],
      [17, 50, 150],
      [12, 30, 100],
      [10, 25, 75],
      [8, 15, 40],
      [7, 12, 30],
      [4, 10, 25],
    ],
    counts: [
      [2, 3, 4, 4, 6, 7, 9, 0, 1],
      [2, 3, 4, 4, 5, 6, 7, 5, 1],
      [2, 3, 4, 4, 5, 6, 7, 5, 1],
      [2, 3, 4, 4, 5, 6, 7, 5, 1],
      [2, 3, 4, 4, 6, 7, 9, 0, 1],
    ],
    stacks: {},
  },
  // Medium: every symbol in stacks of two.
  medium: {
    pays: [
      [60, 250, 1000],
      [40, 120, 500],
      [26, 75, 300],
      [20, 50, 200],
      [12, 30, 100],
      [11, 25, 75],
      [5, 15, 50],
    ],
    counts: [
      [2, 3, 3, 4, 6, 7, 10, 0, 1],
      [2, 3, 3, 4, 6, 7, 8, 2, 1],
      [2, 3, 3, 4, 6, 7, 8, 2, 1],
      [2, 3, 3, 4, 6, 7, 8, 2, 1],
      [2, 3, 3, 4, 6, 7, 10, 0, 1],
    ],
    stacks: { 0: 2, 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, [WILD]: 2 },
  },
  // High: full stacks of three, so whole reels line up and many lines pay at once.
  high: {
    pays: [
      [50, 250, 2000],
      [25, 100, 500],
      [20, 60, 250],
      [12, 40, 150],
      [6, 20, 60],
      [5, 15, 50],
      [5, 12, 40],
    ],
    counts: [
      [3, 3, 3, 6, 6, 9, 9, 0, 1],
      [3, 3, 6, 6, 6, 6, 3, 3, 1],
      [3, 3, 6, 6, 6, 6, 3, 3, 1],
      [3, 3, 3, 6, 6, 6, 6, 3, 1],
      [3, 3, 3, 6, 6, 9, 9, 0, 1],
    ],
    stacks: { 0: 3, 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, [WILD]: 3 },
  },
};

export interface ReelSet {
  vol: Vol;
  pays: number[][];
  counts: number[][];
  strips: number[][];
  /** EV of one line in line bets (= EV of a base spin in stakes, for any line count). */
  lineEv: number;
  /** Chance a given line wins. */
  lineHit: number;
  /** P(K = k scatters), k = 0..5. */
  scatterP: number[];
  /** Chance a spin awards free spins. */
  trigger: number;
  /** Expected new spins per spin, E[F(K)]. */
  mu: number;
  /** Expected free spins played from an initial award of 10 / 15 / 20 (capped, exact DP). */
  expSpins: Record<number, number>;
  /** Exact RTP of a paid spin. */
  rtp: number;
  /** Feature-buy price in stakes, and its exact RTP. */
  buyPrice: number;
  buyRtp: number;
  /** Top line pay (line bets) = top spin pay (stakes). */
  maxLine: number;
  /** Honest bound on a paid spin's round and a bought feature (multiples of the amount paid). */
  maxSpinRound: number;
  maxBuyRound: number;
}

/**
 * Lays a strip out from symbol counts: scatters evenly spaced (at least 3
 * apart, so a window never shows two), the rest interleaved in stacks.
 */
export function buildStrip(counts: number[], stacks: Partial<Record<number, number>>, reel: number): number[] {
  const len = counts.reduce((a, b) => a + b, 0);
  const strip = new Array<number>(len).fill(-1);
  const nS = counts[SCATTER];
  for (let k = 0; k < nS; k++) strip[(Math.floor(((k + 0.5) * len) / nS) + reel * 3) % len] = SCATTER;
  const blocks: { sym: number; size: number; key: number }[] = [];
  for (let s = 0; s < SCATTER; s++) {
    const c = counts[s];
    if (!c) continue;
    const st = stacks[s] ?? 1;
    const nb = Math.ceil(c / st);
    const phase = (((s + 1) * 0.6180339887 + reel * 0.2718281828) % 1) * 0.999;
    for (let j = 0; j < nb; j++) blocks.push({ sym: s, size: Math.min(st, c - j * st), key: (j + phase) / nb });
  }
  blocks.sort((a, b) => a.key - b.key || a.sym - b.sym);
  let i = 0;
  for (const b of blocks)
    for (let t = 0; t < b.size; t++) {
      while (strip[i] !== -1) i++;
      strip[i] = b.sym;
    }
  return strip;
}

/** Leftmost-run line pay for the five symbols on a line: { sym, count, pay } (pay in line bets). */
export function linePay(syms: number[], pays: number[][]): { sym: number; count: number; pay: number } {
  const x = syms[0];
  if (x >= PAYING) return { sym: x, count: 0, pay: 0 };
  let k = 1;
  while (k < REELS && (syms[k] === x || syms[k] === WILD)) k++;
  return { sym: x, count: k, pay: k >= 3 ? pays[x][k - 3] : 0 };
}

/** Expected free spins played from (awarded a, left r), capped at FS_CAP; exact DP. */
function expectedSpinsTable(scatterP: number[]): (m: number) => number {
  const memo = new Map<number, number>();
  const E = (a: number, r: number): number => {
    if (r === 0) return 0;
    const key = a * 1000 + r;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let v = 1;
    for (let k = 0; k <= REELS; k++) {
      if (!scatterP[k]) continue;
      const a2 = Math.min(FS_CAP, a + awardFor(k));
      v += scatterP[k] * E(a2, r - 1 + (a2 - a));
    }
    memo.set(key, v);
    return v;
  };
  // Fill bottom-up in r so recursion depth stays small.
  for (let r = 1; r <= FS_CAP; r++) for (let a = r; a <= FS_CAP; a++) E(a, r);
  return (m: number) => E(Math.min(FS_CAP, m), Math.min(FS_CAP, m));
}

export function computeSet(vol: Vol): ReelSet {
  const { pays, counts, stacks } = SPECS[vol];
  const strips = counts.map((c, r) => buildStrip(c, stacks, r));
  const p = counts.map((c) => {
    const len = c.reduce((a, b) => a + b, 0);
    return c.map((x) => x / len);
  });
  let lineEv = 0;
  let lineHit = 0;
  for (let x = 0; x < PAYING; x++) {
    const a = (j: number) => p[j][x] + p[j][WILD];
    const ge3 = a(1) * a(2);
    const ge4 = ge3 * a(3);
    const ge5 = ge4 * a(4);
    lineEv += p[0][x] * ((ge3 - ge4) * pays[x][0] + (ge4 - ge5) * pays[x][1] + ge5 * pays[x][2]);
    lineHit += p[0][x] * ge3;
  }
  // Scatter count: convolution of independent Bernoulli(q_i).
  let scatterP = [1];
  for (let i = 0; i < REELS; i++) {
    const len = counts[i].reduce((a, b) => a + b, 0);
    const q = (ROWS * counts[i][SCATTER]) / len;
    const next = new Array(scatterP.length + 1).fill(0);
    scatterP.forEach((v, k) => {
      next[k] += v * (1 - q);
      next[k + 1] += v * q;
    });
    scatterP = next;
  }
  const trigger = scatterP[3] + scatterP[4] + scatterP[5];
  const mu = scatterP.reduce((s, v, k) => s + v * awardFor(k), 0);
  const spins = expectedSpinsTable(scatterP);
  const expSpins: Record<number, number> = { 10: spins(10), 15: spins(15), 20: spins(20) };
  const rtp = lineEv + [3, 4, 5].reduce((s, k) => s + scatterP[k] * FS_MULT * lineEv * expSpins[awardFor(k)], 0);
  const featureEv = FS_MULT * lineEv * spins(BUY_SPINS);
  // The buy is priced in tenths of a stake, at or just under the spin's own RTP.
  const buyPrice = Math.ceil((featureEv / rtp) * 10 - 1e-9) / 10;
  const maxLine = Math.max(...pays.map((r) => r[2]));
  return {
    vol,
    pays,
    counts,
    strips,
    lineEv,
    lineHit,
    scatterP,
    trigger,
    mu,
    expSpins,
    rtp,
    buyPrice,
    buyRtp: featureEv / buyPrice,
    maxLine,
    maxSpinRound: maxLine * (1 + FS_MULT * FS_CAP),
    maxBuyRound: (maxLine * FS_MULT * FS_CAP) / buyPrice,
  };
}

const cache = new Map<Vol, ReelSet>();
export function reelSet(vol: Vol): ReelSet {
  let s = cache.get(vol);
  if (!s) cache.set(vol, (s = computeSet(vol)));
  return s;
}

/** The medium set's spin RTP: the game's headline figure. */
export const RTP = reelSet('medium').rtp;
export const MAX_MULTIPLIER = Math.max(...VOLS.map((v) => Math.max(reelSet(v).maxSpinRound, reelSet(v).maxBuyRound)));

/** The 3 visible symbols per reel for the given stops: grid[reel][row]. */
export function windowAt(set: ReelSet, stops: number[]): number[][] {
  return set.strips.map((strip, r) => [0, 1, 2].map((row) => strip[(stops[r] + row) % strip.length]));
}

export interface LineWin {
  line: number;
  sym: number;
  count: number;
  /** In line bets, before the free-spin multiplier. */
  pay: number;
}

export interface Spin {
  stops: number[];
  grid: number[][];
  wins: LineWin[];
  /** Cells showing a scatter, as [reel, row]. */
  scatterCells: [number, number][];
  /** Free spins this spin awards (0 if none, after the cap). */
  awarded: number;
  free: boolean;
  /** Win multiplier on this spin (2 in free spins). */
  mult: number;
  /** This spin's win in stakes. */
  win: number;
  /** Free spins left after this one (free spins only). */
  left: number;
  /** Free-spin number (1-based), 0 for the base spin. */
  n: number;
}

export function evaluate(set: ReelSet, grid: number[][], lines: number): { wins: LineWin[]; linePays: number; scatterCells: [number, number][] } {
  const wins: LineWin[] = [];
  let linePays = 0;
  for (let l = 0; l < lines; l++) {
    const path = PAYLINES[l];
    const r = linePay(path.map((row, reel) => grid[reel][row]), set.pays);
    if (r.pay > 0) {
      wins.push({ line: l, sym: r.sym, count: r.count, pay: r.pay });
      linePays += r.pay;
    }
  }
  const scatterCells: [number, number][] = [];
  grid.forEach((col, reel) => col.forEach((s, row) => s === SCATTER && scatterCells.push([reel, row])));
  return { wins, linePays, scatterCells };
}

function spinOnce(set: ReelSet, lines: number, next: () => number, free: boolean, n: number): Omit<Spin, 'awarded' | 'left'> & { scatters: number } {
  const stops = set.strips.map((s) => Math.floor(next() * s.length));
  const grid = windowAt(set, stops);
  const { wins, linePays, scatterCells } = evaluate(set, grid, lines);
  const mult = free ? FS_MULT : 1;
  return { stops, grid, wins, scatterCells, scatters: scatterCells.length, free, mult, win: (linePays / lines) * mult, n };
}

export interface Round {
  spins: Spin[];
  /** Total win in stakes. */
  total: number;
  /** Payout multiplier on the amount paid (stake, or buyPrice × stake for a buy). */
  multiplier: number;
  /** Free spins played. */
  freeSpins: number;
  bought: boolean;
}

/**
 * Plays one whole round: a paid spin (or a bought feature) plus every free
 * spin it leads to. Everything is drawn up front, so the UI only animates it.
 */
export function playRound(set: ReelSet, lines: number, next: () => number, buy = false): Round {
  const spins: Spin[] = [];
  let awarded = 0;
  if (buy) awarded = BUY_SPINS;
  else {
    const s = spinOnce(set, lines, next, false, 0);
    awarded = awardFor(s.scatters);
    spins.push({ ...s, awarded, left: awarded });
  }
  let played = 0;
  while (played < awarded) {
    played++;
    const s = spinOnce(set, lines, next, true, played);
    const add = Math.min(FS_CAP - awarded, awardFor(s.scatters));
    awarded += add;
    spins.push({ ...s, awarded: add, left: awarded - played });
  }
  const total = spins.reduce((a, s) => a + s.win, 0);
  return { spins, total, multiplier: buy ? total / set.buyPrice : total, freeSpins: played, bought: buy };
}

/** Win-size tier for the banner, by the round's payout multiplier on the amount paid. */
export function winTier(total: number): 'big' | 'mega' | 'epic' | null {
  if (total >= 100) return 'epic';
  if (total >= 25) return 'mega';
  if (total >= 10) return 'big';
  return null;
}
