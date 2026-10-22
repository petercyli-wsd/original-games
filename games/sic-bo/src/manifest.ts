import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'sic-bo',
  name: 'Sic Bo',
  tagline: 'Three dice, one table: back Big or Small, a total, a pair or a triple. Every cell shows its exact odds out of 216.',
  mechanic: 'table',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#fb7185',
});
