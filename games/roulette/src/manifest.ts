import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'roulette',
  name: 'Roulette',
  tagline: 'Single-zero roulette with the full table, racetrack calls and neighbours. Every bet returns 97.30%.',
  mechanic: 'table',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#dc2626',
});
