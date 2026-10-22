import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'strip-roulette',
  name: 'Strip Roulette',
  tagline: 'Red, black or the lone green: the strip slides under the pointer. Back any mix of colours each spin.',
  mechanic: 'other',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#14b8a6',
});
