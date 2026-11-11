// Upsets: eight seeds play a knockout (the steep ratings 1000/seed). In every
// match the underdog is the bigger seed number, and it wins with chance
// r_u / (r_u + r_f) (Bradley-Terry). You bet on K: you win if underdogs win K
// matches before favourites win 8 - K. The tournament has 7 matches and
// K + (8 - K) = 8 > 7, so exactly one of the two counts is completed.
//
// Pricing (fixed prize). P(state) is exact: the matches are played in a fixed
// order, so P(state) = p_up * P(after an upset) + (1 - p_up) * P(after a
// favourite win), a DP over the played prefix (at most 2^7 leaves). Prize =
// RTP / P(start); cash-out = prize * P(state), a martingale starting at RTP,
// so by optional stopping every way of playing returns exactly RTP. Prize is
// at most RTP / P(start of K = 5), so the max win is bounded.

export const RTP = 0.99;
export const SEEDS = 8;
export const MATCHES = 7;
export const KS = [1, 2, 3, 4, 5] as const;
export type K = (typeof KS)[number];

/** Rating of seed s (0-based): 1000 / (s + 1), as an integer. */
export const rating = (s: number) => Math.round(1000 / (s + 1));

/** Standard seeding: 1v8, 4v5, 2v7, 3v6 (0-based seeds by slot). */
export const ORDER = [0, 7, 3, 4, 1, 6, 2, 5];

/** Match i (0..6): 0-3 round one, 4-5 semi-finals, 6 the final. Winners so far, in play order. */
export type Results = readonly number[];

export const roundOf = (i: number) => (i < 4 ? 0 : i < 6 ? 1 : 2);

/** The two seeds in match i, given the earlier winners. */
export function players(res: Results, i: number): [number, number] {
  if (i < 4) return [ORDER[2 * i], ORDER[2 * i + 1]];
  return [res[2 * (i - 4)], res[2 * (i - 4) + 1]];
}

/** [favourite, underdog]: the underdog is the bigger seed number. */
export function sides(res: Results, i: number): [number, number] {
  const [a, b] = players(res, i);
  return a < b ? [a, b] : [b, a];
}

/** The underdog's chance to win match i: the gold arc, a literal share of the spinner. */
export function pUpset(res: Results, i: number): number {
  const [f, u] = sides(res, i);
  return rating(u) / (rating(u) + rating(f));
}

export const isUpset = (res: Results, i: number, winner: number) => winner === sides(res, i)[1];

export function counts(res: Results): { up: number; fav: number } {
  let up = 0;
  for (let i = 0; i < res.length; i++) if (isUpset(res, i, res[i])) up++;
  return { up, fav: res.length - up };
}

/** 'won', 'lost' or 'live' for a bet on K upsets. */
export function status(res: Results, k: number): 'won' | 'lost' | 'live' {
  const { up, fav } = counts(res);
  if (up >= k) return 'won';
  if (fav >= SEEDS - k) return 'lost';
  return 'live';
}

const memo = new Map<string, number>();
/** Exact chance of winning the bet from the played results. */
export function pWin(res: Results, k: number): number {
  const s = status(res, k);
  if (s === 'won') return 1;
  if (s === 'lost') return 0;
  const key = `${k}:${res.join(',')}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const i = res.length;
  const [f, u] = sides(res, i);
  const pu = pUpset(res, i);
  const v = pu * pWin([...res, u], k) + (1 - pu) * pWin([...res, f], k);
  memo.set(key, v);
  return v;
}

/** The winner of match i from a uniform draw: the underdog wins when u < its chance. */
export function playMatch(res: Results, i: number, u: number): number {
  const [f, d] = sides(res, i);
  return u < pUpset(res, i) ? d : f;
}

export const startP = (k: number) => pWin([], k);
export const prizeFor = (k: number) => RTP / startP(k);
export const MAX_MULTIPLIER = Math.ceil(prizeFor(5)) + 1;

/** Upsets still needed and matches left, the two numbers the chance follows. */
export function need(res: Results, k: number) {
  return { upsets: k - counts(res).up, left: MATCHES - res.length };
}

export function volatilityOf(p: number): 'low' | 'medium' | 'high' | 'extreme' {
  return p > 0.3 ? 'low' : p > 0.08 ? 'medium' : p > 0.012 ? 'high' : 'extreme';
}
