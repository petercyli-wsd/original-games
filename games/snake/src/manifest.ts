import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'snake',
  name: 'Snake',
  tagline: 'A blind snake steps in a random direction. Grow it to your length without hitting a wall or itself. The green arrows are your odds.',
  mechanic: 'random-walk',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#00f5d4',
});
