import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'full-set',
  name: 'Full Set',
  tagline: 'Every draw lights a random segment of the ring. Light them all before the draws run out. The dark share is your chance of a new one.',
  mechanic: 'combinatorics',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#9bf6ff',
});
