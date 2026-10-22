import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'call-it',
  name: 'Call It',
  tagline: 'Cards turn one by one. Call "next is red" whenever you like. The red share of the deck bar is your chance, and no timing beats it.',
  mechanic: 'inference',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#ffc6ff',
});
