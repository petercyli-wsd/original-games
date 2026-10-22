import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'snap',
  name: 'Snap',
  tagline: 'Break the stick, then random cuts fall. Every piece under half makes a polygon. The green area is your chance.',
  mechanic: 'geometry',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#ff9f43',
});
