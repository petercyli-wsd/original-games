import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'thales',
  name: 'Thales',
  tagline: 'Three points land in an arena. Back an acute or an obtuse triangle. The third point must find the band outside the Thales circle.',
  mechanic: 'geometry',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#ff9b85',
});
