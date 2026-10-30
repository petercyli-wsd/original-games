import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'core',
  name: 'Core',
  tagline: 'Random intervals drop onto a line. Keep them all sharing a point. The red corners are your risk.',
  mechanic: 'geometry',
  status: 'retired',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#e76f51',
});
