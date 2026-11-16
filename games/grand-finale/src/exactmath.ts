// Exact base-spin maths for Grand Finale (scatter pays + global_additive, no tumble).
//
// The shared TypeScript analytics refuse specs with mechanics ("no closed form"), so this game carries
// its own exact calculation. The law (pack: scatter_analytics.evaluate_board + GlobalAdditiveHook):
//   - every paying symbol s pays pay[s][n_s + w] coins when n_s + w >= min_count, where w is the number of
//     wild rockets on the board (wilds join every symbol's count);
//   - the board's wins are multiplied by g = base + sum of one value draw per rocket (value_pmf);
//   - the fuse scatter pays scatter_pay[K] on its visible count, NOT multiplied by g.
// Reels are independent and uniform over the strip's stops (docs/SLOTS.md 2.1), so for each symbol s the
// joint law of (n_s, w, K) is a DP over the reels' windows. E[g | w] = base + w*mu, and g is independent of the
// cells given w, so the expectation is exact. Tests check it against the engine pack's own analytics (oracle.json).

import type { SlotSpec } from '../../../packages/slots/src/engine/types';

const N = 36; // counts 0..35 on a 7x5 board

export interface BaseMath {
  /** E[coins] of one spin. */
  evCoins: number;
  /** RTP of one spin = evCoins / bet. */
  rtp: number;
  /** P(K = k) for the fuse count K (index k). */
  kPmf: number[];
  /** E[coins ; K = k] (a joint expectation, not conditional), index k. */
  evCoinsByK: number[];
  /** Mean of one rocket's value draw. */
  mu: number;
  /** Mean of the board multiplier given w rockets: base + w * mu. */
  gBase: number;
}

interface WindowCount {
  a: number;
  b: number;
  c: number;
  p: number;
}

function windowsFor(strip: number[], rows: number, target: number, wild: number, scatter: number): WindowCount[] {
  const L = strip.length;
  const acc = new Map<string, WindowCount>();
  for (let s = 0; s < L; s++) {
    let a = 0;
    let b = 0;
    let c = 0;
    for (let i = 0; i < rows; i++) {
      const v = strip[(s + i) % L];
      if (v === target) a++;
      else if (v === wild) b++;
      else if (v === scatter) c++;
    }
    const key = `${a},${b},${c}`;
    const w = acc.get(key);
    if (w) w.p += 1 / L;
    else acc.set(key, { a, b, c, p: 1 / L });
  }
  return [...acc.values()];
}

export function additiveParams(spec: SlotSpec): { base: number; pmf: Record<string, number> } {
  const m = (spec.mechanics ?? []).find((x) => (x as { id?: string }).id === 'global_additive') as { params: { base: number; value_pmf: Record<string, number> } } | undefined;
  if (!m) throw new Error('exactmath: spec has no global_additive mechanic');
  return { base: m.params.base, pmf: m.params.value_pmf };
}

export function baseMath(spec: SlotSpec): BaseMath {
  const wild = spec.symbols.find((s) => s.role === 'wild')!.id;
  const scatter = spec.symbols.find((s) => s.role === 'scatter')!.id;
  const { base, pmf } = additiveParams(spec);
  let tw = 0;
  let mean = 0;
  for (const [v, w] of Object.entries(pmf)) {
    tw += w;
    mean += Number(v) * w;
  }
  const mu = mean / tw;
  const sets = (spec.board_law as { reel_sets: { strips: number[][]; weight: number }[] }).reel_sets;
  if (sets.length !== 1) throw new Error('exactmath: one reel set only');
  const strips = sets[0].strips;
  const rows = spec.geometry.rows;
  const cols = rows.length;
  const K = cols * Math.max(...rows) + 1;
  const paying = Object.keys(spec.pays.paytable).map(Number);
  const sp = spec.pays.scatter_pay ?? {};

  const evByK = new Array<number>(K).fill(0);
  let kPmf: number[] | null = null;
  for (const s of paying) {
    // P[(n * N + w) * K + k]
    let P = new Float64Array(N * N * K);
    P[0] = 1;
    for (let c = 0; c < cols; c++) {
      const ws = windowsFor(strips[c], rows[c], s, wild, scatter);
      const Q = new Float64Array(N * N * K);
      for (let n = 0; n < N; n++)
        for (let w = 0; w < N; w++)
          for (let k = 0; k < K; k++) {
            const p0 = P[(n * N + w) * K + k];
            if (p0 === 0) continue;
            for (const x of ws) Q[((n + x.a) * N + (w + x.b)) * K + (k + x.c)] += p0 * x.p;
          }
      P = Q;
    }
    const tbl = spec.pays.paytable[String(s)];
    const kk = new Array<number>(K).fill(0);
    for (let n = 0; n < N; n++)
      for (let w = 0; w < N; w++) {
        const pay = n + w < N ? Number(tbl[String(n + w)] ?? 0) : 0;
        for (let k = 0; k < K; k++) {
          const p0 = P[(n * N + w) * K + k];
          if (p0 === 0) continue;
          kk[k] += p0;
          if (pay) evByK[k] += p0 * (base + w * mu) * pay;
        }
      }
    if (!kPmf) kPmf = kk; // the scatter count law is the same for every s
  }
  for (let k = 0; k < K; k++) evByK[k] += (kPmf![k] ?? 0) * Number(sp[String(k)] ?? 0);
  const ev = evByK.reduce((a, b) => a + b, 0);
  return { evCoins: ev, rtp: ev / spec.bet.coins, kPmf: kPmf!, evCoinsByK: evByK, mu, gBase: base };
}
