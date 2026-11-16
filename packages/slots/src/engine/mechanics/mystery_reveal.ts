// mystery_reveal. Pack: src/reelengine/mechanics/legacy_hooks.py (wrapper) + src/slotlab/kernel/mech.py MysteryRevealHook.
// Law: one draw per spin (pickWeighted over reveal_pmf, values sorted); every mystery cell becomes the drawn
// symbol before evaluation. Decor mysteryReveal = the drawn symbol (always emitted).

import { CatalogReel, StripReel, GlobalMixture, type Reel } from '../reelsystem';
import { cumThresholds } from '../rng';
import { emitDecor, type SpinCtx } from '../pipeline';
import type { DecorSchema } from '../canonical';
import { MechanicPlugin, type Params } from './protocol';
import { register } from './registry';

const ALLOWED = ['mystery_symbol', 'per_set', 'reveal_pmf'];

/** Python int(x) for the str / int / float inputs a spec can carry; null when not int-castable. */
function pyInt(x: unknown): number | null {
  if (typeof x === 'boolean') return Number(x);
  if (typeof x === 'number') return Number.isFinite(x) ? Math.trunc(x) : null;
  if (typeof x === 'string' && /^\s*[+-]?\d+\s*$/.test(x)) return Number(x.trim());
  return null;
}

export class MysteryReveal extends MechanicPlugin {
  override ID = 'mystery_reveal';
  override STAGE = 'board_transform' as const;
  override DECOR_SCHEMA: DecorSchema = { mysteryReveal: 'int' };
  override RAGGED_OK = true;
  override APPLIES_TO = null;
  private mysteryId = 0;
  private values: number[] = [];
  private cum: number[] = [];

  override init(): void {
    const p: Params = this.params;
    const unknown = Object.keys(p).filter((k) => !ALLOWED.includes(k)).sort();
    if (unknown.length) throw new Error(`mystery_reveal: unknown params ${JSON.stringify(unknown)}`);
    const ms = p.mystery_symbol;
    if (ms === undefined || ms === null) throw new Error('mystery_reveal: mystery_symbol required');
    const id = pyInt(ms);
    if (id === null) throw new Error(`mystery_reveal: mystery_symbol ${JSON.stringify(ms)} must be int-castable`);
    this.mysteryId = id;
    const law = this.engine.reelsystem.law;
    const reels: Reel[] = law instanceof GlobalMixture ? law.sets.flatMap((s) => s.reels) : law.reels.flatMap((r) => r.map((x) => x.reel));
    if (reels.some((r) => r instanceof CatalogReel)) throw new Error('mystery_reveal: a window-catalog reel has no strip to search');
    if (!reels.some((r) => r instanceof StripReel && r.cells.includes(id))) {
      throw new Error(`mystery_reveal: mystery_symbol ${id} does not appear on any strip of any reel set — the mechanic would be inert`);
    }
    const pmf = p.reveal_pmf;
    if (!pmf || typeof pmf !== 'object' || Array.isArray(pmf) || !Object.keys(pmf).length) throw new Error('mystery_reveal: reveal_pmf must be a non-empty {symbol: weight} map');
    const items: [number, number][] = [];
    for (const [k, w] of Object.entries(pmf as Record<string, unknown>)) {
      const sym = pyInt(k);
      if (sym === null) throw new Error(`mystery_reveal: reveal_pmf key '${k}' must be int-castable`);
      if (typeof w !== 'number' || !Number.isInteger(w) || w <= 0) throw new Error(`mystery_reveal: reveal_pmf weight for '${k}' must be a positive int`);
      items.push([sym, w]);
    }
    items.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    this.values = items.map(([v]) => v);
    this.cum = cumThresholds(items.map(([, w]) => w));
  }

  override apply(ctx: SpinCtx): void {
    const target = this.values[ctx.rng.pickWeighted(this.cum)];
    ctx.board = ctx.board.map((col) => col.map((v) => (v === this.mysteryId ? target : v)));
    emitDecor(ctx, this, 'mysteryReveal', target);
  }
}

register('mystery_reveal', 'board_transform', MysteryReveal);
