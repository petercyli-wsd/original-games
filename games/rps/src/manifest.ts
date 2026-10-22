import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'rps',
  name: 'Rock Paper Scissors',
  tagline: 'Beat the house hand to double up. Draws replay, a loss busts, cash out after any win.',
  mechanic: 'duel',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e879f9',
});
