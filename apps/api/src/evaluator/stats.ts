// Small statistics for comparing AI scores with human reviews.

/** Ranks with ties sharing their average rank (1-based). */
function ranks(xs: number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = avg;
    i = j + 1;
  }
  return out;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Spearman rank correlation; null with fewer than 3 pairs or no variation. */
export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null;
  return pearson(ranks(xs), ranks(ys));
}

export function meanAbsError(xs: number[], ys: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((sum, x, i) => sum + Math.abs(x - ys[i]), 0) / xs.length;
}

/**
 * Non-negative weights that best predict `y` from the feature columns of `X`
 * (ridge regression on centred data, negatives clamped to 0), scaled so the
 * largest weight is 3. Returns null when there is too little data.
 */
export function fitWeights(X: number[][], y: number[], keys: string[], lambda = 1): Record<string, number> | null {
  const n = X.length;
  const p = keys.length;
  if (n < 8) return null;
  const mean = (col: number) => X.reduce((s, row) => s + row[col], 0) / n;
  const mx = keys.map((_, j) => mean(j));
  const my = y.reduce((a, b) => a + b, 0) / n;
  const Xc = X.map((row) => row.map((v, j) => v - mx[j]));
  const yc = y.map((v) => v - my);

  // Solve (XᵀX + λI) w = Xᵀy by Gaussian elimination.
  const A = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) => Xc.reduce((s, row) => s + row[i] * row[j], 0) + (i === j ? lambda : 0)),
  );
  const b = Array.from({ length: p }, (_, i) => Xc.reduce((s, row, r) => s + row[i] * yc[r], 0));
  for (let col = 0; col < p; col++) {
    let pivot = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    if (Math.abs(A[col][col]) < 1e-12) continue;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c < p; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const w = b.map((v, i) => (Math.abs(A[i][i]) < 1e-12 ? 0 : Math.max(0, v / A[i][i])));
  const top = Math.max(...w);
  if (top <= 0) return null;
  return Object.fromEntries(keys.map((k, i) => [k, Math.round((w[i] / top) * 3 * 100) / 100]));
}
