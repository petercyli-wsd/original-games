import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'shells',
  name: 'Shells',
  tagline: 'Follow the ball under the cups; blind swaps blur where it is. Back the cup it ends under.',
  mechanic: 'inference',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#f4a261',
});
