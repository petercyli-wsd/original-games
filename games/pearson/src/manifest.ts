import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'pearson',
  name: 'Pearson Walk',
  tagline: 'A walker takes n random unit steps. End inside home to win: one step wide, the chance is exactly 1/(n+1).',
  mechanic: 'random-walk',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#ff70a6',
});
