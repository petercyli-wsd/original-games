import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'noughts',
  name: 'Noughts',
  tagline: 'X and O play at random. Back X, O or a draw, one game or a streak. Every empty cell shows what it does to your odds.',
  mechanic: 'combinatorics',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#8ecae6',
});
