import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'sic-bo',
  name: 'Sic Bo',
  tagline: 'Three dice, one table: back Big or Small, a total, a pair or a triple. The rules list the exact odds out of 216.',
  mechanic: 'table',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#e879b9', // ACCENTS.pink (docs/STYLE.md)
});
