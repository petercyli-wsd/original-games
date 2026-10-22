// Sperner: a big triangle with corners A (top), B (bottom-left) and C
// (bottom-right) is cut into m² small triangles (m ∈ {3, 4, 5}). The corners
// keep their own colour. Every other vertex on a side takes one of that side's
// two corner colours (½ each); every vertex inside takes any of the three
// (⅓ each). A small triangle whose corners show all three colours is a
// rainbow. The player bets on the final number of rainbows: exactly 1, or at
// least k (3, 5, 7, 9, 11). The vertices are coloured row by row, top down.
//
// The theorem (Sperner's lemma, 1928). Every such colouring has an ODD number
// of rainbows. Proof by doors: call an edge with colours B–C a door. A rainbow
// has exactly one door, any other small triangle has zero or two. Summing
// doors over all small triangles counts inner doors twice and boundary doors
// once, so #rainbows ≡ #boundary doors (mod 2). Boundary doors only sit on the
// bottom side, and walking it from B to C the colour must switch an odd
// number of times, so #rainbows is odd. The signed form is sharper: rainbows
// whose colours run A → B → C counter-clockwise (like the corners) outnumber
// the reversed ones by exactly one. So the count is 1 + 2 × (reversed
// rainbows), "exactly 1" means "no reversed rainbow", and once 2 rainbows are
// on the board parity forces a third (the "≥ k" bets are won the moment k − 1
// are found; "exactly 1" is lost the moment 2 are).
//
// Exact live odds. Rows are coloured independently given their own colours,
// and the rainbows between rows i and i+1 depend only on those two rows. So a
// backward transfer DP over row colourings gives, for each colouring a of row
// i, the exact distribution D_i(a) of the rainbows still to come below it:
//   D_m(a) = δ₀,   D_i(a)[k] = mean over colourings b of row i+1 of D_{i+1}(b)[k − strip(a, b)].
// (Row i has at most 4·3^(i−1) colourings, so the tables are tiny.) A live
// state is "rows above r complete with f rainbows between them, row r partly
// coloured"; its final count is distributed as the mean, over the colourings
// of row r that agree with what is shown, of f + strip(row r−1, b) + D_r(b).
// That is an exact enumeration of every way the rest can be coloured (up to
// 2¹²·3⁶ ≈ 3 million for 25 triangles). No sampling anywhere.
//
// Pricing (fixed prize). A full win pays prize = RTP / P(win at the start).
// The cash-out at any state is prize × P(win | state). A conditional
// probability of a fixed event is a martingale, so the cash-out is one too,
// starting at RTP. By optional stopping, every rule (vertex by vertex, a row
// at a time, thresholds, the auto-stop when the bet is already decided) is
// worth exactly RTP. Cash-outs never exceed the prize, so the largest payout
// anywhere is the largest prize on offer: 16 triangles and 9+ rainbows, which
// happens in 24 of the 13,824 colourings (1 in 576), paying 0.99 × 576.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Sides are split into m pieces, giving m² small triangles. */
export const SIZES = [3, 4, 5] as const;
export type Size = (typeof SIZES)[number];

/** Bets on the final rainbow count: 1 means exactly one, k ≥ 3 means k or more. */
export const BETS = [1, 3, 5, 7, 9, 11] as const;
export type Bet = (typeof BETS)[number];

export const betWins = (bet: Bet, count: number) => (bet === 1 ? count === 1 : count >= bet);
export const betShort = (bet: Bet) => (bet === 1 ? '1' : `${bet}+`);
export const betPhrase = (bet: Bet) => (bet === 1 ? 'exactly 1 rainbow' : `${bet} or more rainbows`);

/** Offered bets keep the start chance between 0.1% and 95%. */
export const MIN_CHANCE = 0.001;
export const MAX_CHANCE = 0.95;

/** Eval presets, one per volatility level. */
export const VOLATILITY: Record<Volatility, { size: Size; bet: Bet }> = {
  low: { size: 4, bet: 3 },
  medium: { size: 4, bet: 1 },
  high: { size: 5, bet: 1 },
  extreme: { size: 5, bet: 11 },
};

/** Colours 0, 1, 2 are the colours of corners A (top), B (bottom-left), C (bottom-right). */
export const COLOUR_NAMES = ['A', 'B', 'C'] as const;

// ---------- Geometry ----------

/** Vertex id of row i (0 = top), position j (0 = left), 0 ≤ j ≤ i ≤ m. */
export const vid = (i: number, j: number) => (i * (i + 1)) / 2 + j;
export const vertexCount = (m: number) => ((m + 1) * (m + 2)) / 2;

/** The colours vertex (i, j) may take: its corner, its side's two corners, or all three inside. */
export function allowedAt(m: number, i: number, j: number): readonly number[] {
  if (i === 0) return [0];
  if (i === m) return j === 0 ? [1] : j === m ? [2] : [1, 2];
  if (j === 0) return [0, 1];
  if (j === i) return [0, 2];
  return [0, 1, 2];
}

export interface Vertex {
  id: number;
  i: number;
  j: number;
  allowed: readonly number[];
}

export interface Tri {
  /** Index in the board's triangle list. */
  id: number;
  /** The strip between rows `row` and `row + 1`. */
  row: number;
  up: boolean;
  /** Vertex ids, counter-clockwise: up = [top, bottom-left, bottom-right], down = [top-left, bottom, top-right]. */
  v: [number, number, number];
}

export interface Geometry {
  m: number;
  vertices: Vertex[];
  tris: Tri[];
  /** The vertices the round colours, in order (the three corners are fixed). */
  order: number[];
}

const geoms = new Map<number, Geometry>();

export function geometry(m: number): Geometry {
  let g = geoms.get(m);
  if (!g) {
    const vertices: Vertex[] = [];
    for (let i = 0; i <= m; i++) for (let j = 0; j <= i; j++) vertices.push({ id: vid(i, j), i, j, allowed: allowedAt(m, i, j) });
    const tris: Tri[] = [];
    for (let i = 0; i < m; i++) {
      for (let j = 0; j <= i; j++) {
        tris.push({ id: tris.length, row: i, up: true, v: [vid(i, j), vid(i + 1, j), vid(i + 1, j + 1)] });
        if (j < i) tris.push({ id: tris.length, row: i, up: false, v: [vid(i, j), vid(i + 1, j + 1), vid(i, j + 1)] });
      }
    }
    const order = vertices.filter((v) => v.allowed.length > 1).map((v) => v.id);
    g = { m, vertices, tris, order };
    geoms.set(m, g);
  }
  return g;
}

/** −1 marks a vertex not coloured yet. */
export type Colours = readonly number[];

/** The board before any reveal: only the three corners are coloured. */
export function freshColours(m: number): number[] {
  return geometry(m).vertices.map((v) => (v.allowed.length === 1 ? v.allowed[0] : -1));
}

export function paint(colours: Colours, v: number, c: number): number[] {
  const next = colours.slice();
  next[v] = c;
  return next;
}

export const isRainbow = (colours: Colours, t: Tri) => {
  const [a, b, c] = t.v.map((v) => colours[v]);
  return a >= 0 && b >= 0 && c >= 0 && a !== b && b !== c && a !== c;
};

/** +1 if a rainbow's colours run A → B → C the same way round as the corners, −1 if reversed, 0 if not a rainbow. */
export function orientation(colours: Colours, t: Tri): number {
  if (!isRainbow(colours, t)) return 0;
  const [a, b] = t.v.map((v) => colours[v]);
  return (b - a + 3) % 3 === 1 ? 1 : -1;
}

/** The finished rainbows on the board. */
export const rainbows = (m: number, colours: Colours) => geometry(m).tris.filter((t) => isRainbow(colours, t));

/** The next vertex to colour, or null when the board is full. */
export const nextVertex = (m: number, colours: Colours): number | null => geometry(m).order.find((v) => colours[v] < 0) ?? null;

/** The uncoloured vertices left in the row being coloured (the "Colour row" burst). */
export function rowRest(m: number, colours: Colours): number[] {
  const g = geometry(m);
  const v = nextVertex(m, colours);
  if (v === null) return [];
  const row = g.vertices[v].i;
  return g.order.filter((u) => g.vertices[u].i === row && colours[u] < 0);
}

// ---------- Exact transfer tables ----------

interface Tables {
  m: number;
  /** Largest possible rainbow count, m². */
  F: number;
  /** rows[i][a] = the a-th colouring of row i (lexicographic, left vertex first). */
  rows: Uint8Array[][];
  /** Row colouring code (base 3, left digit least significant) → index. */
  index: Map<number, number>[];
  /** strip[i][a · n(i+1) + b] = rainbows between row i = a and row i+1 = b. */
  strip: Uint8Array[];
  /** dist[i][a · (F+1) + k] = P(k more rainbows below row i | row i = a). */
  dist: Float64Array[];
}

const tableCache = new Map<number, Tables>();

const rainbow3 = (a: number, b: number, c: number) => a !== b && b !== c && a !== c;

function stripCount(top: Uint8Array, bot: Uint8Array): number {
  let n = 0;
  for (let j = 0; j < top.length; j++) {
    if (rainbow3(top[j], bot[j], bot[j + 1])) n++;
    if (j + 1 < top.length && rainbow3(top[j], bot[j + 1], top[j + 1])) n++;
  }
  return n;
}

const codeOf = (digits: ArrayLike<number>) => {
  let code = 0;
  for (let j = digits.length - 1; j >= 0; j--) code = code * 3 + digits[j];
  return code;
};

function tables(m: number): Tables {
  let t = tableCache.get(m);
  if (t) return t;
  const F = m * m;
  const rows: Uint8Array[][] = [];
  const index: Map<number, number>[] = [];
  for (let i = 0; i <= m; i++) {
    let list: number[][] = [[]];
    for (let j = 0; j <= i; j++) list = list.flatMap((pre) => allowedAt(m, i, j).map((c) => [...pre, c]));
    rows.push(list.map((d) => Uint8Array.from(d)));
    index.push(new Map(list.map((d, a) => [codeOf(d), a])));
  }
  const strip: Uint8Array[] = [];
  for (let i = 0; i < m; i++) {
    const nb = rows[i + 1].length;
    const s = new Uint8Array(rows[i].length * nb);
    rows[i].forEach((top, a) => rows[i + 1].forEach((bot, b) => (s[a * nb + b] = stripCount(top, bot))));
    strip.push(s);
  }
  const dist: Float64Array[] = new Array(m + 1);
  dist[m] = new Float64Array(rows[m].length * (F + 1));
  for (let a = 0; a < rows[m].length; a++) dist[m][a * (F + 1)] = 1;
  for (let i = m - 1; i >= 0; i--) {
    const na = rows[i].length;
    const nb = rows[i + 1].length;
    const d = new Float64Array(na * (F + 1));
    for (let a = 0; a < na; a++) {
      for (let b = 0; b < nb; b++) {
        const s = strip[i][a * nb + b];
        for (let k = 0; k + s <= F; k++) d[a * (F + 1) + k + s] += dist[i + 1][b * (F + 1) + k] / nb;
      }
    }
    dist[i] = d;
  }
  t = { m, F, rows, index, strip, dist };
  tableCache.set(m, t);
  return t;
}

/** Where a live board stands: rows above r are complete, row r is partly coloured, rows below are blank. */
type Frame =
  | { done: true; count: number }
  | { done: false; r: number; f: number; prev: number; cands: number[] };

function frame(m: number, colours: Colours): Frame {
  const t = tables(m);
  const g = geometry(m);
  if (colours.length !== g.vertices.length) throw new Error('Wrong board size');
  let r = -1;
  for (const v of g.order) {
    if (colours[v] < 0) {
      r = g.vertices[v].i;
      break;
    }
  }
  if (r < 0) return { done: true, count: rainbows(m, colours).length };
  let f = 0;
  let prev = 0;
  for (let i = 1; i < r; i++) {
    const base = vid(i, 0);
    let code = 0;
    for (let j = i; j >= 0; j--) code = code * 3 + colours[base + j];
    const idx = t.index[i].get(code);
    if (idx === undefined) throw new Error(`Row ${i} is not a legal colouring`);
    f += t.strip[i - 1][prev * t.rows[i].length + idx];
    prev = idx;
  }
  for (const v of g.order) {
    if (g.vertices[v].i > r && colours[v] >= 0) throw new Error('Rows are coloured top down');
  }
  const base = vid(r, 0);
  const rows = t.rows[r];
  const cands: number[] = [];
  outer: for (let a = 0; a < rows.length; a++) {
    const d = rows[a];
    for (let j = 0; j <= r; j++) {
      const c = colours[base + j];
      if (c >= 0 && c !== d[j]) continue outer;
    }
    cands.push(a);
  }
  if (cands.length === 0) throw new Error(`Row ${r} is not a legal colouring`);
  return { done: false, r, f, prev, cands };
}

/** Exact distribution of the final rainbow count (index k = k rainbows) given the board so far. */
export function finalDistribution(m: number, colours: Colours): Float64Array {
  const t = tables(m);
  const F = t.F;
  const out = new Float64Array(F + 1);
  const fr = frame(m, colours);
  if (fr.done) {
    out[fr.count] = 1;
    return out;
  }
  const nb = t.rows[fr.r].length;
  const w = 1 / fr.cands.length;
  for (const b of fr.cands) {
    const base = fr.f + t.strip[fr.r - 1][fr.prev * nb + b];
    for (let k = 0; k + base <= F; k++) out[k + base] += w * t.dist[fr.r][b * (F + 1) + k];
  }
  return out;
}

// Per-bet tables: win[i][a · (F+1) + g] = P(g + rainbows below row i wins | row i = a); lose likewise.
const betCache = new Map<string, { win: Float64Array[]; lose: Float64Array[] }>();

function betTables(m: number, bet: Bet) {
  const key = `${m}:${bet}`;
  let bt = betCache.get(key);
  if (!bt) {
    const t = tables(m);
    const F = t.F;
    const win: Float64Array[] = [];
    const lose: Float64Array[] = [];
    for (let i = 0; i <= m; i++) {
      const n = t.rows[i].length;
      const W = new Float64Array(n * (F + 1));
      const L = new Float64Array(n * (F + 1));
      for (let a = 0; a < n; a++) {
        for (let g = 0; g <= F; g++) {
          let w = 0;
          let l = 0;
          for (let k = 0; k + g <= F; k++) {
            const p = t.dist[i][a * (F + 1) + k];
            if (p === 0) continue;
            if (betWins(bet, g + k)) w += p;
            else l += p;
          }
          W[a * (F + 1) + g] = w;
          L[a * (F + 1) + g] = l;
        }
      }
      win.push(W);
      lose.push(L);
    }
    bt = { win, lose };
    betCache.set(key, bt);
  }
  return bt;
}

export interface Chances {
  /** Probability mass of the colourings still possible that win the bet. */
  win: number;
  /** ...and that lose it. Exactly 0 when the bet is already won. */
  lose: number;
  /** P(win | board) = win / (win + lose). */
  p: number;
}

/** Exact chance that the bet wins, given the board so far. */
export function chances(m: number, bet: Bet, colours: Colours): Chances {
  const fr = frame(m, colours);
  if (fr.done) {
    const w = betWins(bet, fr.count) ? 1 : 0;
    return { win: w, lose: 1 - w, p: w };
  }
  const t = tables(m);
  const F = t.F;
  const bt = betTables(m, bet);
  const nb = t.rows[fr.r].length;
  let win = 0;
  let lose = 0;
  for (const b of fr.cands) {
    const g = fr.f + t.strip[fr.r - 1][fr.prev * nb + b];
    win += bt.win[fr.r][b * (F + 1) + g];
    lose += bt.lose[fr.r][b * (F + 1) + g];
  }
  win /= fr.cands.length;
  lose /= fr.cands.length;
  return { win, lose, p: win / (win + lose) };
}

export const winChance = (m: number, bet: Bet, colours: Colours) => chances(m, bet, colours).p;

/** Whether the bet is settled already: 'won' (no losing colouring left), 'lost', or null. */
export function decided(c: Chances): 'won' | 'lost' | null {
  return c.lose === 0 ? 'won' : c.win === 0 ? 'lost' : null;
}

const startCache = new Map<string, number>();

/** P(win) before any vertex is coloured. */
export function startChance(m: number, bet: Bet): number {
  const key = `${m}:${bet}`;
  let p = startCache.get(key);
  if (p === undefined) {
    p = winChance(m, bet, freshColours(m));
    startCache.set(key, p);
  }
  return p;
}

export const prizeFor = (m: number, bet: Bet) => RTP / startChance(m, bet);

/** Cash-out value (× stake) of a live board. */
export const cashValue = (m: number, bet: Bet, colours: Colours) => prizeFor(m, bet) * winChance(m, bet, colours);

export function isOffered(m: number, bet: Bet): boolean {
  const p = startChance(m, bet);
  return p >= MIN_CHANCE && p <= MAX_CHANCE;
}

/** The bet to switch to when the grid changes and the old one is not offered: the nearest offered one. */
export function nearestBet(m: number, bet: Bet): Bet {
  if (isOffered(m, bet)) return bet;
  const offered = BETS.filter((b) => isOffered(m, b));
  return offered.reduce((best, b) => (Math.abs(b - bet) < Math.abs(best - bet) ? b : best), offered[0]);
}

/** Where the win chance goes for each colour the next vertex can take. */
export function nextSwing(m: number, bet: Bet, colours: Colours): { vertex: number; options: { colour: number; p: number }[] } | null {
  const v = nextVertex(m, colours);
  if (v === null) return null;
  return {
    vertex: v,
    options: geometry(m).vertices[v].allowed.map((c) => ({ colour: c, p: winChance(m, bet, paint(colours, v, c)) })),
  };
}

/** The bars drawn on the board: one per odd count, the last one collecting the tail. */
export interface Column {
  label: string;
  /** Counts from..to (inclusive) belong to this bar. */
  from: number;
  to: number;
  /** Exact chance the final count lands in this bar. */
  p: number;
  /** Whether a final count in this bar wins the bet. */
  win: boolean;
}

const COLUMN_CAP: Record<number, number> = { 3: 5, 4: 9, 5: 13 };

/** The largest rainbow count any colouring of this grid reaches. */
export function mostRainbows(m: number): number {
  const d = finalDistribution(m, freshColours(m));
  let k = d.length - 1;
  while (k > 0 && d[k] === 0) k--;
  return k;
}

export function countColumns(m: number, bet: Bet, dist: ArrayLike<number>): Column[] {
  const F = m * m;
  const cap = COLUMN_CAP[m] ?? F;
  const most = mostRainbows(m);
  const cols: Column[] = [];
  for (let k = 1; k <= cap; k += 2) {
    const to = k === cap ? F : k;
    let p = 0;
    for (let x = k; x <= to; x++) p += dist[x];
    cols.push({ label: k === cap && most > cap ? `${k}+` : `${k}`, from: k, to, p, win: betWins(bet, k) });
  }
  return cols;
}

export function volatilityOf(p: number): Volatility {
  return p >= 0.3 ? 'low' : p >= 0.1 ? 'medium' : p >= 0.03 ? 'high' : 'extreme';
}

/** The largest prize on offer: every cash-out is at most its round's prize. */
export const MAX_MULTIPLIER = Math.max(...SIZES.flatMap((m) => BETS.filter((b) => isOffered(m, b)).map((b) => prizeFor(m, b))));
