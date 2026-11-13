import { defineEval } from '@originals/game-sdk';
import { DIFFICULTIES, PICK_COUNTS, RTP, playRound, randomPicks, type Difficulty } from './math';

// No in-round choices: the player's decisions are the difficulty and how many
// tiles to pick (and which: irrelevant, the tiles are i.i.d.). One config per
// volatility level, plus a mixed one that samples both knobs every round.
type Params = { difficulty: Difficulty | 'mixed'; picks: number | 'mixed' };

export default defineEval<Params>({
  configs: [
    { label: 'low (Easy, 5 picks)', params: { difficulty: 'easy', picks: 5 } },
    { label: 'medium (Medium, 2 picks)', params: { difficulty: 'medium', picks: 2 } },
    { label: 'high (Hard, 1 pick)', params: { difficulty: 'hard', picks: 1 } },
    { label: 'extreme (Expert, 1 pick)', params: { difficulty: 'expert', picks: 1 } },
    { label: 'mixed (random difficulty, 1-5 picks)', params: { difficulty: 'mixed', picks: 'mixed' }, rtp: RTP },
  ],
  playRound({ difficulty, picks }, rng) {
    const d = difficulty === 'mixed' ? DIFFICULTIES[rng.int(DIFFICULTIES.length)] : difficulty;
    const n = picks === 'mixed' ? PICK_COUNTS[rng.int(PICK_COUNTS.length)] : picks;
    const chosen = randomPicks((k) => rng.int(k), n);
    return { multiplier: playRound(() => rng.next(), d, chosen).multiplier, steps: 1 };
  },
});
