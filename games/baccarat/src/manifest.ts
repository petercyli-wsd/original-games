import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'baccarat',
  name: 'Baccarat',
  tagline: 'Punto banco from a fresh 8-deck shoe: back Player, Banker or the Tie, with pair side bets. Banker returns 98.94%.',
  mechanic: 'table',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: false,
  accent: '#8b5cf6',
});
