import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'tumble',
  name: 'Tumble',
  tagline: 'Cubes tumble in random directions. Call where the red face ends: top, side or bottom. Each bar is a cube’s exact odds.',
  mechanic: 'process',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#84a59d',
});
