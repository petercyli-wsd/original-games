// Grand Finale maths tool (this game's own, because the shared tuner refuses mechanics):
//   npx tsx games/grand-finale/tools/analyse.ts [--tune] [--mc N]
// --tune scales (then integer-fine-tunes) the shared pay table of both specs to the target RTP, exactly.
// Always prints the exact RTP split, then a Monte Carlo of whole rounds (playRound) for SD and bands.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { award } from '../../../packages/slots/src/engine/analytics/config';
import type { SlotConfig } from '../../../packages/slots/src/engine/analytics/config';
import { freeSpinsAnalytics } from '../../../packages/slots/src/engine/analytics/features';
import type { SpinDist } from '../../../packages/slots/src/engine/analytics/distribution';
import { createSlot } from '../../../packages/slots/src/engine';
import type { SlotSpec } from '../../../packages/slots/src/engine/types';
import { baseMath } from '../src/exactmath';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const rd = <T,>(f: string) => JSON.parse(readFileSync(join(SRC, f), 'utf8')) as T;
const args = process.argv.slice(2);
const tune = args.includes('--tune');
const mcN = Number(args[args.indexOf('--mc') + 1] || 2_000_000);

let base = rd<SlotSpec>('slot.spec.json');
let feat = rd<SlotSpec>('feature.spec.json');
const cfg = rd<SlotConfig>('slot.config.json');

export function analytics(b: SlotSpec, f: SlotSpec) {
  const bm = baseMath(b);
  const fm = baseMath(f);
  const dist: SpinDist = { coins: [], k: [], p: [], tier: 'exact', method: 'grand-finale exactmath (E[win | K])' };
  fm.kPmf.forEach((p, k) => {
    if (p > 0) {
      dist.coins.push(fm.evCoinsByK[k] / p);
      dist.k.push(k);
      dist.p.push(p);
    }
  });
  const a = freeSpinsAnalytics({
    baseRtp: bm.rtp,
    baseTier: 'exact',
    betCoins: b.bet.coins,
    scatterDist: bm.kPmf,
    scatterMin: b.trigger!.scatter_min as number,
    featureDist: dist,
    cfg: cfg.feature!,
  } as never);
  return { bm, fm, a };
}

// Pays are flat inside a count bracket (so the paytable reads as 6 rows per symbol).
const BRACKETS: number[][] = [[10, 11], [12, 13], [14, 15], [16, 17, 18], [19, 20, 21, 22], [23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35]];
function setBracket(sym: string, bi: number, v: number): void {
  for (const sp of [base, feat]) for (const n of BRACKETS[bi]) sp.pays.paytable[sym][String(n)] = v;
}
function scalePays(f: number): void {
  for (const sym of Object.keys(base.pays.paytable)) {
    let prev = 0;
    BRACKETS.forEach((br, bi) => {
      const v = Math.max(prev + 1, Math.round(base.pays.paytable[sym][String(br[0])] * f));
      setBracket(sym, bi, v);
      prev = v;
    });
  }
}

if (tune) {
  const raw = JSON.stringify(base.pays.paytable);
  for (let it = 0; it < 6; it++) {
    const { a } = analytics(base, feat);
    if (Math.abs(a.totalRtp - cfg.targetRtp) < 1e-6) break;
    scalePays(cfg.targetRtp / a.totalRtp);
    feat.pays.paytable = JSON.parse(JSON.stringify(base.pays.paytable));
  }
  // integer fine-tune: shift one bracket's pay of one symbol by whole coins, using its exact slope
  const T = base.pays.paytable;
  const total = () => analytics(base, feat).a.totalRtp;
  for (let round = 0; round < 8; round++) {
    const e0 = total() - cfg.targetRtp;
    if (Math.abs(e0) < 2e-5) break;
    const cands: { sym: string; bi: number; slope: number }[] = [];
    for (const sym of Object.keys(T))
      for (let bi = 0; bi < 4; bi++) {
        const v = T[sym][String(BRACKETS[bi][0])];
        setBracket(sym, bi, v + 1);
        const slope = total() - (e0 + cfg.targetRtp);
        setBracket(sym, bi, v);
        cands.push({ sym, bi, slope });
      }
    cands.sort((x, y) => y.slope - x.slope);
    let e = e0;
    for (const c of cands) {
      const k = Math.trunc(-e / c.slope);
      if (!k) continue;
      const v = T[c.sym][String(BRACKETS[c.bi][0])];
      const lo = c.bi > 0 ? T[c.sym][String(BRACKETS[c.bi - 1][0])] : 0;
      const hi = T[c.sym][String(BRACKETS[c.bi + 1][0])];
      if (v + k <= lo || v + k >= hi) continue;
      setBracket(c.sym, c.bi, v + k);
      e += k * c.slope;
      if (Math.abs(e) < 2e-5) break;
    }
  }
  void raw;
  writeFileSync(join(SRC, 'slot.spec.json'), JSON.stringify(base, null, 2) + '\n');
  writeFileSync(join(SRC, 'feature.spec.json'), JSON.stringify(feat, null, 2) + '\n');
  console.log('wrote pays');
  base = rd<SlotSpec>('slot.spec.json');
  feat = rd<SlotSpec>('feature.spec.json');
}

const { bm, fm, a } = analytics(base, feat);
const fmt = (x: number, d = 4) => x.toFixed(d);
console.log(`base RTP ${fmt(bm.rtp * 100, 3)}%  feature spin EV ${fmt(fm.rtp, 3)} stakes`);
console.log(`TOTAL RTP ${fmt(a.totalRtp * 100, 4)}% (exact)  feature share ${fmt(a.featureShare * 100, 1)}%  trigger 1 in ${fmt(a.featureFrequency, 1)}  avg feature win ${fmt(a.averageFeatureWinStakes, 1)}x  E[spins|trigger] ${fmt(a.expectedSpinsGivenTrigger, 2)}`);

// Monte Carlo of whole rounds
const slot = createSlot({ spec: base, featureSpecs: { 'feature.spec.json': feat }, feature: cfg.feature, maxWinStakes: cfg.maxWinStakes });
const stake = base.bet.coins;
let seedState = 20261116;
const u32 = () => {
  seedState = (Math.imul(seedState, 1664525) + 1013904223) >>> 0;
  let x = seedState;
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; x ^= x >>> 12; x = Math.imul(x, 0x297a2d39) >>> 0; x ^= x >>> 15;
  return x >>> 0;
};
let sum = 0, sq = 0, hit = 0, big20 = 0, big100 = 0, max = 0, trig = 0, capped = 0, baseHit = 0, fsum = 0, fsq = 0;
const gt = [0, 0, 0, 0];
const wins: boolean[] = [];
for (let i = 0; i < mcN; i++) {
  const r = slot.playRound(u32(), u32);
  const w = r.totalCoins / stake;
  sum += w; sq += w * w;
  if (w > 0) hit++;
  if (r.base.totalCoins > 0) baseHit++;
  if (w >= 20) big20++;
  if (w >= 100) big100++;
  if (w > max) max = w;
  if (r.capped) capped++;
  if (r.feature) { trig++; fsum += r.feature.totalCoins / stake; fsq += (r.feature.totalCoins / stake) ** 2; }
  wins.push(w > 0);
}
const mean = sum / mcN, sd = Math.sqrt(sq / mcN - mean * mean);
// dry streak p95: longest run of non-paying rounds in blocks of 100
let longest: number[] = [];
for (let b = 0; b + 100 <= wins.length; b += 100) {
  let run = 0, best = 0;
  for (let j = 0; j < 100; j++) { if (!wins[b + j]) { run++; if (run > best) best = run; } else run = 0; }
  longest.push(best);
}
longest.sort((x, y) => x - y);
console.log(`MC n=${mcN}: RTP ${fmt(mean * 100, 3)}% +-${fmt((sd / Math.sqrt(mcN)) * 100, 3)}  SD ${fmt(sd, 2)}  hit(round) ${fmt((hit / mcN) * 100, 2)}%  hit(base) ${fmt((baseHit / mcN) * 100, 2)}%  win>=20x 1 in ${fmt(mcN / big20, 0)}  >=100x 1 in ${fmt(mcN / big100, 0)}  max ${fmt(max, 0)}x  cap hits ${capped}  dry p95 ${longest[Math.floor(longest.length * 0.95)]}`);
console.log(`MC feature: triggers ${trig} (1 in ${fmt(mcN / trig, 1)}), avg ${fmt(fsum / trig, 1)}x, share of RTP ${fmt((fsum / mcN / mean) * 100, 1)}%`);
void award;
