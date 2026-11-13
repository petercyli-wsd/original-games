import { defineEval } from '@originals/game-sdk';
import { DIFFICULTIES, playRound, type Difficulty } from './math';

// Cases has no in-round choices: the player's only decision is the difficulty.
// One config per difficulty covers low to extreme volatility; a fifth config
// picks the difficulty at random every round, as a player tinkering between
// bets would. Every difficulty returns exactly RTP (98%), so no config needs an
// rtp override.
type Params = { difficulty: Difficulty | 'mixed' };

export default defineEval<Params>({
  configs: [
    { label: 'low (Easy)', params: { difficulty: 'easy' } },
    { label: 'medium (Medium)', params: { difficulty: 'medium' } },
    { label: 'high (Hard)', params: { difficulty: 'hard' } },
    { label: 'extreme (Expert)', params: { difficulty: 'expert' } },
    { label: 'mixed (random difficulty)', params: { difficulty: 'mixed' } },
  ],
  playRound({ difficulty }, rng) {
    const d = difficulty === 'mixed' ? DIFFICULTIES[rng.int(DIFFICULTIES.length)] : difficulty;
    return { multiplier: playRound(() => rng.next(), d).multiplier, steps: 1 };
  },
});
