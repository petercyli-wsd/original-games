// Design + tune tool for Unfold (not part of the game bundle).
//   npx tsx games/unfold/tools/design.ts [--write]
// Builds strips from the counts below, scales the pays to RTP 96% with the exact mixture maths
// (src/mixture.ts), prints the metrics, and with --write saves slot.spec.json / feature.spec.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SlotSpec } from '@originals/slots';
import { scatterCountDist, exactRtp } from '../../../packages/slots/src/engine/analytics/exact';
import type { SpinDist } from '../../../packages/slots/src/engine/analytics/distribution';
import { freeSpinsAnalytics } from '../../../packages/slots/src/engine/analytics/features';
import type { FreeSpinsConfig } from '../../../packages/slots/src/engine/analytics/config';
import { components, mixtureDist, mixtureRtp, mixtureScatterDist } from '../src/mixture';
import { dryStreakQuantile } from '../../../packages/slots/src/engine/analytics/stats';

const BET = 102400;
const SRC = join(import.meta.dirname, '..', 'src');
const P = JSON.parse(readFileSync(join(import.meta.dirname, 'params.json'), 'utf8'));

// symbol ids: 1 sun scatter, 2 gold wild, 3 crane, 4 fox, 5 koi, 6 frog, 7 boat, 8 pinwheel, 9 fan, 10 star, 11 cube, 12 mystery
const symbols = [
  { id: 1, label: 'SC', role: 'scatter' }, { id: 2, label: 'WD', role: 'wild' },
  { id: 3, label: 'P1', role: 'premium' }, { id: 4, label: 'P2', role: 'premium' }, { id: 5, label: 'P3', role: 'premium' }, { id: 6, label: 'P4', role: 'premium' },
  { id: 7, label: 'L1', role: 'low' }, { id: 8, label: 'L2', role: 'low' }, { id: 9, label: 'L3', role: 'low' }, { id: 10, label: 'L4', role: 'low' }, { id: 11, label: 'L5', role: 'low' },
  { id: 12, label: 'MYST', role: 'mid' },
];

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Lay out blocks (a mystery stack is one block) around a circle with no two equal singletons or wilds adjacent. */
function layout(counts: Record<number, number>, stacks: number, stackH: number, len: number, seed: number): number[] {
  const r = rng(seed);
  for (let attempt = 0; attempt < 5000; attempt++) {
    const blocks: number[][] = [];
    for (const [id, n] of Object.entries(counts)) for (let i = 0; i < n; i++) blocks.push([Number(id)]);
    for (let i = 0; i < stacks; i++) blocks.push(Array(stackH).fill(12));
    for (let i = blocks.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; }
    const out = blocks.flat();
    if (out.length !== len) throw new Error(`strip length ${out.length} != ${len}`);
    let ok = true;
    for (let i = 0; i < len && ok; i++) {
      const a = out[i], b = out[(i + 1) % len];
      if (a === b && a !== 12) ok = false;
      if (a === 12 && b === 12 && stacks === 0) ok = false;
    }
    // base: no two mysteries within 3 stops (single squares stay single)
    if (ok && stacks === 0) for (let i = 0; i < len; i++) if (out[i] === 12) for (let d = 1; d <= 3; d++) if (out[(i + d) % len] === 12) ok = false;
    // scatter and wild never within a 4-row window of each other's own kind
    if (ok) for (let i = 0; i < len; i++) if (out[i] === 1 || out[i] === 2) for (let d = 1; d <= 3; d++) if (out[(i + d) % len] === out[i]) ok = false;
    if (ok) return out;
  }
  throw new Error('layout failed');
}

/** Integer counts per symbol for one reel: weights rotate with the reel so a run of three of one symbol is rarer. */
function reelCounts(c: any, reel: number, set: string): Record<number, number> {
  const syms = [3, 4, 5, 6, 7, 8, 9, 10, 11];
  const sc = c.scatters[reel], wd = c.wilds[reel];
  const stacks = set === 'feature' ? c.mysteries[reel] : 0;
  const myst = set === 'base' ? c.mysteries[reel] : 0;
  const room = c.len - sc - wd - stacks * 4 - myst;
  const w = syms.map((id, i) => c.weight[String(id)] * c.rot[(i + reel * c.shift) % c.rot.length]);
  const tot = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (x / tot) * room);
  const cnt = raw.map((x) => Math.max(1, Math.floor(x)));
  let left = room - cnt.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((p, q) => q[0] - p[0]);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) cnt[order[i][1]]++;
  for (let i = 0; left < 0; i = (i + 1) % cnt.length) if (cnt[i] > 1) { cnt[i]--; left++; }
  const out: Record<number, number> = {};
  syms.forEach((id, i) => (out[id] = cnt[i]));
  out[1] = sc; if (wd) out[2] = wd; if (myst) out[12] = myst;
  return out;
}

function strips(set: 'base' | 'feature'): number[][] {
  const c = P[set];
  return [0, 1, 2, 3, 4].map((reel) => {
    const counts = reelCounts(c, reel, set);
    const stacks = set === 'feature' ? c.mysteries[reel] : 0;
    const sum = Object.values(counts).reduce((a, b) => a + b, 0) + stacks * 4;
    if (sum !== c.len) throw new Error(`${set} reel ${reel}: counts sum ${sum} != ${c.len}`);
    if (process.argv.includes('--counts')) console.error(set, reel, JSON.stringify(counts));
    return layout(counts, stacks, 4, c.len, 1000 * (set === 'base' ? 1 : 2) + reel);
  });
}

function mkSpec(slug: string, set: 'base' | 'feature', paytable: Record<string, Record<string, number>>, scatterPay: Record<string, number>): SlotSpec {
  return {
    schema: 'game_spec_v2', slug, engine: 'reel_engine', bet: { coins: BET },
    geometry: { cols: 5, rows: [4, 4, 4, 4, 4] },
    symbols,
    board_law: { kind: 'strips_uniform', reel_sets: [{ id: set, label: set, strips: strips(set), weight: 1 }] },
    evaluation: { kind: 'ways' },
    pays: { paytable, scatter_pay: scatterPay },
    mechanics: [{ id: 'mystery_reveal', params: { mystery_symbol: '12', reveal_pmf: P[set].pmf } }],
    trigger: { feature_budget_rtp: 0, scatter_min: 3 },
    targets: { quantization_tolerance: 0.001, rtp_requested: 0.96 },
    provenance: { created: '2026-11-16', notes: ['Unfold: ways 5x4, mystery_reveal; start example panel-ways-mystery-reveal-no-mult'], refs: [], type: 'synthetic' },
    mc: { n_mc: 20000 },
  } as SlotSpec;
}

const config = JSON.parse(readFileSync(join(SRC, 'slot.config.json'), 'utf8'));
const cfg = config.feature as FreeSpinsConfig;

function scalePays(shape: any, f: number): { paytable: Record<string, Record<string, number>>; scatter: Record<string, number> } {
  const paytable: Record<string, Record<string, number>> = {};
  for (const [s, t] of Object.entries(shape.paytable as Record<string, Record<string, number>>)) {
    paytable[s] = {};
    let prev = 0;
    for (const k of ['3', '4', '5']) { prev = Math.max(prev + 1, Math.round(t[k] * f)); paytable[s][k] = prev; }
  }
  const scatter: Record<string, number> = {};
  let prev = 0;
  for (const k of ['3', '4', '5']) { prev = Math.max(prev + 1, Math.round(shape.scatter[k] * f)); scatter[k] = prev; }
  return { paytable, scatter };
}

/** A SpinDist that carries only the exact mean coins and the exact scatter-count law (enough for every expectation). */
function meanDist(spec: SlotSpec): SpinDist {
  const comps = components(spec);
  const kd = scatterCountDist(comps[0].spec);
  const mean = comps.reduce((a, c) => a + c.w * exactRtp(c.spec).rtp, 0) * BET;
  const ks = kd.map((_, k) => k);
  return { coins: ks.map(() => mean), k: ks, p: kd, tier: 'exact', method: 'mean+K only' };
}

const FULL = process.argv.includes('--full');
function evaluate(f: number, adj?: (pt: any) => void) {
  const { paytable, scatter } = scalePays(P.pays, f);
  if (adj) adj(paytable);
  const base = mkSpec('unfold', 'base', paytable, scatter);
  const feat = mkSpec('unfold-feature', 'feature', paytable, scatter);
  const bd = FULL ? mixtureDist(base) : meanDist(base);
  const fd = FULL ? mixtureDist(feat) : meanDist(feat);
  const baseRtp = mixtureRtp(base);
  const fa = freeSpinsAnalytics({ baseRtp, baseTier: 'exact_mixture', betCoins: BET, scatterDist: scatterCountDist(components(base)[0].spec), scatterMin: 3, featureDist: fd, cfg });
  return { base, feat, bd, fd, baseRtp, fa, paytable };
}

let f = 1000;
let r = evaluate(f);
for (let it = 0; it < 3; it++) { f = f * 0.96 / r.fa.totalRtp; r = evaluate(f); console.error('scale', f, r.fa.totalRtp); }
const d = r.bd; let hit = 0, m1 = 0, m2 = 0;
for (let i = 0; i < d.p.length; i++) { if (d.coins[i] > 0) hit += d.p[i]; }
const fa = r.fa;
// round SD (base + feature) via per-trigger-k moments is in stats.ts; here a quick base-only SD and the feature numbers
for (let i = 0; i < d.p.length; i++) { const x = d.coins[i] / BET; m1 += d.p[i] * x; m2 += d.p[i] * x * x; }
console.log(JSON.stringify({
  scale: f, totalRtp: fa.totalRtp, baseRtp: r.baseRtp, featureRtp: fa.featureRtp, share: fa.featureShare,
  baseHit: hit, baseSD: Math.sqrt(m2 - m1 * m1), oneIn: fa.featureFrequency, avgFeatureWin: fa.averageFeatureWinStakes,
  expSpins: fa.expectedSpinsGivenTrigger, featSpinRtp: fa.featureSpinEvCoins / BET, dryP95BaseOnly: dryStreakQuantile(hit),
}, null, 1));
console.log(JSON.stringify(r.paytable));
if (process.argv.includes('--write')) {
  writeFileSync(join(SRC, 'slot.spec.json'), JSON.stringify(r.base, null, 2) + '\n');
  writeFileSync(join(SRC, 'feature.spec.json'), JSON.stringify(r.feat, null, 2) + '\n');
  console.log('wrote specs');
}
