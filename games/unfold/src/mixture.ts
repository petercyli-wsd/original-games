// Exact maths of a spec with a `mystery_reveal` mechanic.
//
// The TypeScript closed forms (analytics/model.ts) refuse any spec with mechanics. But mystery_reveal has a tiny
// law: one draw per spin from `reveal_pmf`, then every mystery cell on the board becomes that symbol before the
// evaluator runs. Conditional on the drawn symbol s, the reels are independent strips with mystery -> s, i.e. an
// ordinary no-mechanic spec. So the spin law is an exact mixture:
//
//   P(spin) = sum_s w_s * P_s(spin),    RTP = sum_s w_s * exactRtp(spec_s)     (tier 'exact_mixture', as the pack)
//
// This file builds the component specs, the mixed (coins, scatter count) distribution and the exact RTP.

import type { SlotSpec } from '@originals/slots';
import { spinDistribution, type SpinDist } from '../../../packages/slots/src/engine/analytics/distribution';
import { exactRtp } from '../../../packages/slots/src/engine/analytics/exact';

export interface RevealParams {
  mystery_symbol: string | number;
  reveal_pmf: Record<string, number>;
}

export function revealParams(spec: SlotSpec): RevealParams {
  const m = (spec.mechanics ?? []).find((x) => (x as Record<string, unknown>).id === 'mystery_reveal');
  if (!m) throw new Error('spec has no mystery_reveal mechanic');
  return (m as unknown as { params: RevealParams }).params;
}

/** The no-mechanic spec for one drawn symbol: every mystery stop on every strip becomes `sym`. */
export function specFor(spec: SlotSpec, sym: number): SlotSpec {
  const myst = Number(revealParams(spec).mystery_symbol);
  const c = JSON.parse(JSON.stringify(spec)) as SlotSpec;
  c.mechanics = (c.mechanics ?? []).filter((x) => (x as Record<string, unknown>).id !== 'mystery_reveal');
  for (const rs of c.board_law.reel_sets ?? []) rs.strips = rs.strips.map((s) => s.map((v) => (v === myst ? sym : v)));
  return c;
}

/** The weighted components: [revealed symbol, probability, spec]. */
export function components(spec: SlotSpec): { sym: number; w: number; spec: SlotSpec }[] {
  const pmf = revealParams(spec).reveal_pmf;
  const total = Object.values(pmf).reduce((a, b) => a + b, 0);
  return Object.entries(pmf).map(([k, v]) => ({ sym: Number(k), w: v / total, spec: specFor(spec, Number(k)) }));
}

/** Exact RTP of a mystery-reveal spec (tier exact_mixture). */
export function mixtureRtp(spec: SlotSpec): number {
  return components(spec).reduce((a, c) => a + c.w * exactRtp(c.spec).rtp, 0);
}

/** The exact mixed distribution of one spin's (coins, scatter count). */
export function mixtureDist(spec: SlotSpec): SpinDist {
  const acc = new Map<string, { coins: number; k: number; p: number }>();
  let method = '';
  for (const c of components(spec)) {
    const d = spinDistribution(c.spec);
    if (d.tier !== 'exact') throw new Error(`component ${c.sym}: distribution is ${d.tier}, expected exact`);
    method = d.method;
    for (let i = 0; i < d.p.length; i++) {
      const key = `${d.coins[i]}:${d.k[i]}`;
      const e = acc.get(key);
      if (e) e.p += c.w * d.p[i];
      else acc.set(key, { coins: d.coins[i], k: d.k[i], p: c.w * d.p[i] });
    }
  }
  const es = [...acc.values()];
  return {
    coins: es.map((e) => e.coins),
    k: es.map((e) => e.k),
    p: es.map((e) => e.p),
    tier: 'exact',
    method: `exact mixture over reveal_pmf (${method})`,
  };
}

/** P(K = k) of the visible scatter count (the reveal never creates scatters, so any component gives it). */
export function mixtureScatterDist(dist: SpinDist): number[] {
  const out: number[] = [];
  for (let i = 0; i < dist.p.length; i++) out[dist.k[i]] = (out[dist.k[i]] ?? 0) + dist.p[i];
  for (let k = 0; k < out.length; k++) out[k] ??= 0;
  return out;
}
