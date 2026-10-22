// The family tree as drawn: generation g sits on a ring of radius R·g/G
// around the seed, and the goal ring (generation G) is the outermost. This is
// display only; the odds never depend on where a node is drawn.

export interface TreeNode {
  /** Index of the parent in the previous generation (-1 for the seed). */
  parent: number;
  /** Angle on its ring, in radians (screen coordinates, −π/2 is the top). */
  angle: number;
  /** Children it had, or -1 while that generation hasn't been grown. */
  kids: number;
}

/** tree[g] holds generation g; tree[0] is the seed. */
export type Tree = TreeNode[][];

/** Radius of the goal ring, in SVG units. */
export const R = 178;

export const ringRadius = (g: number, gens: number) => (R * g) / gens;

/** Node size for a board with this many rings. */
export const nodeRadius = (gens: number) => (gens <= 3 ? 8 : gens <= 5 ? 7 : gens <= 8 ? 5.5 : 4.4);

/** Preferred spacing between neighbours on a ring, in node radii. */
const SPACING = 3.6;

export const seedTree = (): Tree => [[{ parent: -1, angle: -Math.PI / 2, kids: -1 }]];

/**
 * Pushes neighbours apart (keeping their cyclic order) until every gap is at
 * least `gap`. The total is 2π, so this is solvable while n·gap < 2π.
 */
function relax(a: number[], gap: number) {
  const n = a.length;
  if (n < 2) return;
  for (let it = 0; it < 600; it++) {
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const next = j === 0 ? a[0] + 2 * Math.PI : a[j];
      const d = next - a[i];
      if (d < gap) {
        const push = (gap - d) / 2;
        a[i] -= push;
        a[j] += push;
        worst = Math.max(worst, gap - d);
      }
    }
    if (worst < 1e-4) break;
  }
}

/** Records how many children each frontier node had and lays out the new generation. */
export function growTree(tree: Tree, kids: number[], gens: number): Tree {
  const g = tree.length;
  const parents = tree[g - 1].map((n, i) => ({ ...n, kids: kids[i] }));
  const n = kids.reduce((a, b) => a + b, 0);
  const born: TreeNode[] = [];
  if (n > 0) {
    const r = ringRadius(g, gens);
    const pref = SPACING * nodeRadius(gens);
    const gap = Math.min(pref / r, (0.97 * 2 * Math.PI) / n);
    const want: number[] = [];
    parents.forEach((p, i) => {
      const k = kids[i];
      // The seed's children spread evenly; later ones fan out from their parent.
      const spread = g === 1 ? (2 * Math.PI) / Math.max(k, 1) : gap * 1.15;
      // Parent angles are stored increasing (unwrapped), so offsets from them
      // keep the new generation in the same cyclic order: no crossings.
      for (let j = 0; j < k; j++) {
        const a = p.angle + (j - (k - 1) / 2) * spread;
        want.push(a);
        born.push({ parent: i, angle: a, kids: -1 });
      }
    });
    // As the ring fills up, pull the generation towards an even spread (kept
    // in order and rotated to sit as close to the parents as possible), so a
    // big family fills the disc instead of piling up on one side.
    const crowd = Math.min(1, (n * pref) / (2 * Math.PI * r));
    const w = Math.min(1, 1.6 * crowd) ** 1.5;
    if (n > 1 && w > 0) {
      const step = (2 * Math.PI) / n;
      const offset = want.reduce((acc, a, i) => acc + a - i * step, 0) / n;
      for (let i = 0; i < n; i++) want[i] += w * (offset + i * step - want[i]);
    }
    relax(want, gap);
    born.forEach((b, i) => (b.angle = want[i]));
  }
  return [...tree.slice(0, -1), parents, born];
}

/** Which nodes still have a descendant in the newest generation. */
export function aliveMask(tree: Tree): boolean[][] {
  const mask = tree.map((gen) => gen.map(() => false));
  const last = tree.length - 1;
  mask[last] = tree[last].map(() => true);
  for (let g = last; g >= 1; g--) tree[g].forEach((node, i) => mask[g][i] && (mask[g - 1][node.parent] = true));
  return mask;
}
