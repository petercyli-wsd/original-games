import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'shunt',
  name: 'Shunt',
  tagline: 'Cars arrive in random order. Route them through one siding so they leave 1, 2, 3… Red cars would jam it.',
  mechanic: 'combinatorics',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#a2d2ff',
});
