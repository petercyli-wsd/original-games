import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'pascal',
  name: 'Pascal',
  tagline: 'A random path runs down Pascal’s triangle, every path equally likely. Pick a gate; the share of paths through it is your chance.',
  mechanic: 'combinatorics',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#b8f2e6',
});
