import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'halo',
  name: 'Halo',
  tagline: 'A particle wanders from the centre to the rim. Leave through the green arc to win. The green share of its halo is your chance.',
  mechanic: 'random-walk',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#a0c4ff',
});
