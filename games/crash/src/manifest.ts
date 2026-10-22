import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'crash',
  name: 'Crash',
  tagline: 'The multiplier climbs until it crashes. Cash out before it does, or set a target and let it fly.',
  mechanic: 'crash',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#f97316',
});
