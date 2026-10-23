import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'derby',
  name: 'Derby',
  tagline: 'Back a runner; first past the line wins. Steady or erratic, the tote shows every runner’s live odds, and you can switch at fair value.',
  mechanic: 'process',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#2a9d8f',
});
