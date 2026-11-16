// cascade_step_ladder (pack: src/reelengine/mechanics/cascade_step_ladder.py).
// Law: the wins of paying step k (0 = base board, 1.. = the cascade's paying steps) are multiplied by
// ladder[min(k, len-1)] (beyond 'repeat_last'), or past the last rung by min(cap, last + (k-(n-1)))
// (beyond 'increment', cap required). Zero draws; resets every round; scatter pays never multiplied.
// index 'paying_screens' reads ctx.payingScreens instead of the step index.
// Decor: stepMults (intList), the factor applied to each paying step in order, base first.

import { emitDecor, type SpinCtx } from '../pipeline';
import { MechanicPlugin } from './protocol';
import { register } from './registry';
import type { SpinWin } from '../types';

const ALLOWED = new Set(['ladder', 'beyond', 'cap', 'index']);
const INDEX = ['continuation_steps', 'paying_screens'];
const BEYOND = ['repeat_last', 'increment'];

class CascadeStepLadder extends MechanicPlugin {
  ID = 'cascade_step_ladder';
  STAGE = 'post_multiplier' as const;
  DECOR_SCHEMA = { stepMults: 'intList' } as const;
  APPLIES_TO = null;
  ladder: number[] = [];
  beyond = 'repeat_last';
  cap: number | null = null;
  index = 'continuation_steps';

  override init(): void {
    const p = this.params;
    const unknown = Object.keys(p).filter((k) => !ALLOWED.has(k)).sort();
    if (unknown.length) throw new Error(`cascade_step_ladder: unknown params [${unknown.join(', ')}]`);
    const ladder = p.ladder;
    if (!(Array.isArray(ladder) && ladder.length && ladder.every((x) => typeof x === 'number' && Number.isInteger(x) && x >= 1))) {
      throw new Error('cascade_step_ladder: ladder must be a non-empty list of ints >= 1');
    }
    const beyond = p.beyond === undefined ? 'repeat_last' : p.beyond;
    if (typeof beyond !== 'string' || !BEYOND.includes(beyond)) {
      throw new Error(`cascade_step_ladder: beyond ${JSON.stringify(beyond)} not executable (expected one of ${BEYOND.join(', ')})`);
    }
    this.ladder = [...(ladder as number[])];
    this.beyond = beyond;
    const cap = p.cap === undefined ? null : p.cap;
    if (beyond === 'increment') {
      if (!(typeof cap === 'number' && Number.isInteger(cap) && cap >= this.ladder[this.ladder.length - 1])) {
        throw new Error("cascade_step_ladder: beyond 'increment' needs an int cap >= the last rung");
      }
    } else if (cap !== null) {
      throw new Error("cascade_step_ladder: cap is only meaningful with beyond 'increment'");
    }
    this.cap = cap as number | null;
    const index = p.index === undefined ? 'continuation_steps' : p.index;
    if (typeof index !== 'string' || !INDEX.includes(index)) {
      throw new Error(`cascade_step_ladder: index ${JSON.stringify(index)} not in ${INDEX.join(', ')}`);
    }
    this.index = index;
  }

  /** The factor of the screen being evaluated now (paying_screens counts the base board). */
  currentFactor(ctx: SpinCtx): number {
    return this.factor(ctx.payingScreens);
  }

  factor(k: number): number {
    const n = this.ladder.length;
    if (k < n) return this.ladder[k];
    if (this.beyond === 'repeat_last') return this.ladder[n - 1];
    return Math.min(this.cap as number, this.ladder[n - 1] + (k - (n - 1)));
  }

  override postTotal(ctx: SpinCtx): void {
    const f = this.factor(0);
    if (f !== 1 && ctx.wins.length) {
      ctx.wins = ctx.wins.map((w: SpinWin) => ({ label: w.label, coins: w.coins * f, cells: w.cells, ways: w.ways, lineIdx: w.lineIdx }));
      ctx.lineTotal = ctx.lineTotal * f;
    }
    emitDecor(ctx, this, 'stepMults', ctx.wins.length ? [f] : []);
  }

  override stepFactor(ctx: SpinCtx, k: number): number {
    const f = this.factor(this.index === 'continuation_steps' ? k : ctx.payingScreens);
    (ctx.decor.get(this.decorKey('stepMults')) as number[]).push(f);
    return f;
  }
}

register('cascade_step_ladder', 'post_multiplier', CascadeStepLadder);
