import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'crash-colours',
  name: 'Crash Colours',
  tagline: 'No cash-out, just colours: back Red under 2×, Green over it, or Moon past 10×. Every band returns 99%.',
  mechanic: 'crash',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#ef4444',
});
