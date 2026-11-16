// per_wild_sum (eval_variant). Pack: src/slotlab/kernel/mech.py PerWildSumHook, wrapped by
// src/reelengine/mechanics/legacy_hooks.py (decor wildBadges: moneyMap).
// Law: preDraws draws one iid badge (badge_pmf) per VISIBLE wild cell in (col,row) order; per line the
// factor is the sum of badges of the wild cells inside the winning head run (1 if none); an own-pay
// line (head null) takes factor 1. The base line law is the untouched kernel eval_line.

import { evalLine } from '../evaluators';
import { emitDecor, type SpinCtx } from '../pipeline';
import { MechanicPlugin, type Params, type Stage } from './protocol';
import { register } from './registry';
import type { SymsLineFn } from '../evaluators';

export class PerWildSum extends MechanicPlugin {
  override ID = 'per_wild_sum';
  override STAGE: Stage = 'eval_variant';
  override DECOR_SCHEMA = { wildBadges: 'moneyMap' } as const;
  override APPLIES_TO = ['payline'];
  override DEFAULT_VARIANT_ONLY = true;
  override RAGGED_OK = false;

  values: number[] = [];
  cum: number[] = [];

  override init(): void {
    const params: Params = this.params;
    const unknown = Object.keys(params).filter((k) => k !== 'badge_pmf' && k !== 'apply').sort();
    if (unknown.length) throw new Error(`per_wild_sum: unknown params ${JSON.stringify(unknown)} (allowed: ["apply","badge_pmf"])`);
    if (params.apply !== 'sum_of_wild_badges_in_run') throw new Error(`per_wild_sum: unsupported apply ${JSON.stringify(params.apply)} (only 'sum_of_wild_badges_in_run' is executable)`);
    const pmf = params.badge_pmf;
    if (!pmf || typeof pmf !== 'object' || Array.isArray(pmf) || !Object.keys(pmf).length) throw new Error('per_wild_sum: badge_pmf must be a non-empty {value: weight} map');
    const items: [number, number][] = [];
    for (const [k, wt] of Object.entries(pmf as Record<string, unknown>)) {
      const v = Number(k);
      if (k.trim() === '' || !Number.isInteger(v)) throw new Error(`per_wild_sum: badge_pmf key '${k}' must be int-castable`);
      if (v < 1) throw new Error(`per_wild_sum: badge_pmf value '${k}' must be >= 1`);
      if (typeof wt !== 'number' || !Number.isInteger(wt) || wt <= 0) throw new Error(`per_wild_sum: badge_pmf weight for '${k}' must be a positive int`);
      items.push([v, wt]);
    }
    if (!this.engine.wilds.size) throw new Error('per_wild_sum: no wilds declared (no badges to draw)');
    items.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    this.values = items.map(([v]) => v);
    let acc = 0;
    this.cum = items.map(([, w]) => (acc += w));
  }

  override preDraws(ctx: SpinCtx): Map<string, number> {
    const draws = new Map<string, number>();
    const decor: Array<[[number, number], number]> = [];
    const wilds = this.engine.wilds;
    for (let c = 0; c < this.engine.cols; c++) {
      const col = ctx.board[c];
      for (let r = 0; r < col.length; r++) {
        if (wilds.has(col[r])) {
          const v = this.values[ctx.rng.pickWeighted(this.cum)];
          draws.set(`${c},${r}`, v);
          decor.push([[c, r], v]);
        }
      }
    }
    if (decor.length) emitDecor(ctx, this, 'wildBadges', decor);
    return draws;
  }

  override lineEval(cells: [number, number, number][], draws: unknown, _inner: SymsLineFn | null): [number, number, number | null] {
    const e = this.engine;
    const [coins, ln, head] = evalLine(cells.map((x) => x[2]), e.paytable, e.wilds, e.wildOwn);
    if (!coins || head === null) return [coins, ln, head];
    const d = draws as Map<string, number>;
    let factor = 0;
    for (let i = 0; i < ln; i++) {
      const [c, r, sym] = cells[i];
      if (e.wilds.has(sym)) factor += d.get(`${c},${r}`) ?? 0;
    }
    if (factor === 0) return [coins, ln, head];
    return [coins * factor, ln, head];
  }
}

register('per_wild_sum', 'eval_variant', PerWildSum);
