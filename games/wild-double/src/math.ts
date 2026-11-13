// Wild Double: a 5×3 video slot with 20 fixed paylines and a paying wild that
// doubles the line wins it completes. Scatters pay anywhere and 3+ of them
// award 15 free spins at ×3 that retrigger, up to 180.
//
// Rules
//   - Reel lengths 30, 30, 30, 30, 41. A spin stops every reel at a uniform
//     position and shows three consecutive symbols.
//   - 13 symbols: 11 paying symbols (2 high, 3 mid, 6 low), a wild and a
//     scatter. The wild lands on any reel and substitutes for every paying
//     symbol, never for the scatter.
//   - A line pays its leftmost run from reel 1. Its symbol X is the first
//     non-wild symbol on the line; the run is the longest prefix of X or wild.
//     A run of 3+ pays pay[X][run]; the two highs also pay on 2. A run that
//     contains a wild pays double. The wild also pays as a symbol of its own
//     from 2 in a row (a leading all-wild prefix). The line pays the larger of
//     the two, never both. Line pays are in line bets = stake ÷ lines.
//   - Scatters pay anywhere, 2 / 3 / 4 / 5 = 2 / 6 / 50 / 500 × the stake.
//   - 3+ scatters award 15 free spins on the same strips and lines. Every win
//     (lines and scatters) is ×3, so a wild-doubled line pays ×6. 3+ scatters
//     in a free spin add 15 more, up to FS_CAP = 180 spins per feature.
//   - Feature buy: 37 × the stake starts 15 free spins.
//   - A round pays at most 10,000 × the amount paid; the round ends the
//     moment it reaches it.
//
// Exact RTP (no simulation anywhere in the pricing)
//   1. Line EV. Reels are independent and every row of a reel shows symbol s
//      with the strip frequency p_i(s) = c_i(s)/len_i, so all 20 lines share
//      one law. L = E[line pay] is a finite sum over the run structure
//      (lineStats) and is checked against all 13^5 symbol tuples in the tests.
//      A spin on n lines is worth (1/n) Σ line pays = L in expectation for any
//      n: the lines knob changes the spread, never the return.
//   2. Scatters. They sit at least 3 apart on each strip, so a window shows
//      at most one and reel i shows one with q_i = 3 c_i(S) / len_i exactly.
//      The count K is the convolution of the Bernoulli(q_i); S = Σ P(K=k) pay(k).
//   3. Free spins. A spin is worth B = L + S, a free spin 3B. An award of 15
//      plays E15 spins on average (exact DP over (awarded, left) with the
//      cap), so the feature is worth F = 3 B E15 and
//        RTP = B + P(K ≥ 3) F,        buy RTP = F / 37.
//
// Max win. The round total is clipped at 10,000 × the amount paid. The RTPs
// above are computed without the clip, so the true RTP is lower by
// E[(T − cap)+] (see the max-win note below).

export const REELS = 5;
export const ROWS = 3;
export const LINES = 20;

export const SYMBOLS = ['bolt', 'heart', 'crescent', 'ring', 'star', 'plus', 'hexagon', 'circle', 'square', 'triangle', 'diamond', 'wild', 'scatter'] as const;
export const SYMBOL_LABEL = ['Bolt', 'Heart', 'Crescent', 'Ring', 'Star', 'Plus', 'Hexagon', 'Circle', 'Square', 'Triangle', 'Diamond', 'Wild', 'Scatter'];
/** Paying symbols are 0..PAYING-1, best first: 2 high, 3 mid, 6 low. */
export const PAYING = 11;
export const WILD = 11;
export const SCATTER = 12;
export const NSYM = 13;

/** pays[s] = [2-kind, 3-kind, 4-kind, 5-kind] in line bets (0 = does not pay). */
export const PAYS: number[][] = [
  [2, 25, 100, 750], // bolt (high)
  [2, 25, 100, 750], // heart (high)
  [0, 15, 100, 400], // crescent (mid)
  [0, 10, 75, 250], // ring (mid)
  [0, 10, 75, 250], // star (mid)
  [0, 10, 50, 250], // plus (low)
  [0, 5, 50, 100], // hexagon (low)
  [0, 5, 25, 100], // circle (low)
  [0, 5, 25, 100], // square (low)
  [0, 5, 25, 100], // triangle (low)
  [0, 5, 25, 100], // diamond (low)
];
/** The wild's own pay by length of the leading all-wild run, in line bets. */
export const WILD_PAY = [0, 0, 10, 200, 2000, 10000];
/** Scatter pay by count, × the stake. */
export const SCATTER_PAY = [0, 0, 2, 6, 50, 500];
/** A run containing a wild pays ×2. */
export const WILD_MULT = 2;

export const FS_AWARD = 15;
export const awardFor = (k: number) => (k >= 3 ? FS_AWARD : 0);
export const FS_MULT = 3;
/** At most this many free spins per feature (retriggers stop adding beyond it). */
export const FS_CAP = 180;
export const BUY_PRICE = 37;
export const BUY_SPINS = FS_AWARD;
/** A round pays at most this × the amount paid. */
export const MAX_MULTIPLIER = 10_000;

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

// COUNTS[reel][symbol]: how often each symbol sits on each strip.
// Lengths 30, 30, 30, 30, 41. One scatter per strip; the wilds and scatters
// are spaced at least 3 apart so a window shows at most one of each.
// Symbol order: bo he cr ri st pl hx ci sq tr di  W  Sc
// Found by integer search so the exact RTP lands on 0.97836 (just under the
// classic's published 97.84%); the figures are recomputed from these counts.
export const COUNTS: number[][] = [
  [1, 2, 3, 3, 3, 2, 2, 5, 2, 2, 3, 1, 1],
  [2, 2, 2, 2, 3, 2, 2, 2, 3, 2, 6, 1, 1],
  [2, 2, 2, 3, 1, 5, 2, 4, 3, 2, 2, 1, 1],
  [2, 1, 1, 2, 2, 2, 2, 4, 4, 6, 2, 1, 1],
  [2, 1, 3, 3, 3, 6, 3, 4, 2, 5, 6, 2, 1],
];

export interface ReelSet {
  pays: number[][];
  counts: number[][];
  strips: number[][];
  /** EV of one line in line bets, chance a line pays, and E[pay²] (line bets²). */
  lineEv: number;
  lineHit: number;
  lineEv2: number;
  /** P(K = k scatters), k = 0..5, and the EV of the scatter pays in stakes. */
  scatterP: number[];
  scatterEv: number;
  /** EV of one spin in stakes, B = L + S, for any line count. */
  baseEv: number;
  /** Chance a spin awards free spins. */
  trigger: number;
  /** Expected new spins per spin, E[F(K)]. */
  mu: number;
  /** Expected free spins played from an award of 15 (capped, exact DP). */
  expSpins: number;
  /** Value of the feature in stakes, F = 3 B E15. */
  featureEv: number;
  /** Exact RTP of a paid spin and of the feature buy (before the max-win clip). */
  rtp: number;
  buyRtp: number;
}

/**
 * Lays a strip out from symbol counts: scatters evenly spaced, wilds evenly
 * spaced and clear of each other's neighbours, the rest interleaved by a
 * golden-ratio phase so equal symbols spread out.
 */
export function buildStrip(counts: number[], reel: number): number[] {
  const len = counts.reduce((a, b) => a + b, 0);
  const strip = new Array<number>(len).fill(-1);
  const place = (sym: number, n: number, shift: number) => {
    for (let k = 0; k < n; k++) {
      let pos = (Math.floor(((k + 0.5) * len) / n) + shift) % len;
      while (strip[pos] !== -1) pos = (pos + 1) % len;
      strip[pos] = sym;
    }
  };
  place(SCATTER, counts[SCATTER], reel * 3);
  place(WILD, counts[WILD], reel * 7 + 1);
  const rest: { sym: number; key: number }[] = [];
  for (let s = 0; s < WILD; s++) {
    const c = counts[s];
    const phase = (((s + 1) * 0.6180339887 + reel * 0.2718281828) % 1) * 0.999;
    for (let j = 0; j < c; j++) rest.push({ sym: s, key: (j + phase) / c });
  }
  rest.sort((a, b) => a.key - b.key || a.sym - b.sym);
  let i = 0;
  for (const b of rest) {
    while (strip[i] !== -1) i++;
    strip[i] = b.sym;
  }
  return strip;
}

/** Pay of a finished line from its structure: leading wilds w, symbol X, run length k, wild inside the run. */
function finalPay(w: number, X: number, k: number, hasWild: boolean): number {
  const wildOnly = WILD_PAY[w];
  if (X < 0 || X >= PAYING || k < 2) return wildOnly;
  const sym = PAYS[X][k - 2] * (hasWild ? WILD_MULT : 1);
  return sym >= wildOnly ? sym : wildOnly;
}

/**
 * Line pay for the five symbols on a line: the symbol shown (the wild when its
 * own pay wins), how many reels pay, the pay in line bets (doubling included)
 * and whether the doubling applied.
 */
export function linePay(syms: number[]): { sym: number; count: number; pay: number; doubled: boolean } {
  let w = 0;
  while (w < REELS && syms[w] === WILD) w++;
  if (w === REELS) return { sym: WILD, count: w, pay: WILD_PAY[w], doubled: false };
  const X = syms[w];
  const wildOnly = WILD_PAY[w];
  if (X >= PAYING) return { sym: WILD, count: w, pay: wildOnly, doubled: false };
  let k = w + 1;
  let hasWild = w > 0;
  while (k < REELS && (syms[k] === X || syms[k] === WILD)) {
    if (syms[k] === WILD) hasWild = true;
    k++;
  }
  const sym = k >= 2 ? PAYS[X][k - 2] * (hasWild ? WILD_MULT : 1) : 0;
  if (sym >= wildOnly && sym > 0) return { sym: X, count: k, pay: sym, doubled: hasWild };
  return { sym: WILD, count: w, pay: wildOnly, doubled: false };
}

/** The line's law from per-reel symbol frequencies p[reel][symbol]: E[pay], P(pay > 0), E[pay²]. */
export function lineStats(p: number[][]): { ev: number; hit: number; ev2: number } {
  let ev = 0;
  let hit = 0;
  let ev2 = 0;
  const finish = (prob: number, w: number, X: number, k: number, hasWild: boolean) => {
    const pay = finalPay(w, X, k, hasWild);
    ev += prob * pay;
    ev2 += prob * pay * pay;
    if (pay > 0) hit += prob;
  };
  // X < 0: only wilds so far (w of them). Otherwise the run of X has length k.
  const rec = (j: number, prob: number, w: number, X: number, k: number, hasWild: boolean) => {
    if (j === REELS) return finish(prob, w, X, k, hasWild);
    if (X < 0) {
      for (let s = 0; s < NSYM; s++) {
        const pr = p[j][s];
        if (!pr) continue;
        if (s === WILD) rec(j + 1, prob * pr, w + 1, -1, k + 1, true);
        else if (s === SCATTER) finish(prob * pr, w, SCATTER, 0, false);
        else rec(j + 1, prob * pr, w, s, w + 1, w > 0);
      }
    } else {
      const pm = p[j][X] + p[j][WILD];
      if (p[j][X]) rec(j + 1, prob * p[j][X], w, X, k + 1, hasWild);
      if (p[j][WILD]) rec(j + 1, prob * p[j][WILD], w, X, k + 1, true);
      finish(prob * (1 - pm), w, X, k, hasWild);
    }
  };
  rec(0, 1, 0, -1, 0, false);
  return { ev, hit, ev2 };
}

/** Expected free spins played from an award of m (capped at FS_CAP); exact DP over (awarded, left). */
function expectedSpins(scatterP: number[], m: number): number {
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
  return E(Math.min(FS_CAP, m), Math.min(FS_CAP, m));
}

export function computeSet(counts: number[][] = COUNTS): ReelSet {
  const strips = counts.map((c, r) => buildStrip(c, r));
  const p = counts.map((c) => {
    const len = c.reduce((a, b) => a + b, 0);
    return c.map((x) => x / len);
  });
  const { ev: lineEv, hit: lineHit, ev2: lineEv2 } = lineStats(p);
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
  const scatterEv = scatterP.reduce((s, v, k) => s + v * SCATTER_PAY[k], 0);
  const baseEv = lineEv + scatterEv;
  const trigger = scatterP[3] + scatterP[4] + scatterP[5];
  const mu = scatterP.reduce((s, v, k) => s + v * awardFor(k), 0);
  const expSpins = expectedSpins(scatterP, FS_AWARD);
  const featureEv = FS_MULT * baseEv * expSpins;
  return {
    pays: PAYS,
    counts,
    strips,
    lineEv,
    lineHit,
    lineEv2,
    scatterP,
    scatterEv,
    baseEv,
    trigger,
    mu,
    expSpins,
    featureEv,
    rtp: baseEv + trigger * featureEv,
    buyRtp: featureEv / BUY_PRICE,
  };
}

let cached: ReelSet | null = null;
export function reelSet(): ReelSet {
  return (cached ??= computeSet());
}

/** The game's headline figures (exact, before the max-win clip, which only lowers them). */
export const RTP = reelSet().rtp;

/** The 3 visible symbols per reel for the given stops: grid[reel][row]. */
export function windowAt(set: ReelSet, stops: number[]): number[][] {
  return set.strips.map((strip, r) => [0, 1, 2].map((row) => strip[(stops[r] + row) % strip.length]));
}

export interface LineWin {
  line: number;
  /** The symbol shown (the wild when its own pay won) and how many reels pay. */
  sym: number;
  count: number;
  /** In line bets, doubling included, before the free-spin multiplier. */
  pay: number;
  /** The wild doubled this win. */
  doubled: boolean;
}

export interface Spin {
  stops: number[];
  grid: number[][];
  wins: LineWin[];
  /** Cells showing a scatter, as [reel, row]. */
  scatterCells: [number, number][];
  /** Scatter pay in stakes, before the free-spin multiplier. */
  scatterWin: number;
  /** Free spins this spin awards (0 if none, after the cap). */
  awarded: number;
  free: boolean;
  /** Win multiplier on this spin (3 in free spins). */
  mult: number;
  /** This spin's win in stakes (clipped if the round hit the max win). */
  win: number;
  /** Free spins left after this one. */
  left: number;
  /** Free-spin number (1-based), 0 for the base spin. */
  n: number;
}

export function evaluate(grid: number[][], lines: number): { wins: LineWin[]; linePays: number; scatterCells: [number, number][] } {
  const wins: LineWin[] = [];
  let linePays = 0;
  for (let l = 0; l < lines; l++) {
    const path = PAYLINES[l];
    const r = linePay(path.map((row, reel) => grid[reel][row]));
    if (r.pay > 0) {
      wins.push({ line: l, sym: r.sym, count: r.count, pay: r.pay, doubled: r.doubled });
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
  const { wins, linePays, scatterCells } = evaluate(grid, lines);
  const mult = free ? FS_MULT : 1;
  const scatterWin = SCATTER_PAY[scatterCells.length];
  return { stops, grid, wins, scatterCells, scatterWin, scatters: scatterCells.length, free, mult, win: (linePays / lines + scatterWin) * mult, n };
}

export interface Round {
  spins: Spin[];
  /** Total win in stakes, clipped at the max win. */
  total: number;
  /** Payout multiplier on the amount paid (stake, or BUY_PRICE × stake for a buy). */
  multiplier: number;
  /** Free spins played. */
  freeSpins: number;
  bought: boolean;
  /** The round reached the max win and ended there. */
  capped: boolean;
}

/**
 * Plays one whole round: a paid spin (or a bought feature) plus every free
 * spin it leads to. Everything is drawn up front, so the UI only animates it.
 * The round stops the moment its total reaches 10,000 × the amount paid.
 */
export function playRound(set: ReelSet, lines: number, next: () => number, buy = false): Round {
  const spins: Spin[] = [];
  const paid = buy ? BUY_PRICE : 1;
  const cap = MAX_MULTIPLIER * paid;
  let total = 0;
  let capped = false;
  let awarded = 0;
  const book = (s: Spin) => {
    if (total + s.win >= cap) {
      s.win = cap - total;
      capped = true;
    }
    total += s.win;
    spins.push(s);
  };
  if (buy) awarded = BUY_SPINS;
  else {
    const s = spinOnce(set, lines, next, false, 0);
    awarded = awardFor(s.scatters);
    book({ ...s, awarded, left: awarded });
  }
  let played = 0;
  while (!capped && played < awarded) {
    played++;
    const s = spinOnce(set, lines, next, true, played);
    const add = Math.min(FS_CAP - awarded, awardFor(s.scatters));
    awarded += add;
    book({ ...s, awarded: add, left: awarded - played });
  }
  if (capped) spins[spins.length - 1].left = 0;
  return { spins, total, multiplier: total / paid, freeSpins: played, bought: buy, capped };
}

// ---------------------------------------------------------------------------
// The odds of one spin, before it and as each reel stops (left to right).
//
// "A spin pays" means a line pays or 2+ scatters show. Which lines pay is
// settled by the first three reels alone: once the run reaches 3 (or two
// wilds lead, or a high pays on 2) the line certainly pays, and a line that
// has not paid by then cannot pay later, because any run of 3+ pays. So the
// reels still to come only matter through their scatters. The windows of
// reels 1–3 still to stop are enumerated exactly (at most 30³ combinations),
// and the scatter count of reels 4–5 is a convolution of two Bernoullis. The
// tests check the all-stopped case against evaluate() and the tower property
// E[odds after the next reel] = odds now.
// ---------------------------------------------------------------------------

/** Exact chances for one spin. */
export interface SpinOdds {
  /** Pays anything: a line win or 2+ scatters. */
  pays: number;
  /** Starts (or, in free spins, adds) free spins: 3+ scatters. */
  free: number;
}

interface WindowP {
  win: number[];
  p: number;
  scatter: boolean;
}

const windowCache = new WeakMap<ReelSet, WindowP[][]>();
/** Each reel's distinct 3-symbol windows with their exact probabilities. */
export function reelWindows(set: ReelSet): WindowP[][] {
  let w = windowCache.get(set);
  if (!w) {
    w = set.strips.map((strip) => {
      const m = new Map<string, WindowP>();
      for (let stop = 0; stop < strip.length; stop++) {
        const win = [0, 1, 2].map((k) => strip[(stop + k) % strip.length]);
        const key = win.join(',');
        const e = m.get(key);
        if (e) e.p += 1 / strip.length;
        else m.set(key, { win, p: 1 / strip.length, scatter: win.includes(SCATTER) });
      }
      return [...m.values()];
    });
    windowCache.set(set, w);
  }
  return w;
}

/** True when the first three symbols of a line already guarantee it pays. */
function paysByThree(a: number, b: number, c: number): boolean {
  if (a === WILD && b === WILD) return true;
  const X = a !== WILD ? a : b !== WILD ? b : c;
  if (X === WILD) return true; // three wilds
  if (X >= PAYING) return false; // a scatter breaks the line
  const ok = (s: number) => s === X || s === WILD;
  if (ok(a) && ok(b) && ok(c)) return true;
  return ok(a) && ok(b) && PAYS[X][0] > 0;
}

const oddsCache = new WeakMap<ReelSet, Map<number, SpinOdds>>();

/** Exact odds of a spin on `lines` lines, given the windows of the reels already stopped (`stopped[r]` for r < stopped.length). */
export function spinOdds(set: ReelSet, lines: number, stopped: number[][] = []): SpinOdds {
  const idle = stopped.length === 0;
  let cache = oddsCache.get(set);
  if (!cache) oddsCache.set(set, (cache = new Map()));
  if (idle) {
    const hit = cache.get(lines);
    if (hit) return hit;
  }
  const all = reelWindows(set);
  const wins: WindowP[][] = all.map((ws, r) => (r < stopped.length ? [{ win: stopped[r], p: 1, scatter: stopped[r].includes(SCATTER) }] : ws));
  // tail[s]: chance reels 4–5 show s scatters between them.
  let tail = [1];
  for (let r = 3; r < REELS; r++) {
    const q = wins[r].reduce((a, w) => a + (w.scatter ? w.p : 0), 0);
    const next = new Array(tail.length + 1).fill(0);
    tail.forEach((v, k) => {
      next[k] += v * (1 - q);
      next[k + 1] += v * q;
    });
    tail = next;
  }
  const atLeast = (n: number) => tail.reduce((a, v, k) => a + (k >= n ? v : 0), 0);
  const tail2 = [0, 1, 2, 3].map((s) => atLeast(2 - s));
  const tail3 = [0, 1, 2, 3].map((s) => atLeast(3 - s));
  const rows = PAYLINES.slice(0, lines);
  let pays = 0;
  let free = 0;
  for (const a of wins[0])
    for (const b of wins[1])
      for (const c of wins[2]) {
        const p = a.p * b.p * c.p;
        const s3 = (a.scatter ? 1 : 0) + (b.scatter ? 1 : 0) + (c.scatter ? 1 : 0);
        free += p * tail3[s3];
        let line = false;
        for (let l = 0; l < lines && !line; l++) line = paysByThree(a.win[rows[l][0]], b.win[rows[l][1]], c.win[rows[l][2]]);
        pays += p * (line ? 1 : tail2[s3]);
      }
  const out: SpinOdds = { pays, free };
  if (idle) cache.set(lines, out);
  return out;
}

// ---------------------------------------------------------------------------
// The max-win clip.
//
// The round stops when its total reaches 10,000 × the amount paid. The RTPs
// above are computed without the clip, so they are exact up to
// E[(T − cap)+] ≥ 0: the clip can only lower the true RTP (it errs the house's
// way). One spin on 20 lines pays at most maxSpinWin(20) = 2,425 stakes, so
// the clip needs at least two free-spin jackpots in one round; on fewer
// lines a single free spin can reach it (five wilds on one line pay 10,000
// line bets = 10,000 stakes, ×3 in a free spin). The tests simulate it.
// ---------------------------------------------------------------------------

/** Largest win of one spin on `lines` lines, in stakes: a rigorous bound over every wild placement. */
const maxWinCache = new Map<number, number>();
export function maxSpinWin(lines: number): number {
  const hit = maxWinCache.get(lines);
  if (hit !== undefined) return hit;
  const symMax = Math.max(...PAYS.map((r) => r[3])) * WILD_MULT;
  let best = 0;
  // Per reel: no wild, or one wild at row 0 / 1 / 2 (a window shows at most one wild).
  for (let code = 0; code < 4 ** REELS; code++) {
    const wildRow = Array.from({ length: REELS }, (_, r) => ((code >> (2 * r)) & 3) - 1);
    let sum = 0;
    for (let l = 0; l < lines; l++) {
      let w = 0;
      while (w < REELS && wildRow[w] === PAYLINES[l][w]) w++;
      sum += Math.max(WILD_PAY[w], symMax);
    }
    best = Math.max(best, sum / lines);
  }
  maxWinCache.set(lines, best + SCATTER_PAY[5]);
  return best + SCATTER_PAY[5];
}

/** Win-size tier for the banner, by the round's payout multiplier on the amount paid. */
export function winTier(total: number): 'big' | 'mega' | 'epic' | null {
  if (total >= 100) return 'epic';
  if (total >= 25) return 'mega';
  if (total >= 10) return 'big';
  return null;
}
