import { defineManifest } from '@originals/game-sdk';
import { MODE_NAMES, RTP, maxMultiplier } from './math';

export default defineManifest({
  id: 'overhang',
  name: 'Overhang',
  tagline: 'Blocks stack with random sideways offsets. Topple and you lose.',
  mechanic: 'geometry',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: Math.max(...MODE_NAMES.map(maxMultiplier)),
  volatility: MODE_NAMES,
  checkpoints: true,
  accent: '#e6b450', // ACCENTS.amber (docs/STYLE.md)
});
