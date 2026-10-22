import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'deep',
  name: 'Deep',
  tagline: 'Random keys grow a binary search tree. Place them all above the depth limit. The red stretch of the line is your risk.',
  mechanic: 'graph',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#9b5de5',
});
