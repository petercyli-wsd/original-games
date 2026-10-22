import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'chicken',
  name: 'Chicken',
  tagline: 'Cross twenty lanes of traffic one hop at a time. Every safe lane raises the multiplier; cash out before you get hit.',
  mechanic: 'mines',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#facc15',
});
