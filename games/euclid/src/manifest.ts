import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'euclid',
  name: 'Euclid',
  tagline: 'Euclid cuts squares from a hidden rectangle. Each cut reveals a quotient; the lit pairs are your odds.',
  mechanic: 'number-theory',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#ffd6a5',
});
