import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'bayes',
  name: 'Bayes',
  tagline: 'Gold or Silver? Every flip reshapes the Bayes box. Your coin’s share of it is your chance.',
  mechanic: 'inference',
  status: 'retired',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#fdffb6',
});
