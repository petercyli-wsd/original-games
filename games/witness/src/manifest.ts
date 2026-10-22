import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'witness',
  name: 'Witness',
  tagline: 'Miller–Rabin tests a hidden number with random bases. Composites survive at their liar rate; the lit dots are your odds.',
  mechanic: 'number-theory',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: Math.ceil(MAX_MULTIPLIER),
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e9ff70',
});
