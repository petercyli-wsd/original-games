import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, MODE_NAMES, RTP } from './math';

export default defineManifest({
  id: 'scratch',
  name: 'Scratch',
  tagline: 'One winning card. A few goes. Every miss drains your odds.',
  // Mines-family maths: uniform hidden tile, fair value = prize × goes / cards left.
  mechanic: 'mines',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: MODE_NAMES,
  checkpoints: true,
  accent: '#f472b6',
});
