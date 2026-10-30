import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'lasso',
  name: 'Lasso',
  tagline: 'A random walk wanders round a pole. Cross the seam to tie a loop: wind it round the pole by the end to win.',
  mechanic: 'random-walk',
  status: 'retired',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#98f5e1',
});
