// global_additive (post_multiplier). Pack: src/slotlab/kernel/mech.py GlobalAdditiveHook, wrapped by
// src/reelengine/mechanics/legacy_hooks.py (decor gwm: int, wildMults: moneyMap).
// Law: one iid draw (value_pmf) per VISIBLE wild cell of the final board in (col,row) order;
// gwm = base + sum(draws); every line win and the line total are multiplied by gwm (scatter pay is
// not). step_wins/step_factor are not overridden by the legacy wrapper (default: factor 1).

import { emitDecor, type SpinCtx } from '../pipeline';
import { MechanicPlugin, type Params, type Stage } from './protocol';
import { register } from './registry';

export class GlobalAdditive extends MechanicPlugin {
  override ID = 'global_additive';
  override STAGE: Stage = 'post_multiplier';
  override DECOR_SCHEMA = { gwm: 'int', wildMults: 'moneyMap' } as const;
  override RAGGED_OK = false;

  values: number[] = [];
  cum: number[] = [];
  base = 0;

  override init(): void {
    const params: Params = this.params;
    const unknown = Object.keys(params).filter((k) => k !== 'value_pmf' && k !== 'base').sort();
    if (unknown.length) throw new Error(`global_additive: unknown params ${JSON.stringify(unknown)} (allowed: ["base","value_pmf"])`);
    const pmf = params.value_pmf;
    if (!pmf || typeof pmf !== 'object' || Array.isArray(pmf) || !Object.keys(pmf).length) throw new Error('global_additive: value_pmf must be a non-empty {value: weight} map');
    const items: [number, number][] = [];
    for (const [k, wt] of Object.entries(pmf as Record<string, unknown>)) {
      const v = Number(k);
      if (k.trim() === '' || !Number.isInteger(v)) throw new Error(`global_additive: value_pmf key '${k}' must be int-castable`);
      if (v < 0) throw new Error(`global_additive: value_pmf value '${k}' must be >= 0`);
      if (typeof wt !== 'number' || !Number.isInteger(wt) || wt <= 0) throw new Error(`global_additive: value_pmf weight for '${k}' must be a positive int`);
      items.push([v, wt]);
    }
    const base = params.base;
    if (typeof base !== 'number' || !Number.isInteger(base) || base < 0) throw new Error(`global_additive: base must be an int >= 0, got ${JSON.stringify(base)}`);
    if (!this.engine.wilds.size) throw new Error('global_additive: no wilds declared (no mults to draw)');
    items.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    this.values = items.map(([v]) => v);
    let acc = 0;
    this.cum = items.map(([, w]) => (acc += w));
    this.base = base;
  }

  override postTotal(ctx: SpinCtx): void {
    const wilds = this.engine.wilds;
    let g = this.base;
    const mults: Array<[[number, number], number]> = [];
    for (let c = 0; c < this.engine.cols; c++) {
      const col = ctx.board[c];
      for (let r = 0; r < col.length; r++) {
        if (wilds.has(col[r])) {
          const v = this.values[ctx.rng.pickWeighted(this.cum)];
          g += v;
          mults.push([[c, r], v]);
        }
      }
    }
    ctx.wins = ctx.wins.map((w) => ({ label: w.label, coins: w.coins * g, cells: w.cells, ways: w.ways, lineIdx: w.lineIdx }));
    ctx.lineTotal = ctx.lineTotal * g;
    emitDecor(ctx, this, 'gwm', g);
    if (mults.length) emitDecor(ctx, this, 'wildMults', mults);
  }
}

register('global_additive', 'post_multiplier', GlobalAdditive);
