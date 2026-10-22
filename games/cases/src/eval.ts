import { defineEval } from '@originals/game-sdk';
import { CASE_COUNTS, DIFFICULTIES, RTP, playRound, type Difficulty } from './math';

// Cases has no in-round choices: the player's decisions are the difficulty
// and how many cases each bet opens. One config per difficulty (single case,
// the default) covers low → extreme volatility; a fifth config samples both
// knobs at random every round, as a player tinkering between bets would.
// Every case and every case count returns exactly RTP, so no config needs an
// rtp override.
type Params = { difficulty: Difficulty | 'mixed'; count: number | 'mixed' };

export default defineEval<Params>({
  configs: [
    { label: 'low (Easy, 1 case)', params: { difficulty: 'easy', count: 1 } },
    { label: 'medium (Medium, 1 case)', params: { difficulty: 'medium', count: 1 } },
    { label: 'high (Hard, 1 case)', params: { difficulty: 'hard', count: 1 } },
    { label: 'extreme (Expert, 1 case)', params: { difficulty: 'expert', count: 1 } },
    { label: 'mixed (random difficulty, 1-4 cases)', params: { difficulty: 'mixed', count: 'mixed' }, rtp: RTP },
  ],
  playRound({ difficulty, count }, rng) {
    const d = difficulty === 'mixed' ? DIFFICULTIES[rng.int(DIFFICULTIES.length)] : difficulty;
    const n = count === 'mixed' ? CASE_COUNTS[rng.int(CASE_COUNTS.length)] : count;
    return { multiplier: playRound(() => rng.next(), d, n).multiplier, steps: 1 };
  },
});
