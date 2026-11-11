// Banker: sixteen sealed cases hold sixteen known prizes, one each. Yours is
// one of them; the other fifteen open one at a time, a uniformly random sealed
// one each step. The round ends on the last other case, never on your own.
//
// Pricing: by exchangeability, your case holds each still-sealed prize with
// equal chance. So E[prize in your case | opened so far] = the mean of the
// prizes still sealed, and with Deal = RTP × that mean the offer is a
// martingale: the next case is uniform among the sealed others, so removing it
// leaves the expected mean unchanged (E[new mean] = old mean). By optional
// stopping every Deal-or-continue strategy returns exactly RTP. Playing on to
// the last other case pays RTP × your prize, which is the same quantity (the
// mean of the one prize left sealed). Every board averages exactly 1.

export const RTP = 0.99;

export type BoardId = 'flat' | 'classic';
export const BOARDS: BoardId[] = ['flat', 'classic'];

const FLAT_RAW = Array.from({ length: 16 }, (_, i) => 0.53 + (0.94 * i) / 15);
const CLASSIC_RAW = [0, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10, 15, 25];

const scale = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.map((x) => x / m);
};

/** Prizes in ascending order, each a multiple of the bet, averaging exactly 1. */
export const PRIZES: Record<BoardId, number[]> = { flat: scale(FLAT_RAW), classic: scale(CLASSIC_RAW) };

export const BOARD_NAME: Record<BoardId, string> = { flat: 'Flat', classic: 'Classic' };

export const CASES = 16;

/** The most any round can pay: RTP × the biggest prize on any board. */
export const MAX_MULTIPLIER = RTP * Math.max(...BOARDS.map((b) => PRIZES[b][CASES - 1]));

/** What a prize pays: RTP × the prize (the bars are drawn in these units). */
export const pays = (prize: number) => RTP * prize;

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Deal: RTP × the average of the prizes still sealed (yours included). */
export const deal = (sealed: number[]) => RTP * mean(sealed);

/** How many sealed prizes would pay more than the bet. */
export const profitCount = (sealed: number[]) => sealed.filter((p) => pays(p) > 1).length;

/** Chance your case pays more than the bet: the share of sealed bars above the bet line. */
export const profitChance = (sealed: number[]) => (sealed.length ? profitCount(sealed) / sealed.length : 0);

/** A random order of the prizes: case i holds prizes[i]. Case 0 is yours. */
export function shuffle(prizes: number[], int: (n: number) => number): number[] {
  const a = [...prizes];
  for (let i = a.length - 1; i > 0; i--) {
    const j = int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Sealed other cases (indices 1..15) not yet opened. */
export const sealedOthers = (opened: number[]) => Array.from({ length: CASES - 1 }, (_, i) => i + 1).filter((i) => !opened.includes(i));

/** The prizes still sealed: yours and every other case not yet opened. */
export const sealedPrizes = (cases: number[], opened: number[]) => [cases[0], ...sealedOthers(opened).map((i) => cases[i])];

/** Remove one prize (by value, first match) from a list of sealed prizes. */
export function without(sealed: number[], prize: number): number[] {
  const i = sealed.indexOf(prize);
  return i < 0 ? sealed : [...sealed.slice(0, i), ...sealed.slice(i + 1)];
}

/**
 * Play one round: stop (take Deal) after `stop(opened, offer, sealed)` says so at a
 * checkpoint, else go to the last other case. Returns the multiplier and openings made.
 */
export function playRound(
  board: BoardId,
  int: (n: number) => number,
  stop: (openings: number, offer: number, sealed: number[]) => boolean,
): { multiplier: number; steps: number } {
  const cases = shuffle(PRIZES[board], int);
  const opened: number[] = [];
  for (;;) {
    const left = sealedOthers(opened);
    opened.push(left[int(left.length)]);
    const sealed = sealedPrizes(cases, opened);
    if (opened.length >= CASES - 1) return { multiplier: pays(cases[0]), steps: opened.length };
    const offer = deal(sealed);
    if (stop(opened.length, offer, sealed)) return { multiplier: offer, steps: opened.length };
  }
}
