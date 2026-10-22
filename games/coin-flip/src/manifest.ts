import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'coin-flip',
  name: 'Coin Flip',
  tagline: 'Call heads or tails and double up on every right call. Cash out after any win, or ride the streak to 20.',
  mechanic: 'other',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#fbbf24',
});
