import { defineEval } from '@originals/game-sdk';
import {
  KS,
  ROCKETS,
  crashFrom,
  playCrashes,
  startChance,
  stopAfterCrashes,
  stopAtEdge,
  stopAtHeight,
  stopAtValue,
  stopNever,
  stopWhenChanceBelow,
  type K,
  type StopRule,
} from './math';

// Each round the simulated player draws five crash points, then samples a
// stopping rule: play to 2x, cash out at a random height, after a random
// number of crashes, once the value passes a random multiple of the stake,
// when one crash from losing, or when the win chance falls below a random
// level. Every rule is a stopping rule on a martingale, so all return RTP.
function sampleRule(rng: { next(): number; int(n: number): number }): StopRule {
  const r = rng.next();
  if (r < 0.25) return stopNever;
  if (r < 0.45) return stopAtHeight(1 + rng.next());
  if (r < 0.6) return stopAfterCrashes(1 + rng.int(3));
  if (r < 0.75) return stopAtValue(1 + rng.next() * 3);
  if (r < 0.85) return stopAtEdge;
  return stopWhenChanceBelow(0.1 + rng.next() * 0.5);
}

export default defineEval<{ k: K }>({
  configs: KS.map((k) => ({ label: `${['', '', 'low', 'medium', 'high', 'extreme'][k]} (${k} of ${ROCKETS}, ${(startChance(k) * 100).toFixed(2)}%)`, params: { k } })),
  playRound({ k }, rng) {
    const crashes = Array.from({ length: ROCKETS }, () => crashFrom(rng.next()));
    return playCrashes(crashes, k, sampleRule(rng));
  },
});
