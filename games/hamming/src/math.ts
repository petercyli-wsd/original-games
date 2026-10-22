// Hamming: a 4-bit message is encoded as a Hamming(7,4) codeword and its 7
// bits cross a noisy channel one at a time. Each bit flips independently with
// probability p. Hamming(7,4) is a perfect single-error-correcting code: the
// three parity checks (the circles of the Venn diagram) give a 3-bit syndrome
// that names the flipped position, so the decoder recovers the message
// exactly when at most one of the 7 bits flipped. Hence
//
//   D(p) = P(block decodes) = (1 − p)^7 + 7p(1 − p)^6,
//
// and k independent blocks in a series all decode with probability D^k.
// You bet Decoded (P = D^k) or Fooled (P = 1 − D^k).
//
// Live odds. Mid-block, with f flips so far and r bits still to cross, the
// block decodes with probability
//   f = 0: (1 − p)^r + r p (1 − p)^(r − 1),   f = 1: (1 − p)^r,   f ≥ 2: 0,
// and the m later blocks contribute D^m. These are exact, and they satisfy
// P(S) = (1 − p) P(S + clean bit) + p P(S + flipped bit).
//
// Pricing (fixed prize): a full win pays prize = RTP / P(win at the start),
// and the cash-out is prize × P(win | S). That is a martingale starting at
// RTP, so every stopping rule (one bit at a time, a block at a time, any
// threshold) returns exactly RTP. Picking a side is made before the bet and
// only changes volatility. The cash-out never exceeds the prize, so the max
// multiplier is RTP / (the smallest starting chance on offer).

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const BITS = 7;

/** Flip chance per bit, in percent. */
export const NOISES = [2, 5, 10, 20, 30] as const;
export type Noise = (typeof NOISES)[number];

/** Blocks sent in a series. */
export const BLOCKS = [1, 2, 3, 4] as const;
export type Blocks = (typeof BLOCKS)[number];

export type Side = 'decoded' | 'fooled';
export const SIDES: Side[] = ['decoded', 'fooled'];

export interface Settings {
  side: Side;
  noise: Noise;
  blocks: Blocks;
}

export const VOLATILITY: Record<Volatility, Settings> = {
  low: { side: 'decoded', noise: 5, blocks: 2 },
  medium: { side: 'decoded', noise: 20, blocks: 2 },
  high: { side: 'fooled', noise: 5, blocks: 1 },
  extreme: { side: 'fooled', noise: 2, blocks: 1 },
};

/** Chance one block decodes: at most one of its 7 bits flips. */
export function blockChance(noise: Noise): number {
  const p = noise / 100;
  return (1 - p) ** 7 + 7 * p * (1 - p) ** 6;
}

/** Chance the current block decodes, given its flips so far and bits still to cross. */
export function blockChanceFrom(noise: Noise, flips: number, left: number): number {
  const p = noise / 100;
  if (flips >= 2) return 0;
  if (flips === 1) return (1 - p) ** left;
  return (1 - p) ** left + (left > 0 ? left * p * (1 - p) ** (left - 1) : 0);
}

/**
 * Where the round is. `block` is the index of the block on the wire (0-based),
 * `sent` how many of its bits have crossed (0..7) and `flips` how many of
 * those flipped. A finished clean block (sent = 7, flips ≤ 1) is the same
 * state as the next block with nothing sent.
 */
export interface State {
  block: number;
  sent: number;
  flips: number;
}

export const START: State = { block: 0, sent: 0, flips: 0 };

/** The decode chance of every block, as drawn on the board's block bars. */
export function blockBars(s: Settings, st: State): number[] {
  const d = blockChance(s.noise);
  return Array.from({ length: s.blocks }, (_, i) =>
    i < st.block ? 1 : i === st.block ? blockChanceFrom(s.noise, st.flips, BITS - st.sent) : d,
  );
}

/** Chance every block decodes from state st. */
export function decodeChance(s: Settings, st: State): number {
  if (st.flips >= 2) return 0;
  const later = s.blocks - st.block - 1;
  return blockChanceFrom(s.noise, st.flips, BITS - st.sent) * blockChance(s.noise) ** later;
}

/** Chance the bet side wins from state st. */
export const winChance = (s: Settings, st: State = START) => (s.side === 'decoded' ? decodeChance(s, st) : 1 - decodeChance(s, st));

/** The full prize for these settings. */
export const prizeFor = (s: Settings) => RTP / winChance(s, START);

/** Cash-out value (as a multiplier of the stake) at state st. */
export const cashAt = (s: Settings, st: State) => prizeFor(s) * winChance(s, st);

/** Whether the round is settled: a block failed, or every block crossed. */
export const decided = (s: Settings, st: State) => st.flips >= 2 || (st.block === s.blocks - 1 && st.sent === BITS);

/** The state after one more bit crosses. */
export function sendBit(st: State, flipped: boolean): State {
  const base = st.sent === BITS ? { block: st.block + 1, sent: 0, flips: 0 } : st;
  return { block: base.block, sent: base.sent + 1, flips: base.flips + (flipped ? 1 : 0) };
}

/** Bits left before the current block finishes (a finished block means a whole new one). */
export const bitsToBlockEnd = (st: State) => (st.sent === BITS ? BITS : BITS - st.sent);

export function volatilityOf(s: Settings): Volatility {
  const p = winChance(s);
  return p > 0.5 ? 'low' : p > 0.12 ? 'medium' : p > 0.025 ? 'high' : 'extreme';
}

export const ALL_SETTINGS: Settings[] = SIDES.flatMap((side) =>
  NOISES.flatMap((noise) => BLOCKS.map((blocks) => ({ side, noise, blocks }))),
);

/** Any payout is at most the prize, and the largest prize is RTP over the smallest starting chance. */
export const MAX_MULTIPLIER = Math.max(...ALL_SETTINGS.map(prizeFor));

// ---------------------------------------------------------------------------
// The code itself (used for the board and to check the theorem).

/** Hamming(7,4) codeword for 4 data bits: positions 1..7, parity at 1, 2, 4. */
export function encode(data: readonly number[]): number[] {
  const [d1, d2, d3, d4] = data;
  const p1 = d1 ^ d2 ^ d4;
  const p2 = d1 ^ d3 ^ d4;
  const p3 = d2 ^ d3 ^ d4;
  return [p1, p2, d1, p3, d2, d3, d4];
}

/** XOR of the (1-based) positions holding a 1: zero for a codeword, else the position of a single flip. */
export function syndrome(bits: readonly number[]): number {
  let s = 0;
  bits.forEach((b, i) => {
    if (b) s ^= i + 1;
  });
  return s;
}

/** The syndrome of the flips themselves: which parity circles (bit 0 = A, 1 = B, 2 = C) are broken. */
export function flipSyndrome(flipped: readonly boolean[]): number {
  let s = 0;
  flipped.forEach((f, i) => {
    if (f) s ^= i + 1;
  });
  return s;
}

/** Syndrome decoding: flip the named position, read the data positions 3, 5, 6, 7. */
export function decode(received: readonly number[]): { data: number[]; corrected: number } {
  const s = syndrome(received);
  const bits = [...received];
  if (s) bits[s - 1] ^= 1;
  return { data: [bits[2], bits[4], bits[5], bits[6]], corrected: s };
}

/** Which of the 7 positions each parity circle checks. */
export const CIRCLE_OF = (pos: number) => [pos & 1, (pos >> 1) & 1, (pos >> 2) & 1];

/** Whether syndrome decoding of the received word gives back the sent data. */
export const recovers = (received: readonly number[], data: readonly number[]) =>
  decode(received).data.every((b, i) => b === data[i]);
