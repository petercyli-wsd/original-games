import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'majority',
  name: 'Majority',
  tagline: 'Regions are called one by one; does Blue reach the majority line? Every path to victory is drawn under the map.',
  mechanic: 'inference',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#3a86ff',
});
