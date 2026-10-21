// Display formatting shared by the components.

export const fmtMult = (m: number) => m.toFixed(2) + '×';
export const fmtPct = (p: number, digits = 1) => (p * 100).toFixed(digits) + '%';
/** A position on a W-step track as a win chance: whole percents unless W doesn't divide 100. */
export const fmtChance = (x: number, W: number) => fmtPct(x / W, Number.isInteger(100 / W) ? 0 : 1);
export const fmtAmt = (x: number) => x.toFixed(2);
/** Compact multiplier for tight spaces: 9.9×, 99×. */
export const fmtMultShort = (m: number) => +m.toFixed(2) + '×';
