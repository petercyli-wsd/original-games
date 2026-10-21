// Amounts are kept to 8 decimal places (crypto-style) and always rounded down,
// so floating-point noise can never pay out more than the maths allows.

const SCALE = 1e8;

export const floor8 = (x: number) => Math.floor(x * SCALE + 1e-6) / SCALE;

export const formatAmount = (x: number, decimals = 8) => x.toFixed(decimals);
export const formatMultiplier = (x: number) => x.toFixed(2) + '×';
export const formatPercent = (x: number, digits = 1) => (x * 100).toFixed(digits) + '%';
