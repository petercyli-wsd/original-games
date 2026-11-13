import { defineEval } from '@originals/game-sdk';
import { DIFFICULTIES, playRound, rtpOf, type Difficulty } from './math';

// Tarot has no in-round choices: the player's decisions are the difficulty and
// when to stop playing. One config per difficulty, plus a session that switches
// difficulty at random between rounds and one that steps up after a loss. Every
// difficulty is exactly 98% (2.00 x 0.70^2), so each config declares the exact
// RTP taken from the enumeration of its tables.
type Params = { d: Difficulty | 'mixed' | 'chase' };

let chaseLevel = 0;

export default defineEval<Params>({
  configs: [
    { label: 'low (Easy)', params: { d: 'easy' }, rtp: rtpOf('easy') },
    { label: 'medium (Medium)', params: { d: 'medium' }, rtp: rtpOf('medium') },
    { label: 'high (Hard)', params: { d: 'hard' }, rtp: rtpOf('hard') },
    { label: 'extreme (Expert)', params: { d: 'expert' }, rtp: rtpOf('expert') },
    { label: 'mixed (difficulty switched each round)', params: { d: 'mixed' }, rtp: rtpOf('medium') },
    { label: 'chase (step up difficulty after a loss)', params: { d: 'chase' }, rtp: rtpOf('medium') },
  ],
  playRound({ d }, rng) {
    let r: Difficulty;
    if (d === 'mixed') r = DIFFICULTIES[Math.floor(rng.next() * DIFFICULTIES.length)];
    else if (d === 'chase') r = DIFFICULTIES[chaseLevel];
    else r = d;
    const { multiplier } = playRound(rng.next, r);
    if (d === 'chase') chaseLevel = multiplier >= 1 ? 0 : Math.min(DIFFICULTIES.length - 1, chaseLevel + 1);
    return { multiplier, steps: 1 };
  },
});
