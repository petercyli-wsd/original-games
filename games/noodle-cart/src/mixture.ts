// Exact maths for the two mechanics this game uses, built on the engine's analytic model.
//
// The kit's closed forms refuse every spec with mechanics (model.ts: "not ported"), so this file
// supplies the missing piece for ONE law set, using the kit's own enumerator unchanged:
//
//   walking_wild    one draw per spin picks a reel from placement_pmf; that whole reel is wild before
//                   evaluation and before the scatter count (it covers any scatter there).
//                   => a mixture of reel sets with weight pmf[j], where reel j shows [wild x rows].
//   expanding_wild  a wild visible anywhere in an eligible reel turns the whole window wild.
//                   => the eligible reels' windows are replaced by their expanded windows.
//
// Reels stay independent given the walker's reel, so each walker case is a product-form component
// and `exactRtp`, `exactSpinDistribution` and `computeSlotStats` price it exactly. The pack calls the
// result tier `exact_mixture`; the oracle parity test pins it to the pack's own number.
// Used by tests and the tuning script only; the game itself never imports it.

import type { SlotSpec } from '../../../packages/slots/src/engine/types';
import { buildModel, type Component, type ReelWindow, type SlotModel } from '../../../packages/slots/src/engine/analytics/model';

interface MechanicDef {
  id?: string;
  params?: Record<string, unknown>;
}

function expandedWindows(strip: number[], height: number, wilds: Set<number>, wild: number): ReelWindow[] {
  const L = strip.length;
  const acc = new Map<string, ReelWindow>();
  for (let s = 0; s < L; s++) {
    let win: number[] = [];
    for (let i = 0; i < height; i++) win.push(strip[(s + i) % L]);
    if (win.some((v) => wilds.has(v))) win = win.map(() => wild);
    const key = win.join(',');
    const e = acc.get(key);
    if (e) e.p += 1 / L;
    else acc.set(key, { win, p: 1 / L });
  }
  return [...acc.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map((e) => e[1]);
}

/** The analytic model of a spec whose mechanics are walking_wild and (optionally) expanding_wild. */
export function mixtureModel(spec: SlotSpec): SlotModel {
  const mechs = (spec.mechanics ?? []) as MechanicDef[];
  const ids = mechs.map((m) => m.id);
  if (ids.some((id) => id !== 'walking_wild' && id !== 'expanding_wild')) throw new Error(`mixtureModel: unsupported mechanics ${JSON.stringify(ids)}`);
  const walk = mechs.find((m) => m.id === 'walking_wild');
  const expand = mechs.find((m) => m.id === 'expanding_wild');
  const m = buildModel({ ...spec, mechanics: [] });
  if (m.closedFormRefusal) throw new Error(`mixtureModel: ${m.closedFormRefusal}`);
  if (m.components.length !== 1) throw new Error('mixtureModel: one reel set expected');
  const base = m.components[0];
  const wild = [...m.wilds][0];

  const expandReels = new Set<number>(
    expand ? ((expand.params?.expand_reels as number[] | undefined) ?? Array.from({ length: m.cols }, (_, c) => c)) : [],
  );
  const reelWindows: ReelWindow[][] = base.windows.map((w, c) => (expandReels.has(c) ? expandedWindows(base.strips[c], m.rows[c], m.wilds, wild) : w));

  let columns: [number, number][] = [[-1, 1]];
  if (walk) {
    const pmf = walk.params?.placement_pmf as Record<string, number>;
    const tot = Object.values(pmf).reduce((a, b) => a + b, 0);
    columns = Object.entries(pmf)
      .map(([c, w]) => [Number(c), w / tot] as [number, number])
      .sort((a, b) => a[0] - b[0]);
  }
  const components: Component[] = columns.map(([j, weight]) => ({
    weight,
    strips: base.strips,
    windows: reelWindows.map((w, c) => (c === j ? [{ win: Array<number>(m.rows[c]).fill(wild), p: 1 }] : w)),
  }));
  return { ...m, components };
}
