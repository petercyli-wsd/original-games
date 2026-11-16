// wild_injection. Pack: src/reelengine/mechanics/legacy_hooks.py (wrapper) + src/slotlab/kernel/mech.py WildInjectionHook.
// Law: n = pickWeighted(n_pmf); n distinct cells (column-major index c*rows+r) by partial Fisher-Yates
// (randrange(cells - i)); stamped cells become the first wild id. Decor injected = sorted [c, r] cells (omitted if none).

import { firstOfSet } from '../evaluators';
import { cumThresholds } from '../rng';
import { emitDecor, type SpinCtx } from '../pipeline';
import type { DecorSchema } from '../canonical';
import { MechanicPlugin, type Params } from './protocol';
import { register } from './registry';

export class WildInjection extends MechanicPlugin {
  override ID = 'wild_injection';
  override STAGE = 'board_transform' as const;
  override DECOR_SCHEMA: DecorSchema = { injected: 'cellList' };
  override RAGGED_OK = false;
  override APPLIES_TO = null;
  private values: number[] = [];
  private cum: number[] = [];
  private wildId = 0;
  private cells = 0;
  private rowsN = 0;

  override init(): void {
    const p: Params = this.params;
    const unknown = Object.keys(p).filter((k) => !['n_pmf', 'placement'].includes(k)).sort();
    if (unknown.length) throw new Error(`wild_injection: unknown params ${JSON.stringify(unknown)}`);
    if (p.placement !== 'uniform_cells') throw new Error(`wild_injection: unsupported placement ${JSON.stringify(p.placement)}`);
    const pmf = p.n_pmf;
    if (!pmf || typeof pmf !== 'object' || Array.isArray(pmf) || !Object.keys(pmf).length) throw new Error('wild_injection: n_pmf must be a non-empty {n: weight} map');
    const rows = this.engine.rowsUniform;
    if (rows === null) throw new Error('legacy hooks need uniform reel heights (ragged boards are not a kernel law)');
    this.rowsN = rows;
    this.cells = this.engine.cols * rows;
    const items: [number, number][] = [];
    for (const [k, w] of Object.entries(pmf as Record<string, unknown>)) {
      const n = /^\s*[+-]?\d+\s*$/.test(k) ? Number(k) : null;
      if (n === null) throw new Error(`wild_injection: n_pmf key '${k}' must be int-castable`);
      if (n < 0 || n > this.cells) throw new Error(`wild_injection: n_pmf count ${n} out of range 0..${this.cells}`);
      if (typeof w !== 'number' || !Number.isInteger(w) || w <= 0) throw new Error(`wild_injection: n_pmf weight for '${k}' must be a positive int`);
      items.push([n, w]);
    }
    if (!this.engine.wilds.size) throw new Error('wild_injection: no wilds declared (nothing to inject)');
    if (this.engine.scatter !== null && this.engine.wilds.has(this.engine.scatter)) throw new Error('wild_injection: scatter id equals a wild id');
    items.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    this.values = items.map(([n]) => n);
    this.cum = cumThresholds(items.map(([, w]) => w));
    this.wildId = firstOfSet(this.engine.wilds);
  }

  override apply(ctx: SpinCtx): void {
    const n = this.values[ctx.rng.pickWeighted(this.cum)];
    const pool = Array.from({ length: this.cells }, (_, i) => i);
    for (let i = 0; i < n; i++) {
      const j = i + ctx.rng.randrange(this.cells - i);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const chosen = pool.slice(0, n).sort((a, b) => a - b);
    const stamped = chosen.map((idx): [number, number] => [Math.floor(idx / this.rowsN), idx % this.rowsN]);
    const board = ctx.board.map((col) => [...col]);
    for (const [c, r] of stamped) board[c][r] = this.wildId;
    ctx.board = board;
    if (stamped.length) emitDecor(ctx, this, 'injected', stamped);
  }
}

register('wild_injection', 'board_transform', WildInjection);
