// Monte Carlo of the written specs through the runtime: npx tsx games/unfold/tools/mc.ts [rounds]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSlot } from '@originals/slots';
import { dryStreakQuantile } from '../../../packages/slots/src/engine/analytics/stats';
const SRC = join(import.meta.dirname, '..', 'src');
const rd = (f: string) => JSON.parse(readFileSync(join(SRC, f), 'utf8'));
const config = rd('slot.config.json');
const slot = createSlot({ spec: rd('slot.spec.json'), featureSpecs: { 'feature.spec.json': rd('feature.spec.json') }, feature: config.feature, maxWinStakes: config.maxWinStakes });
const N = Number(process.argv[2] ?? 2_000_000);
let s = 0x12345678;
const r32 = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0; };
const bet = slot.stakeCoins;
let bs = 0, bs2 = 0, fw = 0, fw2 = 0, fn = 0; let sum = 0, sum2 = 0, hit = 0, trig = 0, fsum = 0, fsum2 = 0, max = 0, big20 = 0, big100 = 0, baseHit = 0, capped = 0;
for (let i = 0; i < N; i++) {
  const rd2 = slot.playRound(r32(), r32);
  const x = rd2.totalCoins / bet;
  sum += x; sum2 += x * x; if (x > 0) hit++; if (rd2.base.totalCoins > 0) baseHit++;
  if (x > max) max = x; if (x >= 20) big20++; if (x >= 100) big100++; if (rd2.capped) capped++;
  { const b = rd2.base.totalCoins / bet; bs += b; bs2 += b * b; }
  if (rd2.feature) { for (const sp of rd2.feature.spins) { const w = sp.coins / bet; fw += w; fw2 += w * w; fn++; } trig++; const f = rd2.feature.totalCoins / bet; fsum += f; fsum2 += f * f; }
}
const mean = sum / N, sd = Math.sqrt(sum2 / N - mean * mean);
console.log(JSON.stringify({ N, rtp: mean, se: sd / Math.sqrt(N), sd, hitRate: hit / N, baseHit: baseHit / N, featOneIn: N / trig, avgFeature: fsum / trig, baseSD: Math.sqrt(bs2 / N - (bs / N) ** 2), baseRtp: bs / N, featSpinMean: fw / fn, featSpinSD: Math.sqrt(fw2 / fn - (fw / fn) ** 2), featSD: Math.sqrt(fsum2 / trig - (fsum / trig) ** 2), featShare: fsum / N / mean, max, p20: big20 / N, p100: big100 / N, capped, dryP95: dryStreakQuantile(hit / N) }, null, 1));
