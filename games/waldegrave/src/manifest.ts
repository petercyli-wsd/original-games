import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'waldegrave',
  name: 'Waldegrave',
  tagline: 'Winner stays on, loser to the back. First to a streak takes the pot. Every seat shows its exact live odds.',
  mechanic: 'process',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e5989b',
});
