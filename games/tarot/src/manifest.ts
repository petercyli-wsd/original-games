import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'tarot',
  name: 'Tarot',
  tagline: 'Three cards are turned one by one. Each shows a multiplier; your payout is their product.',
  mechanic: 'other',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#c084fc',
});
