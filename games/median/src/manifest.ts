import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'median',
  name: 'Median',
  tagline: 'Points drop on a line. Place a window and win if the middle point lands in it. Neither side may get past half.',
  mechanic: 'geometry',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#f4d35e',
});
