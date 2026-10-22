import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'two-tone',
  name: 'Two-Tone',
  tagline: 'Random edges join nodes on a ring. Keep the graph two-toned: an edge between same-tone nodes closes an odd cycle. Red pairs are your risk.',
  mechanic: 'graph',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#cdb4db',
});
