import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'homecoming',
  name: 'Homecoming',
  tagline: 'A random walk in 1, 2 or 3 dimensions. Back it to come home in time, or to stay lost. Pólya prices both.',
  mechanic: 'random-walk',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e0aaff',
});
