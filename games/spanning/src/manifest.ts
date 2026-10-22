import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'spanning',
  name: 'Spanning',
  tagline: 'A random spanning tree grows across a grid, row by row. Back edges IN or lay them OUT. Edge widths are their live chances.',
  mechanic: 'graph',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#b8c0ff',
});
