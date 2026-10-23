import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'hot-potato',
  name: 'Hot Potato',
  tagline: 'A bomb hops round the ring until it blows; back the seat where it goes off. The heat ring is every seat’s chance.',
  mechanic: 'process',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#ff6b35',
});
