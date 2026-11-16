// Finds dev seeds for screenshots (not part of the game bundle). npx tsx games/unfold/tools/seeds.ts
import { createSlot, type SlotSpec } from '@originals/slots';
import { preReveal } from '../../../packages/slots/src/ui/util';
import spec from '../src/slot.spec.json';
import featureSpec from '../src/feature.spec.json';
import config from '../src/slot.config.json';
const base = spec as unknown as SlotSpec;
const slot = createSlot({ spec: base, featureSpecs: { 'feature.spec.json': featureSpec as unknown as SlotSpec }, feature: config.feature as never, maxWinStakes: config.maxWinStakes });
const BET = base.bet.coins;
const out: Record<string, number[]> = { revealWin: [], anticipation: [] };
for (let seed = 1; seed < 200000; seed++) {
  const r = slot.spin(seed);
  const b = r.finalBoard as number[][];
  const pre = preReveal(base, r);
  const x = r.totalCoins / BET;
  const usesReveal = pre && r.steps.flatMap((st) => st.wins).some((w) => w.cells.some(([c, rr]) => pre.cells.some(([pc, pr]) => pc === c && pr === rr)));
  if (pre && pre.cells.length >= 2 && usesReveal && x >= 1 && out.revealWin.length < 5) out.revealWin.push(seed);
  const sc = b.map((col) => col.filter((v) => v === 1).length);
  if (sc[0] && sc[1] && sc.slice(2).every((v) => !v) && out.anticipation.length < 3) out.anticipation.push(seed);
}
console.log(JSON.stringify(out));
