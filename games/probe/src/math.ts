// Probe: a hash table of m slots arranged in a ring. Keys arrive one at a
// time; each hashes to a uniformly random home slot and, by linear probing,
// slides forward to the first empty slot at or after it. The probe distance
// is how far it slides (0 if the home is empty). A key that would have to
// slide more than P slots overflows and the round is lost. Store K keys and
// the round pays out.
//
// The risk, as a picture. A key hashing to h overflows exactly when h and the
// next P slots are all full. In a cluster (a run of c full slots) that is true
// of the first c − P slots, so the red slots number Σ max(0, c − P) over the
// clusters, and the bust chance of the next key is q = red / m: the share of
// the ring that is red. Clusters only grow, and when a key fills the single
// gap between two clusters they merge and the red count jumps (Knuth's
// "primary clustering").
//
// Pricing (per-step fair factor). Surviving a key with bust chance q
// multiplies the cash-out by 1/(1 − q) = m / (m − red), so
//   E[cash-out after the key] = (1 − q)·cash/(1 − q) + q·0 = cash.
// The cash-out is a martingale starting at RTP; every round ends within K
// keys, so by optional stopping every strategy (any cash-out rule, playing to
// the end, the automatic insertion of free keys) returns exactly RTP. Keys
// with q = 0 are free and q = 1 never happens (an empty slot is never red).
//
// Max multiplier, honestly bounded without a cap. With n keys stored, the red
// count is at most n − P (all keys in one cluster), so the factor of the next
// key is at most m / (m − n + P) and the payout at most
//   RTP · Π_{n=P+1}^{K−1} m / (m − n + P),
// which is reached by the path that keeps a single growing cluster. The
// largest over every setting is the manifest's maxMultiplier.
//
// Headline odds (exact). Write f_P(c) for the number of hash sequences of c
// keys into a block of c slots that fill it without spilling out of its end
// and with every probe distance ≤ P. Splitting on the slot j the last key
// fills gives
//   f_P(c) = Σ_j C(c−1, j) · f_P(j) · f_P(c−1−j) · (min(j, P) + 1),
// and with no limit f(c) = (c + 1)^(c−1), the parking functions. On the ring,
// the final table has e = m − K empty slots and splits into e blocks, each a
// cluster followed by one empty slot; cutting the ring at each empty slot
// (every table is counted e times) gives
//   #good sequences = (m / e) · K! · [x^K] F_P(x)^e,   F_P(x) = Σ f_P(c) x^c / c!,
// and P(fill) = #good / m^K. Without a limit F = e^T (T the tree function)
// and the count is m^K, the Konheim–Weiss identity. All of this is BigInt
// integer arithmetic: the headline is an exact rational.
//
// The live chance to fill from any table uses the same split with the
// current keys fixed: an interval DP counts the ways to fill each run between
// two slots that will stay empty, and a ring DP sums over which empty slots
// stay empty. It is display-only (the cash-out uses the per-step factor) and
// the tests check it against the headline, the martingale identity and
// simulation.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Table sizes (slots in the ring). */
export const SIZES = [16, 24, 32] as const;
export type Size = (typeof SIZES)[number];

/** Probe limits: how far a key may slide past its home slot. */
export const LIMITS = [1, 2, 3, 5] as const;
export type Limit = (typeof LIMITS)[number];

/** Target load factors α = K / m. Every size × load is a whole number of keys. */
export const LOADS = [0.5, 0.625, 0.75] as const;
export type Load = (typeof LOADS)[number];

export interface Settings {
  size: Size;
  limit: Limit;
  load: Load;
}

/** Keys to store before the round pays out. */
export const keysFor = (size: Size, load: Load) => Math.round(size * load);

/** The eval's configs, one per volatility level. */
export const VOLATILITY: Record<Volatility, Settings> = {
  low: { size: 24, limit: 3, load: 0.5 },
  medium: { size: 24, limit: 2, load: 0.625 },
  high: { size: 32, limit: 1, load: 0.625 },
  extreme: { size: 32, limit: 1, load: 0.75 },
};

/** A table: true where a slot holds a key. */
export type Table = readonly boolean[];

export const emptyTable = (m: number): boolean[] => new Array<boolean>(m).fill(false);

export const keyCount = (table: Table) => table.reduce((n, full) => n + (full ? 1 : 0), 0);

/** How far a key hashing to h slides: slots past h until the first empty one (0 if h is empty). */
export function probeDistance(table: Table, h: number): number {
  const m = table.length;
  let d = 0;
  while (d < m && table[(h + d) % m]) d++;
  return d;
}

/** Probe distance for every home slot (what the board writes in each full slot). */
export const distances = (table: Table) => table.map((_, h) => probeDistance(table, h));

/** red[h]: a key hashing to h overflows, i.e. h and the next `limit` slots are all full. */
export function redSlots(table: Table, limit: number): boolean[] {
  return table.map((_, h) => probeDistance(table, h) > limit);
}

export const redCount = (table: Table, limit: number) => redSlots(table, limit).filter(Boolean).length;

/** Chance the next key overflows: the red share of the ring. */
export const bustChance = (table: Table, limit: number) => redCount(table, limit) / table.length;

export interface Insertion {
  /** Whether the key found a slot within the limit. */
  safe: boolean;
  /** Slots it slid past its home (for a bust: `limit`, where it gave up). */
  hops: number;
  /** Where it ended: its new slot, or the last slot it probed before overflowing. */
  slot: number;
  /** The table afterwards (unchanged on a bust). */
  table: boolean[];
}

/** Inserts a key whose hash is h, by linear probing with the given limit. */
export function insert(table: Table, h: number, limit: number): Insertion {
  const m = table.length;
  const d = probeDistance(table, h);
  if (d > limit) return { safe: false, hops: limit, slot: (h + limit) % m, table: [...table] };
  const next = [...table];
  next[(h + d) % m] = true;
  return { safe: true, hops: d, slot: (h + d) % m, table: next };
}

/** Cash-out after surviving a key that had `red` red slots out of m. */
export const afterSafeKey = (cash: number, red: number, m: number) => (cash * m) / (m - red);

export interface Cluster {
  start: number;
  length: number;
}

/** Maximal runs of full slots (a table with an empty slot has a well-defined start for each). */
export function clusters(table: Table): Cluster[] {
  const m = table.length;
  const start = table.findIndex((full) => !full);
  if (start < 0) return [{ start: 0, length: m }];
  const out: Cluster[] = [];
  let run = 0;
  for (let i = 1; i <= m; i++) {
    const s = (start + i) % m;
    if (table[s]) run++;
    else if (run > 0) {
      out.push({ start: (s - run + m) % m, length: run });
      run = 0;
    }
  }
  return out;
}

// ---------- Exact headline: parking functions with a probe limit ----------

function binomials(n: number): bigint[][] {
  const C: bigint[][] = [];
  for (let i = 0; i <= n; i++) {
    C.push([]);
    for (let j = 0; j <= i; j++) C[i].push(j === 0 || j === i ? 1n : C[i - 1][j - 1] + C[i - 1][j]);
  }
  return C;
}

/** f_P(c) for c = 0..cmax: hash sequences that fill a block of c slots exactly, every probe ≤ limit. */
export function blockCounts(limit: number, cmax: number): bigint[] {
  const C = binomials(Math.max(cmax, 1));
  const f: bigint[] = [1n];
  for (let c = 1; c <= cmax; c++) {
    let s = 0n;
    for (let j = 0; j < c; j++) s += C[c - 1][j] * f[j] * f[c - 1 - j] * BigInt(Math.min(j, limit) + 1);
    f.push(s);
  }
  return f;
}

/** Number of hash sequences (out of m^K) that store K keys in m slots with every probe ≤ limit. */
export function fillCount(m: number, K: number, limit: number): bigint {
  if (K <= 0) return 1n;
  const e = m - K;
  if (e < 1) throw new Error('need at least one empty slot');
  const f = blockCounts(limit, K);
  const C = binomials(K);
  // g[n] = n! [x^n] F^t, built up for t = 1..e.
  let g: bigint[] = [1n, ...new Array<bigint>(K).fill(0n)];
  for (let t = 1; t <= e; t++) {
    const h: bigint[] = [];
    for (let n = 0; n <= K; n++) {
      let s = 0n;
      for (let c = 0; c <= n; c++) s += C[n][c] * f[c] * g[n - c];
      h.push(s);
    }
    g = h;
  }
  const total = BigInt(m) * g[K];
  if (total % BigInt(e) !== 0n) throw new Error('ring count is not an integer');
  return total / BigInt(e);
}

const fillCache = new Map<string, number>();

/** Exact chance that K keys all fit within the probe limit, from an empty table. */
export function fillChance(m: number, K: number, limit: number): number {
  const key = `${m}/${K}/${limit}`;
  let p = fillCache.get(key);
  if (p === undefined) {
    p = Number(fillCount(m, K, limit)) / Number(BigInt(m) ** BigInt(K));
    fillCache.set(key, p);
  }
  return p;
}

// ---------- Exact live odds: chance to fill from the current table ----------

/**
 * Exact chance that the remaining K − n keys all fit, from this table.
 *
 * Ĝ(a, len) counts (divided by r!, r = its empty slots) the hash sequences
 * that fill every empty slot of the run a..a+len−1 with keys hashing inside
 * it, none spilling past its end, every probe ≤ limit. The last key fills
 * some empty slot j, the run splits into two independent runs, and that key
 * hashed to one of min(j − a, limit) + 1 slots. A ring DP then chooses which
 * empty slots stay empty (exactly m − K of them), cutting at each in turn.
 */
export function fillChanceFrom(table: Table, K: number, limit: number): number {
  const m = table.length;
  const r = K - keyCount(table);
  if (r <= 0) return 1;
  const keep = m - K;
  if (keep < 1) throw new Error('need at least one empty slot');

  // g[a][len] for runs starting at a, len = 0..m−1.
  const g: Float64Array[] = Array.from({ length: m }, () => new Float64Array(m));
  const emptyIn: Int32Array[] = Array.from({ length: m }, () => new Int32Array(m));
  for (let a = 0; a < m; a++) {
    for (let len = 1; len < m; len++) emptyIn[a][len] = emptyIn[a][len - 1] + (table[(a + len - 1) % m] ? 0 : 1);
  }
  for (let len = 0; len < m; len++) {
    for (let a = 0; a < m; a++) {
      const empties = emptyIn[a][len];
      if (empties === 0) {
        g[a][len] = 1;
        continue;
      }
      let s = 0;
      for (let i = 0; i < len; i++) {
        const j = (a + i) % m;
        if (table[j]) continue;
        s += g[a][i] * g[(j + 1) % m][len - 1 - i] * (Math.min(i, limit) + 1);
      }
      g[a][len] = s / empties;
    }
  }

  // Σ over sets of kept-empty slots of Π Ĝ(runs), counted once per kept slot.
  let total = 0;
  const D: Float64Array[] = Array.from({ length: m }, () => new Float64Array(keep + 1));
  for (let s = 0; s < m; s++) {
    if (table[s]) continue;
    for (const row of D) row.fill(0);
    D[0][1] = 1;
    for (let t = 0; t < m; t++) {
      for (let k = 1; k <= keep; k++) {
        const v = D[t][k];
        if (v === 0) continue;
        if (k === keep) {
          total += v * g[(s + t + 1) % m][m - 1 - t];
          continue;
        }
        for (let u = t + 1; u < m; u++) {
          if (!table[(s + u) % m]) D[u][k + 1] += v * g[(s + t + 1) % m][u - t - 1];
        }
      }
    }
  }
  let p = total / keep;
  for (let i = 1; i <= r; i++) p *= i / m;
  return Math.min(1, Math.max(0, p));
}

// ---------- Bounds and volatility ----------

/** Largest payout reachable with these settings: one cluster that grows every key. */
export function maxMultiplier(m: number, K: number, limit: number): number {
  let x = RTP;
  for (let n = limit + 1; n < K; n++) x *= m / (m - n + limit);
  return x;
}

export const MAX_MULTIPLIER = Math.max(
  ...SIZES.flatMap((m) => LIMITS.flatMap((P) => LOADS.map((load) => maxMultiplier(m, keysFor(m, load), P)))),
);

/** Volatility label for the chosen settings, from the chance to fill. */
export function volatilityOf({ size, limit, load }: Settings): Volatility {
  const p = fillChance(size, keysFor(size, load), limit);
  return p >= 0.5 ? 'low' : p >= 0.15 ? 'medium' : p >= 0.03 ? 'high' : 'extreme';
}
