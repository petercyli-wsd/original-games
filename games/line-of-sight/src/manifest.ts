import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'line-of-sight',
  name: 'Line of Sight',
  tagline: 'Stand at the corner of a lattice orchard. A tree is in sight only if no nearer tree blocks the line: 6/π² of them are.',
  mechanic: 'number-theory',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#b5e48c',
});
