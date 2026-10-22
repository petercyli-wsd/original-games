import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'zigzag',
  name: 'Zigzag',
  tagline: 'Random bars must go up, down, up, down. The green zone is where the next one has to land.',
  mechanic: 'combinatorics',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#f7aef8',
});
