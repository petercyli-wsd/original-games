import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'chase',
  name: 'Chase',
  tagline: 'Reach the exit before the hunter catches you. Every cell is shaded by your odds if the runner stood there.',
  mechanic: 'random-walk',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e63946',
});
