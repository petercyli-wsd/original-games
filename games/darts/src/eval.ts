import { defineEval } from '@originals/game-sdk';
import { DIFFICULTIES, rtpOf, throwDart, type Difficulty } from './math';

// Darts has no choices inside a round, so the player's only decision is the
// difficulty. One config per difficulty, plus a session that switches
// difficulty at random between throws (a player tinkering with the knob).
// Every table returns exactly 99%; each config still declares its own exact
// RTP from the integer table sum.
type Params = { difficulty: Difficulty | 'mixed' };

export default defineEval<Params>({
  configs: [
    { label: 'low (Easy)', params: { difficulty: 'easy' }, rtp: rtpOf('easy') },
    { label: 'medium (Medium)', params: { difficulty: 'medium' }, rtp: rtpOf('medium') },
    { label: 'high (Hard)', params: { difficulty: 'hard' }, rtp: rtpOf('hard') },
    { label: 'extreme (Expert)', params: { difficulty: 'expert' }, rtp: rtpOf('expert') },
    { label: 'mixed (difficulty switched each throw)', params: { difficulty: 'mixed' }, rtp: rtpOf('medium') },
  ],
  playRound({ difficulty }, rng) {
    const d = difficulty === 'mixed' ? DIFFICULTIES[Math.floor(rng.next() * DIFFICULTIES.length)] : difficulty;
    return { multiplier: throwDart(() => rng.next(), d).multiplier, steps: 1 };
  },
});
