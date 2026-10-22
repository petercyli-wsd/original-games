// Loops: n numbered boxes sit on a ring and hide a uniformly random
// permutation σ (box b holds the number σ(b), drawn as an arrow b → σ(b)).
// The boxes are opened by the cycle-following rule of the 100 prisoners
// puzzle: start at the lowest box not yet seen, follow its arrow to the next
// box, and repeat until an arrow points back to the start. That closes a loop.
// You win if every loop has at most L boxes (the limit).
//
// The theorem (cycle structure of a uniform permutation). Follow a loop from
// its start among R boxes not yet in a closed loop. With j boxes of this loop
// already opened, the next box holds one of R − j equally likely numbers: the
// start box (the loop closes) or one of the boxes nobody has pointed at yet.
// So the loop closes on this box with chance 1/(R − j), its final length is
// uniform on {j + 1, …, R}, and once it closes at length k the R − k untouched
// boxes again hide a uniform permutation. With fit(r) = P(every loop ≤ L
// among r boxes),
//
//   fit(0) = 1,   fit(r) = (1/r) Σ_{k=1}^{min(L, r)} fit(r − k),
//
// and the live win chance mid-loop is
//
//   P(win | R, j) = (1/(R − j)) Σ_{k=j+1}^{min(L, R)} fit(R − k)   (0 once j ≥ L).
//
// For L ≥ n/2 at most one loop can be too long, so fit(n) = 1 − Σ_{k>L} 1/k,
// which tends to 1 − ln 2 ≈ 30.7% when L = n/2: the 100 prisoners puzzle.
//
// On screen the odds are the loop ruler: one equal slot per possible final
// length of the current loop (each equally likely), red past the limit, and
// green up to height fit(R − k) inside it. The green area over the lit slots
// is exactly P(win | R, j). On the ring, the lit candidate boxes are the
// R − j equally likely targets of the next arrow; only the home box closes.
//
// Pricing (fixed prize): a full win pays prize = RTP / fit(n), and the
// cash-out is prize × P(win | state). The conditional probability of a fixed
// event is a martingale, so the cash-out is one too, starting at RTP. By
// optional stopping every rule (box by box, loop by loop, thresholds, the
// Follow button's own stop before a loop's last chance) returns exactly RTP.
// Every cash-out is at most the prize, so the largest payout anywhere is the
// prize at the hardest setting: no cap is needed.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Board sizes. More boxes make a longer round; the odds depend mostly on the limit's share. */
export const BOX_COUNTS = [8, 12, 20, 30] as const;
export type BoxCount = (typeof BOX_COUNTS)[number];

/** The loop limit as a share of the boxes. ½ is the 100 prisoners rule. */
export const SHARES = ['1/4', '1/3', '1/2', '2/3', '3/4'] as const;
export type Share = (typeof SHARES)[number];

export const SHARE_GLYPH: Record<Share, string> = { '1/4': '¼', '1/3': '⅓', '1/2': '½', '2/3': '⅔', '3/4': '¾' };

/** The limit L for n boxes: the share of n, rounded half up. */
export function limitFor(n: number, share: Share): number {
  const [a, b] = share.split('/').map(Number);
  return Math.round((n * a) / b);
}

/** Eval presets, one per volatility level. */
export const VOLATILITY: Record<Volatility, { n: BoxCount; share: Share }> = {
  low: { n: 12, share: '3/4' },
  medium: { n: 20, share: '1/2' },
  high: { n: 20, share: '1/3' },
  extreme: { n: 30, share: '1/4' },
};

const tables = new Map<string, Float64Array>();

/** fit[r] = exact chance that r boxes hiding a uniform permutation form loops of at most `limit` boxes. */
export function fitTable(n: number, limit: number): Float64Array {
  const key = `${n}:${limit}`;
  let q = tables.get(key);
  if (!q) {
    q = new Float64Array(n + 1);
    q[0] = 1;
    for (let r = 1; r <= n; r++) {
      let s = 0;
      for (let k = 1; k <= Math.min(limit, r); k++) s += q[r - k];
      q[r] = s / r;
    }
    tables.set(key, q);
  }
  return q;
}

/** Chance a fresh board of n boxes wins. */
export const fitChance = (n: number, limit: number) => fitTable(n, limit)[n];

/** The full-win prize. */
export const prizeFor = (n: number, limit: number) => RTP / fitChance(n, limit);

export function volatilityOf(n: number, limit: number): Volatility {
  const p = fitChance(n, limit);
  return p >= 0.5 ? 'low' : p >= 0.2 ? 'medium' : p >= 0.04 ? 'high' : 'extreme';
}

/** Largest payout anywhere: the prize at the hardest setting (a cash-out never exceeds the prize). */
export const MAX_MULTIPLIER = Math.max(...BOX_COUNTS.flatMap((n) => SHARES.map((s) => prizeFor(n, limitFor(n, s)))));

/**
 * Live win chance with R boxes outside closed loops, j of them already opened
 * in the loop being followed (j = 0 between loops).
 */
export function winChanceAt(n: number, limit: number, R: number, j: number): number {
  if (j >= limit) return 0;
  const q = fitTable(n, limit);
  let s = 0;
  for (let k = j + 1; k <= Math.min(limit, R); k++) s += q[R - k];
  return s / (R - j);
}

export type Status = 'live' | 'bust' | 'won';

export interface Board {
  n: number;
  limit: number;
  /** inside[b] = the box b points at (0-based), or −1 while b is shut. */
  inside: number[];
  /** Closed loops, each listed from its start box in arrow order. */
  loops: number[][];
  /**
   * The loop being followed: its start (home) box, then every box found so
   * far. The last one is the next to open. Empty between loops.
   */
  chain: number[];
  /** bust: a loop outgrew the limit. won: the boxes left can't form a loop that long. */
  status: Status;
}

export function newBoard(n: number, limit: number): Board {
  return { n, limit, inside: new Array<number>(n).fill(-1), loops: [], chain: [], status: 'live' };
}

/** Boxes not in a closed loop (the current loop's included): R. */
export const remaining = (b: Board) => b.n - b.loops.reduce((s, l) => s + l.length, 0);

/** Boxes of the current loop already opened: j. */
export const openedInLoop = (b: Board) => Math.max(0, b.chain.length - 1);

/** Boxes nobody has pointed at yet, ascending (the current loop's boxes excluded). */
export function unseen(b: Board): number[] {
  const taken = new Uint8Array(b.n);
  for (const l of b.loops) for (const x of l) taken[x] = 1;
  for (const x of b.chain) taken[x] = 1;
  const out: number[] = [];
  for (let x = 0; x < b.n; x++) if (!taken[x]) out.push(x);
  return out;
}

/** The box opened next: the head of the loop, or the lowest box not seen yet. */
export function nextBox(b: Board): number {
  return b.chain.length ? b.chain[b.chain.length - 1] : unseen(b)[0];
}

/** The start ("home") of the loop being followed, or of the next one. */
export function homeBox(b: Board): number {
  return b.chain.length ? b.chain[0] : unseen(b)[0];
}

/**
 * The boxes the next arrow can point at, all equally likely. The first is the
 * loop's home box (it closes the loop); the rest extend it.
 */
export function candidates(b: Board): number[] {
  if (b.chain.length) return [b.chain[0], ...unseen(b)];
  return unseen(b);
}

/** Chance the next box closes the current loop: 1 / (R − j). */
export const closeChance = (b: Board) => 1 / (remaining(b) - openedInLoop(b));

/** Whether the next box is the loop's last chance: if it doesn't point home, the loop is too long. */
export const lastChance = (b: Board) => b.status === 'live' && openedInLoop(b) === b.limit - 1;

/** Chance the next single box busts the round. */
export const bustChanceNext = (b: Board) => (lastChance(b) ? 1 - closeChance(b) : 0);

/** Chance the current (or next) loop closes within the limit. */
export function loopFitChance(b: Board): number {
  const R = remaining(b);
  const j = openedInLoop(b);
  return Math.max(0, Math.min(b.limit, R) - j) / (R - j);
}

export function winChance(b: Board): number {
  if (b.status === 'won') return 1;
  if (b.status === 'bust') return 0;
  return winChanceAt(b.n, b.limit, remaining(b), openedInLoop(b));
}

/** The fair cash-out multiplier: prize × P(win | board). */
export const cashValue = (b: Board) => prizeFor(b.n, b.limit) * winChance(b);

/**
 * Opens the next box. `pick` indexes candidates(b): 0 closes the loop, any
 * other value extends it.
 */
export function open(b: Board, pick: number): Board {
  if (b.status !== 'live') throw new Error('round is over');
  const cands = candidates(b);
  if (!(Number.isInteger(pick) && pick >= 0 && pick < cands.length)) throw new Error(`pick ${pick} out of range`);
  const chain = b.chain.length ? [...b.chain] : [cands[0]];
  const head = chain[chain.length - 1];
  const target = cands[pick];
  const inside = [...b.inside];
  inside[head] = target;
  if (target === chain[0]) {
    const loops = [...b.loops, chain];
    const left = b.n - loops.reduce((s, l) => s + l.length, 0);
    return { ...b, inside, loops, chain: [], status: left <= b.limit ? 'won' : 'live' };
  }
  chain.push(target);
  return { ...b, inside, chain, status: chain.length - 1 >= b.limit ? 'bust' : 'live' };
}

/** The pick that opens the next box of a known permutation (perm[b] = the box b points at). */
export function pickFor(b: Board, perm: readonly number[]): number {
  const i = candidates(b).indexOf(perm[nextBox(b)]);
  if (i < 0) throw new Error('permutation does not match the board');
  return i;
}

/**
 * The Follow button: opens boxes until the loop closes, the round ends, or
 * the next box is the loop's last chance (a checkpoint before the decider).
 * Returns every intermediate board.
 */
export function follow(b: Board, pick: (b: Board) => number): Board[] {
  const out: Board[] = [];
  let cur = b;
  do {
    cur = open(cur, pick(cur));
    out.push(cur);
  } while (cur.status === 'live' && cur.chain.length > 0 && !lastChance(cur));
  return out;
}

export interface RulerSlot {
  /** The loop length this slot stands for. */
  length: number;
  /** Its width: every remaining length is equally likely. */
  share: number;
  /** Chance everything after also fits, if the loop closes here (0 past the limit). */
  fit: number;
  over: boolean;
}

/** The loop ruler: one slot per possible final length of the current loop. Σ share × fit = winChance. */
export function ruler(b: Board): RulerSlot[] {
  const R = remaining(b);
  const j = openedInLoop(b);
  const q = fitTable(b.n, b.limit);
  const share = 1 / (R - j);
  const out: RulerSlot[] = [];
  for (let k = j + 1; k <= R; k++) out.push({ length: k, share, fit: k <= b.limit ? q[R - k] : 0, over: k > b.limit });
  return out;
}

/** The loops of a permutation, in the order the game opens them (lowest unseen box first). */
export function loopsOf(perm: readonly number[]): number[][] {
  const seen = new Uint8Array(perm.length);
  const out: number[][] = [];
  for (let s = 0; s < perm.length; s++) {
    if (seen[s]) continue;
    const loop: number[] = [];
    for (let x = s; !seen[x]; x = perm[x]) {
      seen[x] = 1;
      loop.push(x);
    }
    out.push(loop);
  }
  return out;
}
