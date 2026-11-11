// Back to Back: pure maths.
//
// A shuffled 22-card deck (12 red, 5 blue, 3 green, 2 yellow) is turned one card
// at a time. The first colour to come up twice in a row ("snap") wins; you back a
// colour before the bet and it never changes.
//
// A snap is certain. A deck with no two equal neighbours needs the 12 reds kept
// apart by at least 11 other cards, but only 10 exist (pigeonhole), so every round
// ends by the time the deck is gone (at most 22 cards turned, usually a handful).
//
// State: (counts left, colour on top). The next card is colour j with chance
// c_j / N exactly (the deck is a uniform shuffle, so the top card is uniform among
// the cards left). If j is the top colour it snaps and j wins; otherwise j is the
// new top. So
//
//   P(i first | c, top) = sum_j (c_j / N) * [ j = top ? 1(j = i) : P(i first | c - e_j, j) ].
//
// Pricing: pattern 1 (fixed prize). A full win pays prize = RTP / P0(me), and the
// cash-out is prize * P(me first | state). That is a martingale, because P(me | state)
// is by construction the average of P(me | next state) over the next card, so by
// optional stopping no cash-out rule beats RTP = 0.99. Choosing a colour changes the
// prize and its chance (P0 * prize = RTP for each), never the EV. The DP has at most
// 13*6*4*3*5 states and is cached.

export const RTP = 0.99;
export const DECK: readonly number[] = [12, 5, 3, 2];
export const N_COLOURS = DECK.length;
export const NO_TOP = -1;

const cache = new Map<string, number[]>();

/** Exact chance that each colour snaps first from this state. */
export function winChances(counts: readonly number[], top: number): number[] {
  const key = counts.join(',') + '|' + top;
  const hit = cache.get(key);
  if (hit) return hit;
  const n = counts.reduce((a, b) => a + b, 0);
  const out = counts.map(() => 0);
  if (n > 0) {
    for (let j = 0; j < counts.length; j++) {
      if (counts[j] === 0) continue;
      const p = counts[j] / n;
      if (j === top) out[j] += p;
      else {
        const sub = winChances(without(counts, j), j);
        for (let i = 0; i < out.length; i++) out[i] += p * sub[i];
      }
    }
  }
  cache.set(key, out);
  return out;
}

export function without(counts: readonly number[], j: number): number[] {
  return counts.map((c, i) => (i === j ? c - 1 : c));
}

export const total = (counts: readonly number[]) => counts.reduce((a, b) => a + b, 0);

export const startChances = (): number[] => winChances(DECK, NO_TOP);
export const startPrize = (me: number) => RTP / startChances()[me];
/** An honest bound on any payout: the longest-shot prize, rounded up. */
export const MAX_MULTIPLIER = Math.ceil(Math.max(...DECK.map((_, i) => startPrize(i))) * 100) / 100;

/** My chance if colour j is the next card turned (the "ghosts" on the deck bar). */
export function ifNext(counts: readonly number[], top: number, me: number): number[] {
  return counts.map((c, j) => {
    if (c === 0) return 0;
    if (j === top) return j === me ? 1 : 0;
    return winChances(without(counts, j), j)[me];
  });
}

/** The card turned for a uniform u in [0, 1): colour j with chance c_j / N. */
export function drawColour(counts: readonly number[], u: number): number {
  const n = total(counts);
  let k = Math.min(n - 1, Math.floor(u * n));
  for (let j = 0; j < counts.length; j++) {
    if (k < counts[j]) return j;
    k -= counts[j];
  }
  return counts.length - 1;
}

export interface Turn {
  colour: number;
  counts: number[];
  top: number;
  /** The turned card matches the one beneath it: that colour wins. */
  snap: boolean;
}

/** Turns one card. */
export function turn(counts: readonly number[], top: number, u: number): Turn {
  const colour = drawColour(counts, u);
  return { colour, counts: without(counts, colour), top: colour, snap: colour === top };
}

/** Value (multiple of the stake) of backing `me` right after a turn. */
export function valueAfter(t: Turn, me: number, prize: number): number {
  if (t.snap) return t.colour === me ? prize : 0;
  return prize * winChances(t.counts, t.top)[me];
}

/** Volatility level for the chance of the backed colour at the start. */
export function volatilityOf(p: number): 'low' | 'medium' | 'high' | 'extreme' {
  return p > 0.5 ? 'low' : p > 0.1 ? 'medium' : p > 0.03 ? 'high' : 'extreme';
}
