import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'shootout',
  name: 'Shootout',
  tagline: 'Five penalties each, then sudden death; back a team. The keeper covers the miss chance, and every kick moves your odds.',
  mechanic: 'process',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#06d6a0',
});
