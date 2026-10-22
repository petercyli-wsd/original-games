import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'prime-time',
  name: 'Prime Time',
  tagline: 'A hidden number shows its digits one by one, in the order you pick. The lit dots are the numbers that still win you the bet.',
  mechanic: 'number-theory',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#ffb4a2',
});
