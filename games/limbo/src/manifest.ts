import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'limbo',
  name: 'Limbo',
  tagline: 'Name a multiplier and watch the counter climb. Reach your target and it pays.',
  mechanic: 'crash',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#a855f7',
});
