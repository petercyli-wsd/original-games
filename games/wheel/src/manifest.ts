import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'wheel',
  name: 'Wheel',
  tagline: 'Spin the wheel and win the segment under the pointer. Each multiplier’s share of the rim is its exact chance.',
  mechanic: 'other',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#e6b450', // ACCENTS.amber (docs/STYLE.md)
});
