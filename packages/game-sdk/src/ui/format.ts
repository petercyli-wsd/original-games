// Display formatting for kit-based games.

/** 1.234 → "1.23×". */
export const fmtMult = (x: number) => (x >= 1000 ? Math.round(x).toLocaleString('en-US') : x.toFixed(2)) + '×';

/** A probability as a percentage, with more digits when it's small. */
export function fmtChance(p: number): string {
  if (p <= 0) return '0%';
  if (p >= 1) return '100%';
  const pct = p * 100;
  if (pct < 0.1) return pct.toPrecision(2) + '%';
  if (pct < 10) return pct.toFixed(2) + '%';
  return pct.toFixed(1) + '%';
}

/** A probability as "1 in N", for odds that are easier to read that way. */
export const fmtOneIn = (p: number) => (p <= 0 ? 'never' : p >= 1 ? 'certain' : `1 in ${(1 / p).toFixed(1 / p >= 100 ? 0 : 1)}`);
