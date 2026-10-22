import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'connect',
  name: 'Connect',
  tagline: 'Random edges join nodes on a circle. Back Connected or Split before the edge budget runs out.',
  mechanic: 'graph',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#90f1ef',
});
