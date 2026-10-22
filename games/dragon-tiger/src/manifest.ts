import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'dragon-tiger',
  name: 'Dragon Tiger',
  tagline: 'One card to Dragon, one to Tiger: the higher card wins. Back a side, the tie, or a side bet on either card.',
  mechanic: 'table',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#f97316',
});
