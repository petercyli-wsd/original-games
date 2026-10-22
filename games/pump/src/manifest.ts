import { defineManifest } from '@originals/game-sdk';
import { MAX_MULTIPLIER, RTP } from './math';

export default defineManifest({
  id: 'pump',
  name: 'Pump',
  tagline: 'Pump the balloon and watch the multiplier climb. Cash out before it pops.',
  mechanic: 'mines',
  status: 'live',
  collection: 'classics',
  rtp: RTP,
  maxMultiplier: MAX_MULTIPLIER,
  volatility: ['low', 'medium', 'high', 'extreme'],
  checkpoints: true,
  accent: '#38bdf8',
});
