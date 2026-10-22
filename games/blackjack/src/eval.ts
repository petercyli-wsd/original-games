import { defineEval } from '@originals/game-sdk';
import {
  BASIC_POLICY,
  CAUTIOUS_POLICY,
  INSURE_POLICY,
  MIMIC_POLICY,
  PAIRS_RTP,
  RTP,
  TRIPS_RTP,
  cardOf,
  evaluatePolicy,
  playOut,
  type Policy,
  type Sides,
} from './math';

// Each round's multiplier is everything returned minus the extra stakes
// (doubles, splits, side bets, insurance), per unit of the main bet:
// 1 + net / bet. That is how blackjack's RTP is quoted, and it is what Auto's
// profit counter uses. A lost double or split goes below 0 (e.g. −1 when a
// doubled hand loses).
//
// Players are sampled: mostly basic strategy, plus players who take
// insurance, mimic the dealer or never risk a bust. Each policy's RTP is
// exact (evaluatePolicy), so every config's target is the exact mix.

interface Params {
  mix: [Policy, number][];
  sides: Sides;
}

const BASIC_ONLY: [Policy, number][] = [[BASIC_POLICY, 1]];
const SAMPLED: [Policy, number][] = [
  [BASIC_POLICY, 0.55],
  [INSURE_POLICY, 0.15],
  [MIMIC_POLICY, 0.15],
  [CAUTIOUS_POLICY, 0.15],
];

const exactRtp = ({ mix, sides }: Params) =>
  mix.reduce((s, [p, w]) => s + w * (p === BASIC_POLICY ? RTP : evaluatePolicy(p).rtp), 0) +
  sides.pairs * (PAIRS_RTP - 1) +
  sides.trips * (TRIPS_RTP - 1);

const CONFIGS: { label: string; params: Params }[] = [
  { label: 'low (main bet, basic strategy)', params: { mix: BASIC_ONLY, sides: { pairs: 0, trips: 0 } } },
  { label: 'medium (sampled players, Pairs ½×)', params: { mix: SAMPLED, sides: { pairs: 0.5, trips: 0 } } },
  { label: 'high (basic, 21+3 1×)', params: { mix: BASIC_ONLY, sides: { pairs: 0, trips: 1 } } },
  { label: 'extreme (sampled players, Pairs 1× + 21+3 1×)', params: { mix: SAMPLED, sides: { pairs: 1, trips: 1 } } },
];

export default defineEval<Params>({
  configs: CONFIGS.map((c) => (c.params.mix === BASIC_ONLY && c.params.sides.pairs + c.params.sides.trips === 0 ? c : { ...c, rtp: exactRtp(c.params) })),
  playRound({ mix, sides }, rng) {
    let u = rng.next();
    let policy = mix[mix.length - 1][0];
    for (const [p, w] of mix) {
      if (u < w) {
        policy = p;
        break;
      }
      u -= w;
    }
    const r = playOut(policy, sides, () => cardOf(rng.int(52)));
    return { multiplier: 1 + r.returned - r.wagered, steps: Math.max(1, r.decisions) };
  },
});
