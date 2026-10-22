import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'slide-rule',
  name: 'Slide Rule',
  tagline: 'Multiply random factors on a log dial. Call the leading digit. Benford says 1 wins 30% of the time.',
  mechanic: 'number-theory',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e9c46a',
});
