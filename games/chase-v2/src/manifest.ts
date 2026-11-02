import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'chase-v2',
  name: 'Chase',
  tagline: 'A runner wanders a walled yard at random while a hunter closes in. Cash out before it is caught, or win if it reaches the exit.',
  mechanic: 'random-walk',
  status: 'prototype',
  revision: {
    kind: 'improved',
    date: '2026-11-02',
    note: "The runner's random steps are arrows marked 1 in k, red where the hunter can reach (outlined), the hunter's next square is shown before it moves, and a race counter shows steps to the exit vs the hunter's steps to the runner.",
  },
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e63946',
});
