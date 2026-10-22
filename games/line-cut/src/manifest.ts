import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'line-cut',
  name: 'Line Cut',
  tagline: 'Random lines slice the arena. Back a shape to be cut or spared: its shadow on the ruler is your odds.',
  mechanic: 'geometry',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#80ed99',
});
