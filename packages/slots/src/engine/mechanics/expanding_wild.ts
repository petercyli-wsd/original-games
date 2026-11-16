// expanding_wild. Pack: src/reelengine/mechanics/legacy_hooks.py (wrapper) + src/slotlab/kernel/mech.py ExpandingWildHook.
// Law: a wild visible anywhere in an eligible reel's window turns the whole column into the first wild id
// (before evaluation). No RNG. Decor expandedReels = the expanded reel indices (omitted when none).

import { firstOfSet } from '../evaluators';
import { emitDecor, type SpinCtx } from '../pipeline';
import type { DecorSchema } from '../canonical';
import { MechanicPlugin, type Params } from './protocol';
import { register } from './registry';

const ALLOWED = ['badge_set', 'badge_tables_diverge', 'badge_pmf', 'expand_law', 'expand_reels'];

export class ExpandingWild extends MechanicPlugin {
  override ID = 'expanding_wild';
  override STAGE = 'board_transform' as const;
  override DECOR_SCHEMA: DecorSchema = { expandedReels: 'intList' };
  override RAGGED_OK = true;
  override APPLIES_TO = null;
  private eligible = new Set<number>();

  override init(): void {
    const p: Params = this.params;
    const unknown = Object.keys(p).filter((k) => !ALLOWED.includes(k)).sort();
    if (unknown.length) throw new Error(`expanding_wild: unknown params ${JSON.stringify(unknown)}`);
    if (p.expand_law !== 'full_column_on_visible_wild') throw new Error(`expanding_wild: unsupported expand_law ${JSON.stringify(p.expand_law)}`);
    if ('badge_pmf' in p) throw new Error('badge_pmf not executable in P2a');
    const reels = p.expand_reels;
    const cols = this.engine.cols;
    if (reels === undefined || reels === null) {
      this.eligible = new Set(Array.from({ length: cols }, (_, i) => i));
    } else {
      if (!(Array.isArray(reels) && reels.every((x) => typeof x === 'number' && Number.isInteger(x)))) throw new Error('expanding_wild: expand_reels must be an int list');
      const bad = (reels as number[]).filter((x) => !(x >= 0 && x < cols));
      if (bad.length) throw new Error(`expanding_wild: expand_reels indices out of range 0..${cols - 1}: ${JSON.stringify(bad)}`);
      this.eligible = new Set(reels as number[]);
    }
    if (!this.engine.wilds.size) throw new Error('expanding_wild: no wilds declared (nothing can expand)');
    if (this.engine.scatter !== null && this.engine.wilds.has(this.engine.scatter)) throw new Error('expanding_wild: scatter id equals a wild id');
  }

  override apply(ctx: SpinCtx): void {
    const wilds = this.engine.wilds;
    const wildId = firstOfSet(wilds);
    const expanded: number[] = [];
    const out = ctx.board.map((col, c) => {
      if (this.eligible.has(c) && col.some((v) => wilds.has(v))) {
        expanded.push(c);
        return col.map(() => wildId);
      }
      return [...col];
    });
    ctx.board = out;
    if (expanded.length) emitDecor(ctx, this, 'expandedReels', expanded);
  }
}

register('expanding_wild', 'board_transform', ExpandingWild);
