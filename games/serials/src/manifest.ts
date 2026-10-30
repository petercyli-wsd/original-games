import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'serials',
  name: 'Serials',
  tagline: 'Serial numbers are drawn from a hidden range. Bet the top serial is at most your cut. The posterior left of the cut is your chance.',
  mechanic: 'inference',
  status: 'retired',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#ffafcc',
});
