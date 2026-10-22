import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'sperner',
  name: 'Sperner',
  tagline: 'Colour a triangle vertex by vertex. Sperner says the rainbow count is always odd: bet on just one, or on many.',
  mechanic: 'combinatorics',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#ff4fa3',
});
