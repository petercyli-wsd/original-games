import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'hamming',
  name: 'Hamming',
  tagline: 'Seven bits cross a noisy channel. The code absorbs one flip per block. Bet it decodes, or bet it gets fooled.',
  mechanic: 'combinatorics',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#7bdff2',
});
