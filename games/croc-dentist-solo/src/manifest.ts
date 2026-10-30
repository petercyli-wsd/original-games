import { defineManifest } from '@originals/game-sdk';
import { maxMultiplier } from './math';

export const RTP = 0.99;
export const TEETH_OPTIONS = [8, 10, 12, 16, 20];
export const BAD_TEETH_OPTIONS = [1, 2, 3, 4, 5];

export default defineManifest({
  id: 'croc-dentist-solo',
  name: 'Croc Dentist (Solo)',
  tagline: 'Press the teeth one by one. Every safe tooth raises your multiplier. Cash out before the bite.',
  mechanic: 'mines',
  status: 'retired',
  rtp: RTP,
  maxMultiplier: maxMultiplier(TEETH_OPTIONS, BAD_TEETH_OPTIONS, RTP),
  // 20 teeth / 1 bad is gentle; 20 teeth / 5 bad reaches ~15,000×.
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#3fb8a0',
});
