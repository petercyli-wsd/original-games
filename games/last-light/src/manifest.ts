import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'last-light',
  name: 'Last Light',
  tagline: 'A random walker lights a ring of lamps. Back the one that lights last: every lamp has the same chance.',
  mechanic: 'random-walk',
  status: 'prototype',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#fee440',
});
