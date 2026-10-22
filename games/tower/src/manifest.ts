import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'tower',
  name: 'Tower',
  tagline: 'Climb nine rows one tile at a time. Pick safe, cash out whenever you like, or go for the summit.',
  mechanic: 'mines',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#fb923c',
});
