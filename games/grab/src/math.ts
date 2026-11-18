// Grab: a 16-wedge wheel. At Bet it holds 1 green wedge, r red wedges and 15 - r grey ones.
// Each spin lands on a uniformly random wedge:
//   green: a hit (the wedge stays green; the second hit wins),
//   grey:  that wedge turns green and you spin again,
//   red:   the round is lost.
//
// State (g, h) = (green wedges, hits). The red count r never changes, green only grows and
// hits only grow, so P(win | g, h) is an acyclic DP (pattern 1, "fixed prize"):
//   W(g, 2) = 1,   W(g, h) = [ g * W(g, h + 1) + (16 - g - r) * W(g + 1, h) ] / 16.
// The prize is RTP / W(1, 0). The cash-out is prize * W(g, h), computed exactly, so by
// optional stopping every cash-out strategy returns exactly RTP.

export const RTP = 0.99;
export const WEDGES = 16;
export const REDS = [1, 2, 4, 6, 8, 10] as const;
export type Reds = (typeof REDS)[number];
export const HITS_TO_WIN = 2;

const cache = new Map<string, number>();

/** Exact chance to win from g green wedges and h hits, with r red wedges. */
export function winChance(g: number, h: number, r: number): number {
  if (h >= HITS_TO_WIN) return 1;
  const key = `${g},${h},${r}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const grey = WEDGES - g - r;
  const w = (g * winChance(g, h + 1, r) + (grey > 0 ? grey * winChance(g + 1, h, r) : 0)) / WEDGES;
  cache.set(key, w);
  return w;
}

/** Whole-bet chance at the start: 1 green, no hits. */
export const startChance = (r: number) => winChance(1, 0, r);

/** The prize for a full win (two hits before red). */
export const prizeFor = (r: number) => RTP / startChance(r);

/** Cash-out multiplier at (g, h): prize x chance to win from there. */
export const cashOut = (g: number, h: number, r: number) => (h >= HITS_TO_WIN ? prizeFor(r) : prizeFor(r) * winChance(g, h, r));

export const MAX_MULTIPLIER = Math.ceil(prizeFor(10) * 1.001);

export type Kind = 'green' | 'grey' | 'red';

/** Fixed layout: wedge 0 is green; red wedges are spread evenly round the other 15. */
export function layout(r: number): Kind[] {
  const w: Kind[] = Array.from({ length: WEDGES }, () => 'grey');
  w[0] = 'green';
  for (let i = 0; i < r; i++) w[1 + Math.floor(((i + 0.5) * (WEDGES - 1)) / r)] = 'red';
  return w;
}

export type Level = 'low' | 'medium' | 'high' | 'extreme';
export const levelOf = (r: number): Level => (r <= 1 ? 'low' : r <= 4 ? 'medium' : r <= 8 ? 'high' : 'extreme');

export interface State {
  wedges: Kind[];
  hits: number;
}

export type Spin = { kind: 'red' } | { kind: 'hit'; state: State } | { kind: 'grey'; state: State };

/** One spin on wedge index `i` (0..15). */
export function spin(s: State, i: number): Spin {
  const k = s.wedges[i];
  if (k === 'red') return { kind: 'red' };
  if (k === 'green') return { kind: 'hit', state: { wedges: s.wedges, hits: s.hits + 1 } };
  const wedges = s.wedges.slice();
  wedges[i] = 'green';
  return { kind: 'grey', state: { wedges, hits: s.hits } };
}

export const greens = (s: State) => s.wedges.filter((k) => k === 'green').length;
export const redsOf = (s: State) => s.wedges.filter((k) => k === 'red').length;
export const chanceOf = (s: State) => winChance(greens(s), s.hits, redsOf(s));
export const cashOf = (s: State) => cashOut(greens(s), s.hits, redsOf(s));
