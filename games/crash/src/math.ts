// Crash (Stake, Roobet, BC.Game, Rollbit, Shuffle): a multiplier climbs along
// m(t) = e^(0.00006·t) (t in ms) until it crashes at a point C fixed at the
// moment the bet is placed. Cash out before the crash and you win the
// multiplier on screen.
//
// The crash point. Work in cents (1.00× = 100). From one uniform U in [0, 1):
//
//     C = min(CAP, floor(99 / U))            (CAP = 100,000,000 = 1,000,000×)
//
// For every whole-cent level k with 99 ≤ k ≤ CAP,
//
//     P(C ≥ k) = P(99 / U ≥ k) = P(U ≤ 99 / k) = 99 / k,          (exact)
//
// because floor(y) ≥ k ⟺ y ≥ k for an integer k. So P(C ≥ x) = 0.99 / x for
// every multiplier x on the 0.01 grid, and C < 1.00 (an instant crash, shown
// as 1.00×) has probability exactly 1%.
//
// Tie rule. The curve shows C itself and crashes only when it would pass C:
// a cash-out at k (manual click or auto target) wins if and only if C ≥ k.
//
// RTP. Cashing out at k pays k/100 with probability 99/k, i.e. exactly 0.99.
// The value of "still flying at k", V(k) = k/100, is a martingale in k:
// V(k+1)·P(C ≥ k+1 | C ≥ k) = (k+1)/100 · k/(k+1) = V(k). By optional stopping
// every cash-out rule (fixed target, random click time, panic on a dip…)
// returns exactly RTP = 99%. At the cap the round auto-cashes at 1,000,000×
// (a stopping rule, so the RTP is unchanged): P(C ≥ CAP) = 99/10^8, paying 10^6.
//
// The clock never matters for the maths: time only decides which cent level
// the curve is at, and the crash time is t_C = ln((C+1)/100) / 0.00006.

export const RTP = 0.99;

/** Growth rate of the curve, per millisecond: m(t) = e^(RATE·t). */
export const RATE = 0.00006;

/** Crash points and targets are kept in cents (1.00× = 100). */
export const CAP = 100_000_000;
export const MAX_MULTIPLIER = CAP / 100;
/** Lowest auto cash-out target (1.01×) and highest (the cap). */
export const MIN_TARGET = 101;
export const MAX_TARGET = CAP;

/** The crash point in cents from one uniform draw; 99 means an instant crash. */
export function crashCents(u: number): number {
  if (!(u > 0)) return CAP;
  return Math.min(CAP, Math.floor(99 / u));
}

/** P(C ≥ k): the exact chance that the curve reaches k cents. */
export const reachChance = (k: number) => (k <= 99 ? 1 : Math.min(1, 99 / k));

/** Chance of winning with an auto cash-out at `target` cents. */
export const winChance = (target: number) => reachChance(target);

/** Payout multiplier for a cash-out at k cents (paid when C ≥ k). */
export const payoutOf = (target: number, crash: number) => (crash >= target ? target / 100 : 0);

/** Multiplier on the curve after tau ms of flight. */
export const multAt = (tau: number) => Math.exp(RATE * Math.max(0, tau));

/** Whole cents shown on the curve after tau ms (never below 100). */
export const centsAt = (tau: number) => Math.max(100, Math.floor(100 * multAt(tau) + 1e-9));

/** Flight time (ms) until the curve reaches multiplier x. */
export const timeTo = (x: number) => Math.log(Math.max(1, x)) / RATE;

/** Flight time (ms) at which a round with crash point C ends (crash, or the cap's auto cash-out). */
export const endTime = (crash: number) => (crash >= CAP ? timeTo(MAX_MULTIPLIER) : timeTo((crash + 1) / 100));

/** Flight time (ms) at which an auto cash-out at `target` cents fires. */
export const targetTime = (target: number) => timeTo(target / 100);

/**
 * What a cash-out at flight time tau pays, in cents, or 0 if the curve had
 * already crashed. Rounded down to the cent shown; 0 if C is below it.
 */
export function cashAt(tau: number, crash: number): number {
  if (tau >= endTime(crash)) return crash >= CAP ? CAP : 0;
  // Wins exactly when C ≥ the cent shown, so a click is the same bet as a target.
  const k = centsAt(tau);
  return k <= crash ? k : 0;
}

export type RoundEnd = { kind: 'cashed'; cents: number } | { kind: 'crashed' } | { kind: 'max'; cents: number };

/** How a round with an auto cash-out at `target` cents (or none) ends if nobody clicks. */
export function autoEnd(target: number | null, crash: number): RoundEnd {
  if (target !== null && crash >= target) return { kind: 'cashed', cents: target };
  if (crash >= CAP) return { kind: 'max', cents: CAP };
  return { kind: 'crashed' };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Clamps a typed target multiplier to the 0.01 grid and the allowed range; returns cents. */
export function clampTarget(x: number): number {
  if (!Number.isFinite(x)) return 200;
  return Math.min(MAX_TARGET, Math.max(MIN_TARGET, Math.round(round2(x) * 100)));
}

/** Target (cents) for a desired win chance in percent. */
export const targetForChance = (pct: number) => clampTarget(99 / Math.max(1e-9, pct));

/** A crash point in cents, as shown (an instant crash reads 1.00×). */
export const shownCrash = (crash: number) => Math.max(100, crash) / 100;

/** Displays a multiplier with 2 decimals and thousands separators. */
export function fmtX(x: number): string {
  return x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '×';
}

/** Size band of a crash point, for colouring the history row. */
export function band(crash: number): 'low' | 'mid' | 'high' | 'moon' {
  if (crash < 200) return 'low';
  if (crash < 1000) return 'mid';
  if (crash < 10000) return 'high';
  return 'moon';
}

export type Level = 'low' | 'medium' | 'high' | 'extreme';

export function levelOf(target: number): Level {
  if (target <= 200) return 'low';
  if (target <= 1000) return 'medium';
  if (target <= 10000) return 'high';
  return 'extreme';
}

/** The next round-number milestone strictly above k cents, for the live chance bar. */
export function nextMilestone(k: number): number {
  const steps = [1.5, 2, 3, 5];
  for (let scale = 1; scale <= MAX_MULTIPLIER; scale *= 10) {
    for (const s of scale === 1 ? steps : [1, 2, 5]) {
      const c = Math.round(s * scale * 100);
      if (c > k) return Math.min(CAP, c);
    }
  }
  return CAP;
}
