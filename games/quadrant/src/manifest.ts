import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'quadrant',
  name: 'Quadrant',
  tagline: 'A point lands in a tilted Gaussian cloud: x first, then y. The green share of the cloud is your chance.',
  mechanic: 'geometry',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#a8dadc',
});
