import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'range-dice',
  name: 'Range Dice',
  tagline: 'Drag two handles to set a range, then roll in or out of it. The green share of the track is your chance.',
  mechanic: 'dice',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#06b6d4',
});
