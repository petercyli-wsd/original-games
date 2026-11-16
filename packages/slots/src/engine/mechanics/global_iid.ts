// global_iid (pack: src/reelengine/mechanics/global_iid.py).
// Law: ONE iid multiplier draw per spin from value_pmf. 'per_spin' (default): drawn at S3, held
// across every cascade step; base wins and each paying step are scaled by M (scatter pays never).
// 'terminal_total': drawn at the terminal only if >= min_steps paying steps; extra
// Σ step_coins × (M-1) is awarded as "ROUND MULTIPLIER xM".
// Decor: mult (int; the drawn multiplier, 1 when not drawn).

import { emitDecor, type SpinCtx } from '../pipeline';
import { intPmf, MechanicPlugin, scaleWins } from './protocol';
import { register } from './registry';
import type { SpinWin } from '../types';

const ALLOWED = new Set(['value_pmf', 'apply', 'min_steps']);
const APPLY = ['per_spin', 'terminal_total'];

class GlobalIid extends MechanicPlugin {
  ID = 'global_iid';
  STAGE = 'post_multiplier' as const;
  DECOR_SCHEMA = { mult: 'int' } as const;
  APPLIES_TO = null;
  HAS_TERMINAL = true;
  values: number[] = [];
  cum: number[] = [];
  applyMode = 'per_spin';
  minSteps = 1;

  override init(): void {
    const p = this.params;
    const unknown = Object.keys(p).filter((k) => !ALLOWED.has(k)).sort();
    if (unknown.length) throw new Error(`global_iid: unknown params [${unknown.join(', ')}]`);
    const pmf = p.value_pmf;
    if (!pmf || typeof pmf !== 'object' || Array.isArray(pmf) || !Object.keys(pmf).length) {
      throw new Error('global_iid: value_pmf must be a non-empty {multiplier: weight} map');
    }
    for (const [v, w] of Object.entries(pmf as Record<string, unknown>)) {
      const iv = Number(v);
      if (!Number.isInteger(iv) || iv < 1 || typeof w !== 'number' || !Number.isInteger(w) || w <= 0) {
        throw new Error(`global_iid: value_pmf entry '${v}': ${String(w)} — multipliers >= 1, positive int weights`);
      }
    }
    [this.values, this.cum] = intPmf('global_iid: value_pmf', pmf, 1);
    const mode = p.apply === undefined ? 'per_spin' : p.apply;
    if (typeof mode !== 'string' || !APPLY.includes(mode)) throw new Error(`global_iid: apply ${JSON.stringify(mode)} not in ${APPLY.join(', ')}`);
    this.applyMode = mode;
    const ms = p.min_steps === undefined ? 1 : p.min_steps;
    if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 1) throw new Error('global_iid: min_steps must be an int >= 1');
    this.minSteps = ms;
  }

  override postTotal(ctx: SpinCtx): void {
    if (this.applyMode !== 'per_spin') return;
    const m = this.values[ctx.rng.pickWeighted(this.cum)];
    ctx.decor.set(this.decorKey('mult'), m);
    if (m !== 1 && ctx.wins.length) {
      ctx.wins = scaleWins(ctx.wins, m);
      ctx.lineTotal = ctx.lineTotal * m;
    }
  }

  override stepWins(ctx: SpinCtx, _k: number, wins: SpinWin[]): SpinWin[] {
    if (this.applyMode !== 'per_spin') return [...wins];
    const m = ctx.decor.has(this.decorKey('mult')) ? (ctx.decor.get(this.decorKey('mult')) as number) : 1;
    return scaleWins(wins, m);
  }

  override terminal(ctx: SpinCtx): void {
    if (this.applyMode !== 'terminal_total') return;
    const stepCoins = [ctx.lineTotal, ...ctx.steps.map((s) => s.stepCoins)];
    const paying = stepCoins.filter((c) => c > 0).length;
    const total = stepCoins.reduce((a, b) => a + b, 0);
    if (paying < this.minSteps || total <= 0) {
      emitDecor(ctx, this, 'mult', 1);
      return;
    }
    const m = this.values[ctx.rng.pickWeighted(this.cum)];
    emitDecor(ctx, this, 'mult', m);
    if (m !== 1) ctx.extras.push({ label: `ROUND MULTIPLIER x${m}`, coins: total * (m - 1) });
  }
}

register('global_iid', 'post_multiplier', GlobalIid);
