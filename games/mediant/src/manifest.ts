import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'mediant',
  name: 'Mediant',
  tagline: 'A fair coin walks down the Stern–Brocot tree. Pick a window on the number line; the lit fractions are your odds.',
  mechanic: 'number-theory',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#c3f584',
});
