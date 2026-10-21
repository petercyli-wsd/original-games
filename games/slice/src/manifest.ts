import { defineManifest } from '@originals/game-sdk';
import { MODE_NAMES, RTP, maxMultiplier } from './math';

export default defineManifest({
  id: 'slice',
  name: 'Slice',
  tagline: 'A dot is hidden in the square. Is it inside your circle?',
  mechanic: 'geometry',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: Math.max(...MODE_NAMES.map(maxMultiplier)),
  volatility: MODE_NAMES,
  checkpoints: true,
  accent: '#1fc8d8',
});
