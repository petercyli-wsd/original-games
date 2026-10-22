import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'darts',
  name: 'Darts',
  tagline: 'One dart, one ring. Each ring pays its multiplier, and its share of the board is your exact chance.',
  mechanic: 'geometry',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#84cc16',
});
