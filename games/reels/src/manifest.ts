import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'reels',
  name: 'Reels',
  tagline: 'A 5×3, 20-line slot with wilds, scatters and retriggering free spins at 2×. Three reel sets, every RTP exact.',
  mechanic: 'slots',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#f97316',
});
