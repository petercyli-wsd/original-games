import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'mines',
  name: 'Mines',
  tagline: 'Hide 1 to 24 mines in a 5×5 grid, then find gems. Every gem raises the cash-out; one mine ends it.',
  mechanic: 'mines',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#22c55e',
});
