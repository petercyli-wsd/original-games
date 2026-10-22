import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { FAMILIES, GENERATIONS, POP_CAP, sampleChildren } from './math';
import { aliveMask, growTree, seedTree } from './tree';

const rng = createRng(seededSource(5));

describe('Branching tree layout', () => {
  it('keeps every generation in cyclic order, so branches never cross', () => {
    for (const family of FAMILIES) {
      for (const gens of GENERATIONS) {
        for (let trial = 0; trial < 40; trial++) {
          let tree = seedTree();
          for (let g = 1; g <= gens; g++) {
            const front = tree[tree.length - 1];
            if (front.length === 0 || front.length > POP_CAP) break;
            tree = growTree(tree, front.map(() => sampleChildren(family, rng.next())), gens);
            const born = tree[g];
            for (let i = 1; i < born.length; i++) {
              expect(born[i].angle).toBeGreaterThan(born[i - 1].angle);
              expect(born[i].parent).toBeGreaterThanOrEqual(born[i - 1].parent);
            }
            if (born.length > 1) expect(born[born.length - 1].angle - born[0].angle).toBeLessThan(2 * Math.PI);
          }
        }
      }
    }
  });

  it('marks a node alive exactly when it has a descendant in the newest generation', () => {
    let tree = seedTree();
    tree = growTree(tree, [3], 5);
    tree = growTree(tree, [0, 2, 1], 5);
    tree = growTree(tree, [0, 0, 1], 5);
    const mask = aliveMask(tree);
    expect(mask[0]).toEqual([true]);
    expect(mask[1]).toEqual([false, false, true]);
    expect(mask[2]).toEqual([false, false, true]);
    expect(mask[3]).toEqual([true]);
  });
});
