// walking_wild (pack: src/reelengine/mechanics/walking_wild.py).
// Law: ONE categorical draw per spin picks a column from placement_pmf; that whole column becomes
// the wild BEFORE evaluation and the scatter count. "Walking" is presentation: no cross-spin state.
// Decor: walker (int column).

import { firstOfSet } from '../evaluators';
import { emitDecor, type SpinCtx } from '../pipeline';
import { cumThresholds } from '../rng';
import { MechanicPlugin } from './protocol';
import { register } from './registry';

const ALLOWED = new Set(['placement_pmf', 'wild_symbol']);
const REFUSED: Record<string, string> = {
  p_persist: 'walking_wild has no cross-spin state (the walk is presentation)',
  movement: 'a moving wild is the moving_wild_respin continuation, not walking_wild',
};

class WalkingWild extends MechanicPlugin {
  ID = 'walking_wild';
  STAGE = 'board_transform' as const;
  DECOR_SCHEMA = { walker: 'int' } as const;
  APPLIES_TO = null;
  columns: number[] = [];
  weights: number[] = [];
  cum: number[] = [];
  wild = 0;

  override init(): void {
    const p = this.params;
    for (const k of Object.keys(REFUSED)) if (k in p) throw new Error(`walking_wild: '${k}' refused — ${REFUSED[k]}`);
    const unknown = Object.keys(p).filter((k) => !ALLOWED.has(k)).sort();
    if (unknown.length) throw new Error(`walking_wild: unknown params [${unknown.join(', ')}]`);
    const pmf = p.placement_pmf;
    if (!pmf || typeof pmf !== 'object' || Array.isArray(pmf) || !Object.keys(pmf).length) {
      throw new Error('walking_wild: placement_pmf must be a non-empty {column: weight} map');
    }
    const items: [number, number][] = [];
    for (const [k, w] of Object.entries(pmf as Record<string, unknown>)) {
      const c = Number(k);
      if (!Number.isInteger(c)) throw new Error(`walking_wild: column '${k}' is not an int`);
      if (!(c >= 0 && c < this.engine.cols)) throw new Error(`walking_wild: column '${k}' outside 0..${this.engine.cols - 1}`);
      if (typeof w !== 'number' || !Number.isInteger(w) || w <= 0) throw new Error(`walking_wild: weight for column '${k}' must be a positive int`);
      items.push([c, w]);
    }
    items.sort((a, b) => a[0] - b[0]);
    this.columns = items.map(([c]) => c);
    this.weights = items.map(([, w]) => w);
    this.cum = cumThresholds(this.weights);
    let wild = p.wild_symbol as number | null | undefined;
    if (wild === undefined || wild === null) {
      if (!this.engine.wilds.size) throw new Error('walking_wild: no wilds declared and no wild_symbol given');
      wild = firstOfSet(this.engine.wilds);
    } else if (!this.engine.wilds.has(wild)) {
      throw new Error(`walking_wild: wild_symbol ${wild} is not a declared wild`);
    }
    this.wild = wild;
  }

  override apply(ctx: SpinCtx): void {
    const j = this.columns[ctx.rng.pickWeighted(this.cum)];
    ctx.board = ctx.board.map((col, c) => (c === j ? col.map(() => this.wild) : col));
    emitDecor(ctx, this, 'walker', j);
  }
}

register('walking_wild', 'board_transform', WalkingWild);
